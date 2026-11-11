'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, dialog, powerSaveBlocker, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { ConfigStore, DEFAULT_CONFIG } = require('./config');
const { scanLibrary, detectEmulators } = require('./library');
const { Launcher } = require('./launcher');
const { GamepadWatcher, BUTTONS } = require('./gamepad-watcher');
const system = require('./system');
const { Updater } = require('./updater');
const { Performance, RECOMMENDED, listRunning } = require('./performance');
const { PsHidWatcher } = require('./ps-hid-watcher');
const { Scraper } = require('./scraper');
const { HomeAssistant } = require('./homeassistant');
const { MouseMode } = require('./mouse-mode');
const { Osd } = require('./osd');
const { TouchpadMouse } = require('./touchpad');
const { Overlay } = require('./overlay');
const { NativeHelper, hwndOf } = require('./native-helper');
const media = require('./media');
const { Spotify } = require('./spotify');
const { AleClip } = require('./aleclip');

// Nur eine Instanz erlauben
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new ConfigStore(app.getPath('userData'));
const { DebugLog, brief } = require('./debug-log');
// Debug-Modus: Einstellungen → Info & Updates oder Startparameter --ags-debug
const debug = new DebugLog({
  dir: path.join(app.getPath('userData'), 'logs'),
  isEnabled: () => process.argv.includes('--ags-debug') || process.env.AGS_DEBUG === '1' || !!(store.get().general || {}).debugMode,
  onEvent: (e) => send('debug:event', e)
});
debug.hookProcess();
// Häufige Statusabfragen nicht protokollieren (nur deren Fehler)
debug.wrapIpc(ipcMain, new Set(['game:status', 'overlay:spotify', 'pad:hidCount', 'update:get', 'debug:log', 'debug:state']));
app.on('web-contents-created', (_e, wc) => debug.attach(wc, (w) => {
  if (win && !win.isDestroyed() && w === win.webContents) return 'oberfläche';
  if (overlay.win && !overlay.win.isDestroyed() && w === overlay.win.webContents) return 'overlay';
  if (osd.win && !osd.win.isDestroyed() && w === osd.win.webContents) return 'einblendung';
  return 'fenster';
}));
const launcher = new Launcher(() => store.get(), {
  readShortcutLink: (p) => shell.readShortcutLink(p),
  openPath: (p) => shell.openPath(p),
  openExternal: (u) => shell.openExternal(u)
});
const watcher = new GamepadWatcher();
let updater = null;
const perf = new Performance();
let perfPromise = Promise.resolve([]);
const psWatcher = new PsHidWatcher();
const aleclip = new AleClip({ getConfig: () => store.get(), trace: (m, d) => debug.info('aleclip', m, d) });
const spotify = new Spotify({
  getConfig: () => store.get(), file: path.join(app.getPath('userData'), 'spotify.json'),
  fetch: (u, o) => net.fetch(u, o), openUrl: (u) => shell.openExternal(u)
});
const ha = new HomeAssistant({ fetch: (url, opts) => net.fetch(url, opts), getConfig: () => store.get(), log: (m) => send('toast', { type: 'info', text: m }), trace: (m) => debug.info('homeassistant', m) });
// Gemeinsames Windows-Hilfsprogramm: Maus/Tastatur, Medientasten, Fenster-Fokus
const nativeHelper = new NativeHelper();
{
  // Anfragen an das Windows-Hilfsprogramm (Bildschirme, Fokus) im Debug-Modus mitschreiben
  const request = nativeHelper.request.bind(nativeHelper);
  nativeHelper.request = async (cmd, timeout) => {
    const t0 = Date.now();
    const r = await request(cmd, timeout);
    if (process.platform === 'win32' && (cmd !== 'fg' || r === '')) debug.write(r === '' && cmd !== 'fg' ? 'warn' : 'info', 'helper', `${String(cmd).slice(0, 90)} → ${r === '' ? '(keine Antwort)' : brief(r, 900)} (${Date.now() - t0} ms)`);
    return r;
  };
}
const mouseMode = new MouseMode({ getConfig: () => store.get(), send: (line) => nativeHelper.send(line) });
const osd = new Osd({ onShown: (w) => nativeHelper.top(hwndOf(w)) });
const overlay = new Overlay({ preload: path.join(__dirname, 'preload.js') });
// Touchpad als Maus: außerhalb von Spielen (oder nur in der Maussteuerung)
const touchpad = new TouchpadMouse({
  send: (line) => mouseMode.send(line),
  getConfig: () => store.get(),
  isEnabled: () => {
    const m = (store.get().controller || {}).touchpadMouse || 'outsideGames';
    if (m === 'off') return false;
    if (mouseMode.active) return true;
    return m === 'outsideGames' && !launcher.isRunning();
  }
});
let startupNotes = [];
let win = null;
let library = { systems: [], games: [] };
let quitting = false;
let displaySwitched = false;

const isDev = process.argv.includes('--dev');
// Startoption "--no-display-switch" überspringt das Umschalten (z.B. zum Testen am Schreibtisch)
const skipDisplaySwitch = process.argv.includes('--no-display-switch');

function cfg() {
  return store.get();
}

function send(channel, payload) {
  if (channel === 'toast' && payload && debug) debug.write(payload.type === 'error' ? 'error' : 'info', 'meldung', payload.text || '');
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- Bildschirme / Fernseher ----------
let knownDisplays = []; // letzte Liste aus listDisplays() (für die Fensterplatzierung)
let tvOnlyState = null; // { prevPrimary } solange "Nur Fernseher" aktiv ist
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pixel-Rechteck (Windows) in Electron-Koordinaten umrechnen */
function toDip(r) {
  try { return screen.screenToDipRect(null, r); } catch { return r; }
}

/** Electron-Bildschirm zu einem Windows-Bildschirm finden: Mittelpunkt liegt darin, sonst gleicher Name */
function matchElectron(w, all) {
  if (w.active && w.w > 0) {
    const r = toDip({ x: w.x, y: w.y, width: w.w, height: w.h });
    const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
    const hit = all.find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height);
    if (hit) return hit;
  }
  return w.active && w.name ? all.find((d) => d.label && d.label === w.name) || null : null;
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/** Alle angeschlossenen Bildschirme mit echtem Namen (z.B. "LG TV"), auch ausgeschaltete */
async function listDisplays() {
  const el = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  let win32 = [];
  try { const j = await nativeHelper.request('displays', 15000); win32 = j ? JSON.parse(j) : []; } catch { win32 = []; }
  let list;
  if (win32.length) {
    list = win32.map((w, i) => {
      const e = matchElectron(w, el);
      const generic = !w.name || /pnp|plug and play|generic/i.test(w.name);
      return {
        key: w.key, device: w.device, name: (!generic && w.name) || (e && e.label) || `Bildschirm ${i + 1}`,
        width: w.w, height: w.h, hz: w.hz, primary: !!w.primary, active: w.active !== false, electronId: e ? e.id : null
      };
    });
  } else {
    list = el.map((d, i) => ({ key: 'e:' + d.id, device: '', name: d.label || `Bildschirm ${i + 1}`, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor), primary: d.id === primaryId, active: true, electronId: d.id }));
  }
  knownDisplays = list;
  return list;
}

/** Den gewählten Fernseher in einer Bildschirmliste finden (Gerätename, sonst Name) */
function findTv(list) {
  const tv = cfg().display.tv;
  if (!tv) return null;
  return list.find((x) => x.key === tv.key) || list.find((x) => tv.name && x.name === tv.name) || null;
}

function targetDisplay() {
  const displays = screen.getAllDisplays();
  const t = String(cfg().general.targetDisplay || 'primary');
  if (t === 'tv') {
    const tv = findTv(knownDisplays);
    const d = tv && displays.find((x) => x.id === tv.electronId);
    if (d) return d;
  } else if (t.startsWith('id:')) {
    const d = displays.find((x) => String(x.id) === t.slice(3));
    if (d) return d;
  } else if (t !== 'primary' && displays[Number(t)]) return displays[Number(t)];
  return screen.getPrimaryDisplay();
}

/**
 * Gewählten Fernseher verwenden.
 *  mode 'only'    = einziger Bildschirm und Hauptbildschirm (andere aus)
 *  mode 'primary' = alle Bildschirme bleiben an, der TV wird Hauptbildschirm (Spiele starten dort)
 */
async function applyTvOnly(manual = false, mode = 'only') {
  const d = cfg().display;
  const tv = d.tv;
  if (!tv) return { ok: false, error: 'Kein Fernseher ausgewählt (Einstellungen → Anzeige)' };
  let list = await listDisplays();
  let entry = findTv(list);
  if (!entry) {
    // Fernseher noch nicht angeschlossen/erkannt (z.B. gerade per Home Assistant eingeschaltet): warten
    const deadline = Date.now() + (d.tvWaitSeconds || 15) * 1000;
    while (!entry && Date.now() < deadline) {
      await sleep(1500);
      list = await listDisplays();
      entry = findTv(list);
    }
  }
  if (!entry) return { ok: false, error: `Fernseher „${tv.name}“ wurde nicht gefunden – ist er eingeschaltet und angeschlossen?` };
  if (/^e:/.test(entry.key)) return { ok: false, error: 'Umschalten auf den Fernseher ist nur unter Windows möglich' };
  if (!tvOnlyState) {
    const prev = list.find((x) => x.primary && x.active);
    tvOnlyState = { mode, saved: await nativeHelper.request('save', 10000), prevPrimary: prev && prev.key !== entry.key ? prev.key : '' };
  }
  tvOnlyState.mode = mode;
  if (mode === 'only' ? !(entry.primary && list.filter((x) => x.active).length === 1) : !entry.primary) {
    const r = await nativeHelper.request(`${mode === 'only' ? 'tvonly' : 'primary'} ${b64(entry.key)}`, 15000);
    if (r !== '0') return { ok: false, error: `Windows konnte nicht auf den Fernseher umschalten (Code ${r || 'keine Antwort'})` };
  }
  displaySwitched = true;
  if (!manual) await sleep(d.switchDelayMs || 2500);
  setTimeout(() => listDisplays().then(placeWindow).catch(() => {}), 1500);
  return { ok: true, name: entry.name };
}

/** Alle Bildschirme wieder einschalten und den vorherigen Hauptbildschirm zurücksetzen */
async function restoreDisplays(onExit = 'extend') {
  const state = tvOnlyState;
  tvOnlyState = null;
  // Am liebsten exakt die vorherige Anordnung wiederherstellen
  let ok = false;
  if (state && state.saved) ok = (await nativeHelper.request(`restore ${state.saved}`, 15000)) === '0';
  if (!ok) {
    if ((await nativeHelper.request('extend', 15000)) !== '0') await system.setDisplayMode('extend');
    await sleep(2000);
    if (state && state.prevPrimary) await nativeHelper.request(`primary ${b64(state.prevPrimary)}`, 15000);
  }
  if (onExit && !['extend', 'none', 'tvOnly', 'tvPrimary'].includes(onExit)) { await sleep(1000); await system.setDisplayMode(onExit); }
  displaySwitched = false;
  setTimeout(() => listDisplays().then(placeWindow).catch(() => {}), 1500);
}

/** Auf jedem Bildschirm groß Nummer und Name einblenden (wie bei Windows "Identifizieren") */
async function identifyDisplays() {
  const list = await listDisplays();
  const all = screen.getAllDisplays();
  const used = new Set();
  list.forEach((entry, i) => {
    if (!entry.active) return;
    const d = all.find((x) => x.id === entry.electronId);
    if (!d || used.has(d.id)) return; // Duplizieren: beide zeigen dasselbe Bild
    used.add(d.id);
    const w = 520; const h = 300;
    const idw = new BrowserWindow({ x: Math.round(d.bounds.x + (d.bounds.width - w) / 2), y: Math.round(d.bounds.y + (d.bounds.height - h) / 2), width: w, height: h,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, show: false, webPreferences: { sandbox: true } });
    idw.setAlwaysOnTop(true, 'screen-saver');
    const tvKey = (cfg().display.tv || {}).key;
    const html = `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(14,14,24,.92);color:#fff;font-family:Segoe UI,sans-serif;border-radius:24px;flex-direction:column">
      <div style="font-size:150px;font-weight:800;line-height:1">${i + 1}</div><div style="font-size:26px;margin-top:8px">${String(entry.name).replace(/[<>&]/g, '')}</div>
      <div style="font-size:18px;opacity:.7;margin-top:6px">${entry.width}×${entry.height}${entry.primary ? ' · Hauptbildschirm' : ''}${entry.key === tvKey ? ' · Fernseher' : ''}</div></body>`;
    idw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => { idw.showInactive(); nativeHelper.top(hwndOf(idw)); });
    setTimeout(() => { if (!idw.isDestroyed()) idw.destroy(); }, 4000);
  });
  return list;
}

function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const { bounds } = targetDisplay();
  const fullscreen = cfg().general.startFullscreen && !isDev;
  if (fullscreen) win.setFullScreen(false);
  win.setBounds(fullscreen ? bounds : { x: bounds.x + 60, y: bounds.y + 60, width: Math.min(1600, bounds.width - 120), height: Math.min(900, bounds.height - 120) });
  if (fullscreen) win.setFullScreen(true);
}

function bringToFront() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  // Trick, um Windows' Fokus-Sperre zu umgehen
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.webContents.focus();
  // Zusätzlich über das Hilfsprogramm: klappt auch, wenn ein Vollbild-Spiel den Fokus hält
  nativeHelper.front(hwndOf(win), false);
  setTimeout(() => win && !win.isDestroyed() && win.setAlwaysOnTop(false), 400);
}

function applyCombos() {
  const c = cfg().controller;
  watcher.setCombos([
    { name: 'closeGame', combo: c.closeGameCombo, holdMs: c.comboHoldMs },
    { name: 'showLauncher', combo: c.showLauncherCombo, holdMs: c.comboHoldMs },
    { name: 'mouseMode', combo: c.mouseModeCombo, holdMs: Math.min(c.comboHoldMs, 600) },
  ]);
}

function applyAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { app.setLoginItemSettings({ openAtLogin: !!cfg().general.autostartWithWindows, args: [] }); } catch { /* ignore */ }
  }
}

async function enterConsoleMode() {
  debug.info('ablauf', 'Konsolenmodus starten', { display: cfg().display, targetDisplay: cfg().general.targetDisplay });
  const d = cfg().display;
  // Fernseher über Home Assistant einschalten und HDMI-Eingang wählen – bevor Windows das Bild umschaltet
  if (ha.ready()) {
    try {
      const r = await ha.onStart();
      if (r && !r.skipped) startupNotes.push({ type: 'ok', text: `📺 Fernseher ${r.on ? 'eingeschaltet' : 'angesteuert'}${r.source ? ' · ' + r.source : ''}` });
    } catch (err) {
      startupNotes.push({ type: 'error', text: err.message });
    }
  }
  await system.runCommands(d.customCommandsOnStart);
  // AleClip im Hintergrund mitstarten (für Clips aus dem Overlay)
  if (aleclip.enabled() && cfg().aleclip.autoStart !== false && aleclip.findExe()) {
    aleclip.status().then((st) => { if (st.offline) return aleclip.start(); return null; }).catch((err) => debug.warn('aleclip', err.message));
  }
  if (!skipDisplaySwitch && (d.onStart === 'tvOnly' || d.onStart === 'tvPrimary')) {
    const r = await applyTvOnly(false, d.onStart === 'tvPrimary' ? 'primary' : 'only');
    if (!r.ok) startupNotes.push({ type: 'error', text: r.error });
  } else if (!skipDisplaySwitch && d.onStart && d.onStart !== 'none') {
    const r = await system.setDisplayMode(d.onStart);
    if (r.ok) {
      displaySwitched = true;
      await new Promise((res) => setTimeout(res, d.switchDelayMs || 2500));
    }
  }
}

async function leaveConsoleMode(opts = {}) {
  debug.info('ablauf', 'Konsolenmodus beenden', opts);
  const d = cfg().display;
  mouseMode.setActive(false);
  await perfPromise;
  await perf.restore(!!opts.shutdown);
  if (tvOnlyState) {
    await restoreDisplays(d.onExit);
  } else if (displaySwitched && d.onExit && d.onExit !== 'none') {
    await system.setDisplayMode(d.onExit);
    displaySwitched = false;
  }
  await system.runCommands(d.customCommandsOnExit);
  if (!opts.restart) await ha.onExit({ shutdown: !!opts.shutdown }).catch(() => {});
}

function mediaDir() {
  return (cfg().scraper && cfg().scraper.mediaDir) || path.join(app.getPath('userData'), 'media');
}

function refreshLibrary() {
  library = scanLibrary(cfg(), { mediaDir: mediaDir() });
  return library;
}

// ---------- Cover-Download ----------
let scraper = null;
function getScraper() {
  if (!scraper || scraper.mediaDir !== mediaDir()) {
    scraper = new Scraper({ mediaDir: mediaDir(), getConfig: cfg, fetch: (url, opts) => net.fetch(url, opts), trace: (m) => debug.info('cover', m) });
    scraper.on('progress', (p) => send('scrape:progress', p));
  }
  return scraper;
}

// Spiele, für die nichts gefunden wurde – automatische Suche erst nach 14 Tagen erneut
function missingFile() { return path.join(mediaDir(), 'not-found.json'); }
function readMissing() { try { return JSON.parse(fs.readFileSync(missingFile(), 'utf8')); } catch { return {}; } }

async function scrapeGames(games, { force = false, auto = false } = {}) {
  const s = getScraper();
  if (s.running) return null;
  const missing = readMissing();
  const now = Date.now();
  const list = auto ? games.filter((g) => !(missing[g.id] && now - missing[g.id] < 14 * 86400000)) : games;
  if (!list.length) return null;
  const before = new Set(library.games.filter((g) => g.cover).map((g) => g.id));
  const result = await s.scrapeAll(list, { force });
  refreshLibrary();
  // Nicht gefundene merken
  for (const g of list) {
    const now2 = library.games.find((x) => x.id === g.id);
    if (now2 && !now2.cover) missing[g.id] = now; else delete missing[g.id];
  }
  try { fs.mkdirSync(mediaDir(), { recursive: true }); fs.writeFileSync(missingFile(), JSON.stringify(missing)); } catch { /* ignore */ }
  result.newCovers = library.games.filter((g) => g.cover && !before.has(g.id)).length;
  send('library:changed', library);
  return result;
}

function autoScrape() {
  if (!cfg().scraper || cfg().scraper.autoScrape === false) return;
  const todo = library.games.filter((g) => ['rom', 'steam', 'epic', 'pc'].includes(g.type) && !g.cover);
  if (todo.length) scrapeGames(todo, { auto: true }).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    backgroundColor: '#07070c',
    autoHideMenuBar: true,
    frame: isDev,
    title: 'AleGamestation',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.removeMenu();
  placeWindow();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    bringToFront();
  });
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => { win = null; osd.destroy(); overlay.destroy(); });
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => { for (const n of startupNotes.splice(0)) send('toast', n); }, 1500);
  });
  win.on('focus', () => send('window:focus', true));
  win.on('blur', () => send('window:focus', false));
}

// ---------- Launcher-Events ----------
launcher.on('started', (s) => debug.info('spiel', 'gestartet', s));
launcher.on('launching', (l) => debug.info('spiel', 'Startbefehl', l));
launcher.on('exited', (i) => debug.info('spiel', 'beendet', i));
launcher.on('error', (err) => debug.error('spiel', 'Startfehler: ' + ((err && err.stack) || err)));
watcher.on('connection', (c) => debug.info('controller', 'Verbindung', c));
psWatcher.on('connection', (c) => debug.info('controller', 'PlayStation (HID)', c));
watcher.on('combo', ({ name }) => debug.info('controller', 'Tastenkombination ' + name));
launcher.on('started', (status) => {
  send('game:status', status);
  overlay.send('overlay:refresh');
  touchpad.reset();
  if (cfg().general.minimizeOnLaunch && win) setTimeout(() => win && !win.isDestroyed() && launcher.isRunning() && win.minimize(), 1200);
});
launcher.on('exited', (info) => {
  const c = cfg();
  const id = info.game.id;
  const recent = [id, ...(c.recent || []).filter((r) => r !== id)].slice(0, 30);
  const playtime = { ...(c.playtime || {}), [id]: ((c.playtime || {})[id] || 0) + info.playedMs };
  const lastPlayed = { ...(c.lastPlayed || {}), [id]: Date.now() };
  store.save({ ...c, recent, playtime, lastPlayed });
  send('game:status', { running: false, last: info });
  send('config:changed', store.get());
  if (c.general.refocusAfterGame) bringToFront();
});
launcher.on('error', (err) => send('toast', { type: 'error', text: String(err.message || err) }));
launcher.on('opened', (st) => { send('game:status', { running: false }); send('toast', { type: 'ok', text: `${st.name} wurde geöffnet` }); });

// ---------- Spiel beenden / Schnellmenü ----------
let lastPadIsPlayStation = false;
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const padLabel = (k) => {
  const t = (lastPadIsPlayStation ? { A: '✕', B: '○', Y: '△' } : { A: 'A', B: 'B', Y: 'Y' })[k];
  return `<b class="k ${lastPadIsPlayStation ? 'ps' : 'xb'} ${k.toLowerCase()}">${t}</b>`;
};

async function closeCurrentGame() {
  debug.info('ablauf', 'Spiel beenden angefordert', launcher.status());
  await resumeGame(); // ein angehaltenes Spiel lässt sich nicht sauber beenden
  const name = launcher.isRunning() ? launcher.status().game.name : (launcher.hasRecent() ? launcher.last.game.name : '');
  if (!name) {
    osd.show('gamepad', 'Kein laufendes Spiel erkannt', '', 2500);
    return false;
  }
  osd.show('stop', `${escHtml(name)} wird beendet …`, '', 0);
  send('toast', { type: 'info', text: `${name} wird beendet …` });
  const ok = await launcher.kill();
  osd.show(ok ? 'check' : 'gamepad', ok ? `${escHtml(name)} beendet` : 'Kein laufendes Spiel erkannt', '', 2000);
  return ok;
}

let quickMenu = null;
let quickMenuClosedAt = 0;
function openQuickMenu() {
  if (quickMenu || Date.now() - quickMenuClosedAt < 400) return;
  if (!launcher.isRunning() && !launcher.hasRecent()) return;
  const name = launcher.isRunning() ? launcher.status().game.name : launcher.last.game.name;
  quickMenu = { openedAt: Date.now(), timer: setTimeout(closeQuickMenu, 10000) };
  if (cfg().controller.quickMenuPause !== false && overlayModeSetting() === 'pause' && launcher.isRunning()) {
    nativeHelper.foreground().then((fg) => {
      const own = [hwndOf(win), overlay.hwnd(), hwndOf(osd.win)];
      if (quickMenu && fg && !own.includes(fg)) { overlayGameHwnd = fg; pauseGame(fg); }
    });
  }
  osd.show('pause', escHtml(name), `${padLabel('A')} Spiel beenden &nbsp;·&nbsp; ${padLabel('X')} Vollbild (F11) &nbsp;·&nbsp; ${padLabel('Y')} Zur Oberfläche &nbsp;·&nbsp; ${padLabel('B')} Weiterspielen`, 0);
}

/** F11 (meist Vollbild an/aus) an das laufende Spiel senden – vorher sicherstellen, dass es den Fokus hat */
async function sendGameKey(vk = 0x7a, label = 'F11') {
  const fg = await nativeHelper.foreground();
  const own = [hwndOf(win), overlay.hwnd(), hwndOf(osd.win)].filter(Boolean);
  if (own.includes(fg) && overlayGameHwnd) {
    nativeHelper.front(overlayGameHwnd, false);
    await new Promise((r) => setTimeout(r, 350));
  }
  debug.info('spiel', `Taste ${label} an das Spiel gesendet`, { vordergrund: fg, spielFenster: overlayGameHwnd });
  nativeHelper.send(`k ${vk} 1`);
  nativeHelper.send(`k ${vk} 0`);
  return true;
}
function closeQuickMenu() {
  if (!quickMenu) return;
  clearTimeout(quickMenu.timer);
  quickMenu = null;
  quickMenuClosedAt = Date.now();
  osd.hide();
  if (!overlay.isVisible()) resumeGame();
}
// PS-/Xbox-Taste: kurz = Schnellmenü (im Spiel), gedrückt halten = Konsolen-Overlay
let guideTimer = null;
let guideHeld = false;
watcher.on('pressed', ({ id, pressed }) => {
  lastPadIsPlayStation = String(id).startsWith('ps:');
  if (pressed & BUTTONS.GUIDE) {
    clearTimeout(guideTimer);
    guideHeld = false;
    if (overlay.isVisible()) { guideHeld = true; closeOverlay(); return; }
    if (cfg().controller.overlayEnabled !== false) {
      guideTimer = setTimeout(() => { guideHeld = true; openOverlay(); }, cfg().controller.overlayHoldMs || 600);
    }
    return;
  }
  if (!quickMenu || Date.now() - quickMenu.openedAt < 250) return;
  if (pressed & BUTTONS.A) { closeQuickMenu(); closeCurrentGame(); }
  else if (pressed & BUTTONS.X) { closeQuickMenu(); setTimeout(() => sendGameKey(), 250); }
  else if (pressed & BUTTONS.Y) { closeQuickMenu(); bringToFront(); }
  else if (pressed & BUTTONS.B) closeQuickMenu();
});
watcher.on('released', ({ released }) => {
  if (!(released & BUTTONS.GUIDE)) return;
  clearTimeout(guideTimer);
  if (guideHeld) { guideHeld = false; return; }
  // Kurz gedrückt: Schnellmenü während eines Spiels
  if (launcher.isRunning() && cfg().controller.guideButton !== 'off' && !overlay.isVisible()) {
    if (quickMenu) closeQuickMenu(); else openQuickMenu();
  }
});

// ---------- Konsolen-Overlay ----------
const sessionStart = { at: 0 };
let overlayGameHwnd = 0; // Spielfenster, das beim Schließen des Overlays wieder nach vorne kommt
let overlayTookFocus = false;
let overlayOpenedAt = 0; // für Clips: die Zeit im Overlay (angehaltenes Spiel) wird weggelassen

// ---------- Spiel anhalten, solange Overlay/Schnellmenü offen sind (keine Eingaben im Spiel) ----------
// Systemprozesse und eigene Fenster werden nie angehalten
const NEVER_PAUSE = /^(explorer|dwm|csrss|winlogon|svchost|lsass|services|smss|wininit|fontdrvhost|sihost|ctfmon|textinputhost|searchhost|searchapp|shellexperiencehost|startmenuexperiencehost|applicationframehost|lockapp|systemsettings|taskmgr|powershell|pwsh|cmd|conhost|windowsterminal|alegamestation|electron|steam|steamwebhelper|epicgameslauncher|galaxyclient|spotify|discord)$/i;
let pausedGame = null; // { pid, name }
function overlayModeSetting() {
  const c = cfg().controller;
  return c.overlayMode || (c.overlayFocus ? 'focus' : 'pause');
}
async function pauseGame(hwnd) {
  if (pausedGame || !hwnd || process.platform !== 'win32') return false;
  const info = (await nativeHelper.request(`pidinfo ${hwnd}`, 3000)).trim();
  const [pidStr, ...rest] = info.split(' ');
  const pid = Number(pidStr);
  const name = rest.join(' ');
  if (!pid || pid === process.pid || NEVER_PAUSE.test(name)) { debug.info('pause', `Nicht angehalten: ${name || 'unbekannt'} (${pid || '-'})`); return false; }
  const r = await nativeHelper.request(`suspend ${pid}`, 3000);
  if (r !== '0') { debug.warn('pause', `Anhalten fehlgeschlagen: ${name} (Code ${r || 'keine Antwort'})`); return false; }
  pausedGame = { pid, name, at: Date.now() };
  debug.info('pause', `Spiel angehalten: ${name} (${pid})`);
  return true;
}
let resuming = Promise.resolve();
function resumeGame() {
  resuming = resuming.then(doResumeGame);
  return resuming;
}
async function doResumeGame() {
  if (!pausedGame) return;
  const { pid, name } = pausedGame;
  pausedGame = null;
  // Mehrfach versuchen – ein angehaltenes Spiel darf nie hängen bleiben
  for (let i = 0; i < 3; i++) {
    const r = await nativeHelper.request(`resume ${pid}`, 3000);
    if (r === '0' || r === '-1') { debug.info('pause', `Spiel fortgesetzt: ${name} (${pid})`); return; }
  }
  debug.error('pause', `Fortsetzen fehlgeschlagen: ${name} (${pid})`);
}
async function openOverlay() {
  const mode = overlayModeSetting();
  overlayOpenedAt = Date.now() - (cfg().controller.overlayHoldMs || 600);
  debug.info('ablauf', 'Overlay öffnen', { modus: mode });
  mouseMode.setActive(false);
  closeQuickMenu();
  osd.hide();
  if (padForwarded) { send('pad:state', { mask: 0, axes: [0, 0, 0, 0] }); padForwarded = false; }
  // Aktuelles Vordergrundfenster merken (das Spiel) – nicht unsere eigenen Fenster
  const fg = await nativeHelper.foreground();
  const own = [hwndOf(win), overlay.hwnd(), hwndOf(osd.win)];
  overlayGameHwnd = fg && !own.includes(fg) ? fg : (launcher.isRunning() ? overlayGameHwnd : 0);
  const display = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : undefined;
  const focus = mode === 'focus';
  overlayTookFocus = focus;
  await overlay.show(display, focus).catch(() => {});
  // Spiel anhalten: bleibt im Vollbild sichtbar, reagiert aber nicht auf den Controller
  if (mode === 'pause' && overlayGameHwnd && overlay.isVisible()) await pauseGame(overlayGameHwnd);
  if (focus) {
    // Ganz nach vorne mit Fokus – auch über Vollbild-Spiele (exklusives Vollbild minimiert sich dabei)
    nativeHelper.front(overlay.hwnd(), true);
    setTimeout(() => { if (overlay.isVisible()) nativeHelper.front(overlay.hwnd(), true); }, 350);
  } else {
    // Nur oben drüberlegen: das Spiel behält den Fokus und bleibt im Vollbild
    nativeHelper.top(overlay.hwnd());
    setTimeout(() => { if (overlay.isVisible()) nativeHelper.top(overlay.hwnd()); }, 350);
  }
}
/** @param {boolean} restoreGame Spiel danach wieder in den Vordergrund holen */
function closeOverlay(restoreGame = true) {
  debug.info('ablauf', 'Overlay schließen', { restoreGame });
  overlay.hide();
  resumeGame();
  if (restoreGame && overlayTookFocus && overlayGameHwnd && launcher.isRunning()) {
    const h = overlayGameHwnd;
    setTimeout(() => nativeHelper.front(h, false), 260);
  }
}

function overlayData() {
  const c = cfg();
  const st = launcher.status();
  const recent = (c.recent || []).map((id) => library.games.find((g) => g.id === id)).filter(Boolean)
    .filter((g) => !(st.running && st.game.id === g.id)).slice(0, 8)
    .map((g) => ({ id: g.id, name: g.name, cover: g.cover || '', system: g.system }));
  // Wenig zuletzt gespielt? Mit Favoriten auffüllen
  for (const id of c.favorites || []) {
    if (recent.length >= 8) break;
    const g = library.games.find((x) => x.id === id);
    if (g && !recent.some((r) => r.id === g.id) && !(st.running && st.game.id === g.id)) recent.push({ id: g.id, name: g.name, cover: g.cover || '', system: g.system });
  }
  const running = st.running ? { ...st.game, startedAt: st.startedAt, cover: (library.games.find((g) => g.id === st.game.id) || {}).cover || '' } : null;
  return { running, recent, systems: library.systems.map((s) => ({ id: s.id, short: s.short, color: s.color })), mouseMode: mouseMode.active, ps: lastPadIsPlayStation };
}

async function overlayAction(a) {
  switch (a.type) {
    case 'resume': closeOverlay(true); return true;
    case 'home': closeOverlay(false); bringToFront(); return true;
    case 'quit': closeOverlay(false); return closeCurrentGame();
    case 'launch': {
      const game = library.games.find((g) => g.id === a.id);
      if (!game) throw new Error('Spiel nicht gefunden');
      closeOverlay(false);
      if (launcher.isRunning()) {
        await closeCurrentGame();
        // Sicherstellen, dass das alte Spiel wirklich weg ist (max. 8 s)
        for (let i = 0; i < 40 && launcher.isRunning(); i++) await new Promise((r) => setTimeout(r, 200));
        if (launcher.isRunning()) throw new Error('Das laufende Spiel ließ sich nicht beenden');
      }
      osd.show('play', `${escHtml(game.name)} wird gestartet …`, '', 2500);
      return launcher.launch(game, (url) => shell.openExternal(url));
    }
    case 'spotify':
      if (a.cmd === 'open') {
        // Im Hintergrund starten (minimiert), nur notfalls normal öffnen
        if (!spotify.startApp()) await shell.openExternal('spotify:');
        return true;
      }
      if (a.cmd === 'play') { await spotify.play(a.uri); return true; }
      if (spotify.isConnected()) {
        try { await spotify.control(a.cmd); return true; } catch (err) {
          // Ohne Premium/aktives Gerät: auf Medientasten ausweichen (funktioniert mit jeder Spotify-Version)
          if (!['playpause', 'next', 'prev'].includes(a.cmd)) throw err;
        }
      }
      return media.mediaKey((l) => mouseMode.send(l), a.cmd);
    case 'volume': return media.mediaKey((l) => mouseMode.send(l), a.cmd);
    case 'mouse': closeOverlay(); mouseMode.toggle(); return mouseMode.active;
    case 'clip': {
      // Clip endet beim Öffnen des Overlays – das angehaltene Spiel und das Menü sind nicht drin
      const endAgo = overlayOpenedAt ? (Date.now() - overlayOpenedAt) / 1000 : 0;
      return aleclip.saveReplay(Number(a.seconds) || 0, endAgo);
    }
    case 'clipShot': return aleclip.command('screenshot');
    case 'clipRecord': return aleclip.command('toggle_record');
    case 'clipReplay': return aleclip.command('set_replay', { enabled: !!a.enabled });
    case 'clipStart': return aleclip.start();
    case 'f11':
      // Overlay schließen (Spiel bekommt ggf. den Fokus zurück), dann F11 senden
      closeOverlay(true);
      setTimeout(() => sendGameKey(), overlayTookFocus ? 700 : 300);
      return true;
    default: return false;
  }
}
ipcMain.handle('overlay:data', () => overlayData());
ipcMain.handle('overlay:spotify', async () => {
  if (spotify.isConnected()) {
    try { return { ...(await spotify.now()), api: true }; } catch (err) {
      return { ...(await media.spotifyInfo()), api: true, error: err.message };
    }
  }
  return media.spotifyInfo();
});
ipcMain.handle('overlay:aleclip', async () => ({ ...(await aleclip.status()), lengths: cfg().aleclip.clipLengths || [15, 30, 60, 120, 300] }));
ipcMain.handle('aleclip:status', async () => ({ ...(await aleclip.status()), exe: aleclip.findExe() }));
ipcMain.handle('aleclip:start', () => aleclip.start());
ipcMain.handle('overlay:playlists', async () => (spotify.isConnected() ? spotify.playlists() : []));
ipcMain.handle('spotify:status', () => spotify.status());
ipcMain.handle('spotify:connect', () => spotify.connect());
ipcMain.handle('spotify:disconnect', () => { spotify.disconnect(); return true; });
ipcMain.handle('spotify:test', () => spotify.now());
ipcMain.handle('spotify:dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));
ipcMain.handle('overlay:action', (_e, a) => overlayAction(a || {}));


watcher.on('combo', async ({ name }) => {
  if (name === 'closeGame') {
    await closeCurrentGame();
  } else if (name === 'showLauncher') {
    bringToFront();
  } else if (name === 'mouseMode') {
    mouseMode.toggle();
  }
});
watcher.on('connection', (c) => send('gamepad:connection', c));
watcher.on('state', (s) => {
  mouseMode.update(s);
  // Xbox-Controller (XInput) steuern das Overlay ebenfalls direkt
  if (overlay.isVisible() && String(s.id).startsWith('xinput:')) overlay.send('pad:state', { mask: s.mask, axes: s.axes });
});
// PlayStation-Controller direkt an die Oberfläche weitergeben (Chromium kann DualSense per Bluetooth
// im erweiterten Modus nicht lesen). Nur wenn die Oberfläche bedient werden darf – nie während eines Spiels im Hintergrund.
let padForwarded = false;
function uiAcceptsController() {
  if (!win || win.isDestroyed() || mouseMode.active || overlay.isVisible()) return false;
  if (win.isFocused()) return true;
  return win.isVisible() && !win.isMinimized() && !launcher.isRunning();
}
psWatcher.on('state', (s) => {
  mouseMode.update(s);
  if (overlay.isVisible()) overlay.send('pad:state', { mask: s.mask, axes: s.axes });
  if (uiAcceptsController()) {
    // Windows gibt der Oberfläche beim Autostart nicht immer den Fokus – beim ersten Tastendruck holen
    if (s.mask > 0 && !win.isFocused()) bringToFront();
    send('pad:state', { mask: s.mask, axes: s.axes });
    padForwarded = true;
  } else if (padForwarded) {
    send('pad:state', { mask: 0, axes: [0, 0, 0, 0] }); // gedrückte Tasten loslassen
    padForwarded = false;
  }
});
psWatcher.on('touch', (t) => touchpad.update(t.id, t.touch, t.button));

// ---------- Maus- & Tastatursteuerung ----------
function comboText(combo, ps) {
  const map = ps ? { BACK: 'Create', START: 'Options', A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', GUIDE: 'PS' } : { BACK: 'View', START: 'Menu' };
  return String(combo || '').split('+').map((k) => map[k] || k).join(' + ');
}
mouseMode.on('active', (on) => {
  send('mousemode', on);
  const ps = psWatcher.devices && psWatcher.devices.size > 0;
  if (on) osd.show('mouse', 'Maus- & Tastatursteuerung aktiv', `${comboText(cfg().controller.mouseModeCombo, ps)} zum Beenden`, 0);
  else osd.show('gamepad', 'Controller-Steuerung', '', 1500);
});
mouseMode.on('keyboard', () => mouseMode.toggleKeyboard());

function startPlayStationWatcher() {
  if (cfg().controller.playstationHid === false) return;
  psWatcher.start();
}
psWatcher.on('buttons', ({ id, mask }) => watcher._update('ps:' + id, mask));
psWatcher.on('connection', (c) => send('gamepad:connection', { ...c, source: 'hid', count: psWatcher.devices.size }));

// ---------- IPC ----------
ipcMain.handle('config:get', () => store.get());
ipcMain.handle('config:defaults', () => DEFAULT_CONFIG);
ipcMain.handle('config:save', (_e, data) => {
  const saved = store.save(data);
  applyCombos();
  if (saved.controller.playstationHid === false) psWatcher.stop(); else psWatcher.start();
  applyAutostart();
  placeWindow();
  return saved;
});
ipcMain.handle('config:path', () => store.file);
ipcMain.handle('config:openFile', () => shell.openPath(store.file));

ipcMain.handle('library:get', () => library);
ipcMain.handle('library:refresh', () => refreshLibrary());
ipcMain.handle('emulators:detect', () => {
  const c = structuredClone(store.get());
  const changes = detectEmulators(c);
  if (changes.length) store.save(c);
  refreshLibrary();
  return { changes, config: store.get(), library };
});

ipcMain.handle('game:launch', async (_e, id) => {
  const game = id === 'steam-bigpicture' ? { id, type: 'bigpicture', name: 'Steam Big Picture' } : library.games.find((g) => g.id === id);
  if (!game) throw new Error('Spiel nicht gefunden');
  return launcher.launch(game, (url) => shell.openExternal(url));
});
ipcMain.handle('game:kill', () => launcher.kill());
ipcMain.handle('game:status', () => launcher.status());

ipcMain.handle('system:power', async (_e, action) => {
  if (action === 'exit') {
    quitting = true;
    await leaveConsoleMode();
    app.quit();
    return true;
  }
  if (['shutdown', 'restart'].includes(action)) {
    const opts = { shutdown: action === 'shutdown', restart: action === 'restart' };
    if (cfg().display.restoreBeforeShutdown) await leaveConsoleMode(opts);
    else {
      await perf.restore(true);
      if (opts.shutdown) await ha.onExit({ shutdown: true }).catch(() => {});
    }
  }
  return system.power(action);
});
ipcMain.handle('system:displayMode', (_e, mode) => system.setDisplayMode(mode));
ipcMain.handle('displays:list', () => listDisplays());
ipcMain.handle('displays:identify', () => identifyDisplays());
ipcMain.handle('displays:tvOnly', (_e, mode) => applyTvOnly(true, mode === 'primary' ? 'primary' : 'only'));
ipcMain.handle('displays:restore', async () => { await restoreDisplays('extend'); return true; });
ipcMain.handle('system:displays', () => screen.getAllDisplays().map((d, i) => ({ index: i, label: d.label || `Bildschirm ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })));
ipcMain.handle('pad:hidCount', () => psWatcher.devices.size);
// Bekannte Emulatoren (Vollbild-Argumente, empfohlene Start-Argumente) für die Oberfläche
ipcMain.handle('emulators:profiles', () => require('./emulator-profiles').PROFILES.map((p) => ({
  id: p.id, match: p.match.source, name: p.name, fullscreen: p.fullscreen, has: p.has ? p.has.source : '', hasFlags: p.has ? p.has.flags : '', note: p.note || '', args: p.args
})));

// ---------- Debug-Modus ----------
ipcMain.handle('debug:log', (_e, entry) => {
  const e = entry || {};
  debug.write(['error', 'warn'].includes(e.level) ? e.level : 'info', String(e.source || 'oberfläche').slice(0, 30), String(e.message || '').slice(0, 2000), e.data);
  return true;
});
ipcMain.handle('debug:state', () => ({ enabled: debug.enabled, errors: debug.errors, warnings: debug.warnings, file: debug.file }));
ipcMain.handle('debug:openFolder', () => shell.openPath(path.dirname(debug.file)));
ipcMain.handle('debug:report', async () => {
  const os = require('os');
  const rawDisplays = await nativeHelper.request('displays', 15000).catch(() => '');
  const displays = await listDisplays().catch((err) => ({ fehler: err.message }));
  const lib = library || { games: [], systems: [] };
  const sections = [
    ['System', {
      app: app.getVersion(), installiert: app.isPackaged, electron: process.versions.electron, chrome: process.versions.chrome,
      windows: `${os.type()} ${os.release()} ${os.arch()}`, cpu: (os.cpus()[0] || {}).model, ramGB: Math.round(os.totalmem() / 1073741824),
      start: process.argv.slice(1).join(' '), laufzeitMin: Math.round(process.uptime() / 60)
    }],
    ['Bildschirme (App)', displays],
    ['Bildschirme (Windows-Rohdaten)', rawDisplays || '(keine Antwort vom Hilfsprogramm)'],
    ['Bildschirme (Electron)', screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, bounds: d.bounds, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }))],
    ['Fernseher-Zustand', { tvOnlyState: tvOnlyState ? { ...tvOnlyState, saved: tvOnlyState.saved ? `(${tvOnlyState.saved.length} Zeichen)` : '' } : null, displaySwitched }],
    ['Controller', { playstationHid: [...psWatcher.devices.values()].map((d) => ({ name: d.name || d.product, type: d.type, bt: d.bt })), mausmodus: mouseMode.active }],
    ['Spiel', launcher.status()],
    ['Bibliothek', { spiele: lib.games.length, ausgeblendet: lib.games.filter((g) => g.hidden).length, systeme: lib.systems.map((x) => `${x.id}: ${x.count ?? ''}`) }],
    ['Spotify', spotify.status()],
    ['Update', updater ? updater.get() : null],
    ['Einstellungen (ohne Passwörter/Tokens)', cfg()]
  ];
  const file = debug.writeReport(app.getPath('desktop'), sections);
  debug.info('debug', 'Bericht erstellt: ' + file);
  shell.showItemInFolder(file);
  return file;
});
ipcMain.handle('ha:test', () => ha.test());
// Emulator eines Systems ohne Spiel starten (z.B. zum Einrichten)
ipcMain.handle('emulator:launch', (_e, systemId) => {
  const c = cfg();
  // "emu:<id>" = Emulator ohne Konsole
  const sys = String(systemId).startsWith('emu:') ? { emulator: String(systemId).slice(4) } : c.systems.find((s) => s.id === systemId);
  const emu = sys && c.emulators.find((e) => e.id === sys.emulator);
  if (!emu || !emu.exe) throw new Error('Für dieses System ist kein Emulator eingestellt');
  if (!fs.existsSync(emu.exe)) throw new Error(`Emulator nicht gefunden: ${emu.exe}`);
  return launcher.launch({ id: 'emu-' + emu.id, type: 'pc', system: systemId, name: emu.name, exe: emu.exe, args: '', cwd: path.dirname(emu.exe), killMode: 'dir' });
});
// ROM-Ordner im Explorer öffnen (wird bei Bedarf angelegt)
ipcMain.handle('system:openRomDir', async (_e, systemId) => {
  const sys = cfg().systems.find((s) => s.id === systemId);
  const dir = sys && (sys.romDirs || [])[0];
  if (!dir) throw new Error('Für dieses System ist kein ROM-Ordner eingetragen');
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return dir;
});
ipcMain.handle('ha:tv', async (_e, on) => (on ? ha.tvOn() : ha.tvOff()));
ipcMain.handle('mouse:toggle', () => mouseMode.toggle());
ipcMain.handle('scrape:start', (_e, opts = {}) => {
  // Alle Spiele mit Bildquelle: ROMs, Steam, Epic, GOG, eigene Programme
  let games = library.games.filter((g) => ['rom', 'steam', 'epic', 'pc'].includes(g.type));
  if (opts.ids) games = games.filter((g) => opts.ids.includes(g.id));
  else if (opts.system) games = games.filter((g) => g.system === opts.system);
  if (!opts.force && !opts.ids) games = games.filter((g) => !g.cover || !g.hero);
  if (!games.length) return { total: 0, finished: true, found: 0, missing: 0, errors: 0 };
  return scrapeGames(games, { force: !!opts.force });
});
ipcMain.handle('scrape:cancel', () => { if (scraper) scraper.cancel(); return true; });
ipcMain.handle('scrape:mediaDir', () => mediaDir());
ipcMain.handle('performance:recommended', () => RECOMMENDED);
ipcMain.handle('performance:running', () => listRunning());
ipcMain.handle('system:info', () => ({ platform: process.platform, version: app.getVersion(), watcher: process.platform === 'win32' }));

ipcMain.handle('update:get', () => (updater ? updater.get() : { status: 'idle', version: app.getVersion() }));
ipcMain.handle('update:check', () => (updater ? updater.check() : null));
ipcMain.handle('update:download', () => (updater ? updater.download() : false));
ipcMain.handle('update:openPage', (_e, url) => {
  // Nur GitHub-Links dieses Projekts öffnen
  const target = String(url || '');
  if (/^https:\/\/github\.com\/AleB-Roni\/AleGamestation\//i.test(target)) return shell.openExternal(target);
  return shell.openExternal('https://github.com/AleB-Roni/AleGamestation/releases/latest');
});
ipcMain.handle('update:install', async () => {
  if (!updater || updater.get().status !== 'ready') return false;
  // Anzeige vorher wiederherstellen, dann Installer starten (App startet danach automatisch neu)
  quitting = true;
  watcher.stop();
  psWatcher.stop();
  await leaveConsoleMode();
  return updater.install();
});

ipcMain.handle('dialog:pickFile', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: opts.filters || [{ name: 'Programme', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- App-Lebenszyklus ----------
// Nur für automatische Tests (AGS_TEST=1): Zugriff auf interne Objekte
if (process.env.AGS_TEST === '1') global.__ags = { watcher, launcher, osd, overlay, psWatcher };

app.on('second-instance', () => bringToFront());

app.whenReady().then(async () => {
  store.load();
  applyAutostart();
  applyCombos();
  powerSaveBlocker.start('prevent-display-sleep');
  // Bildschirmliste vorab laden, damit "Oberfläche auf dem Fernseher" den richtigen Monitor findet
  const listing = listDisplays().catch(() => []);
  if (cfg().general.targetDisplay === 'tv') await listing;
  await enterConsoleMode();
  refreshLibrary();
  createWindow();
  watcher.start();
  startPlayStationWatcher();
  // Hintergrundprogramme pausieren/schließen (läuft parallel, blockiert den Start nicht)
  perfPromise = perf.apply(cfg()).then((list) => {
    if (list.length) send('toast', { type: 'info', text: `Leistungsmodus: ${list.join(', ')} pausiert/beendet` });
    return list;
  }).catch(() => []);
  setTimeout(autoScrape, 8000);
  // Erst über Chromium (System-Proxy), bei Fehlern über Node erneut versuchen
  const robustFetch = async (u, o) => {
    try { const r = await net.fetch(u, o); if (r.ok) return r; } catch { /* Fallback */ }
    return globalThis.fetch(u, o);
  };
  updater = new Updater({ version: app.getVersion(), isPackaged: app.isPackaged, fetch: robustFetch, getConfig: cfg });
  updater.on('state', (s) => send('update:state', s));
  // Beim Start und danach alle 6 Stunden auf GitHub nach Updates suchen
  if (cfg().general.autoUpdate !== false) {
    setTimeout(() => updater.check(), 5000);
    setInterval(() => { if (cfg().general.autoUpdate !== false && !launcher.isRunning()) updater.check(); }, 6 * 3600 * 1000);
  }
  // Wenn Windows die Bildschirme ändert (TV an/aus), Fenster neu platzieren
  const relist = () => setTimeout(() => listDisplays().catch(() => {}).then(placeWindow), 800);
  screen.on('display-added', relist);
  screen.on('display-removed', relist);
  screen.on('display-metrics-changed', () => setTimeout(placeWindow, 800));
});

app.on('before-quit', async (e) => {
  if (pausedGame) { e.preventDefault(); await resumeGame(); app.quit(); return; }
  watcher.stop();
  psWatcher.stop();
  mouseMode.stop();
  nativeHelper.stop();
  osd.destroy();
  overlay.destroy();
  if (!quitting && (displaySwitched || perf.applied.length || perf.previousPlan || ha.ready())) {
    e.preventDefault();
    quitting = true;
    await leaveConsoleMode();
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
