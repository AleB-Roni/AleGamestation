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

// Nur eine Instanz erlauben
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new ConfigStore(app.getPath('userData'));
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
const ha = new HomeAssistant({ fetch: (url, opts) => net.fetch(url, opts), getConfig: () => store.get(), log: (m) => send('toast', { type: 'info', text: m }) });
const mouseMode = new MouseMode({ getConfig: () => store.get() });
const osd = new Osd();
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
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function targetDisplay() {
  const displays = screen.getAllDisplays();
  const t = cfg().general.targetDisplay;
  if (t !== 'primary' && displays[Number(t)]) return displays[Number(t)];
  return screen.getPrimaryDisplay();
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
  setTimeout(() => win && !win.isDestroyed() && win.setAlwaysOnTop(false), 400);
}

function applyCombos() {
  const c = cfg().controller;
  watcher.setCombos([
    { name: 'closeGame', combo: c.closeGameCombo, holdMs: c.comboHoldMs },
    { name: 'showLauncher', combo: c.showLauncherCombo, holdMs: c.comboHoldMs },
    { name: 'mouseMode', combo: c.mouseModeCombo, holdMs: Math.min(c.comboHoldMs, 600) },
    ...(c.guideButton === 'off' ? [] : [{ name: 'guideMenu', combo: 'GUIDE', holdMs: 0 }])
  ]);
}

function applyAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { app.setLoginItemSettings({ openAtLogin: !!cfg().general.autostartWithWindows, args: [] }); } catch { /* ignore */ }
  }
}

async function enterConsoleMode() {
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
  if (!skipDisplaySwitch && d.onStart && d.onStart !== 'none') {
    const r = await system.setDisplayMode(d.onStart);
    if (r.ok) {
      displaySwitched = true;
      await new Promise((res) => setTimeout(res, d.switchDelayMs || 2500));
    }
  }
}

async function leaveConsoleMode(opts = {}) {
  const d = cfg().display;
  mouseMode.setActive(false);
  await perfPromise;
  await perf.restore(!!opts.shutdown);
  if (displaySwitched && d.onExit && d.onExit !== 'none') {
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
    scraper = new Scraper({ mediaDir: mediaDir(), getConfig: cfg, fetch: (url, opts) => net.fetch(url, opts) });
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
  const todo = library.games.filter((g) => g.type === 'rom' && !g.cover);
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
  win.on('closed', () => { win = null; osd.destroy(); });
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => { for (const n of startupNotes.splice(0)) send('toast', n); }, 1500);
  });
  win.on('focus', () => send('window:focus', true));
  win.on('blur', () => send('window:focus', false));
}

// ---------- Launcher-Events ----------
launcher.on('started', (status) => {
  send('game:status', status);
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
  const name = launcher.isRunning() ? launcher.status().game.name : (launcher.hasRecent() ? launcher.last.game.name : '');
  if (!name) {
    osd.show('🎮', 'Kein laufendes Spiel erkannt', '', 2500);
    return false;
  }
  osd.show('⏹', `${escHtml(name)} wird beendet …`, '', 0);
  send('toast', { type: 'info', text: `${name} wird beendet …` });
  const ok = await launcher.kill();
  osd.show(ok ? '✔' : '🎮', ok ? `${escHtml(name)} beendet` : 'Kein laufendes Spiel erkannt', '', 2000);
  return ok;
}

let quickMenu = null;
let quickMenuClosedAt = 0;
function openQuickMenu() {
  if (quickMenu || Date.now() - quickMenuClosedAt < 400) return;
  if (!launcher.isRunning() && !launcher.hasRecent()) return;
  const name = launcher.isRunning() ? launcher.status().game.name : launcher.last.game.name;
  quickMenu = { openedAt: Date.now(), timer: setTimeout(closeQuickMenu, 10000) };
  osd.show('⏸', escHtml(name), `${padLabel('A')} Spiel beenden &nbsp;·&nbsp; ${padLabel('Y')} Zur Oberfläche &nbsp;·&nbsp; ${padLabel('B')} Weiterspielen`, 0);
}
function closeQuickMenu() {
  if (!quickMenu) return;
  clearTimeout(quickMenu.timer);
  quickMenu = null;
  quickMenuClosedAt = Date.now();
  osd.hide();
}
watcher.on('pressed', ({ id, pressed }) => {
  lastPadIsPlayStation = String(id).startsWith('ps:');
  if (!quickMenu || Date.now() - quickMenu.openedAt < 250) return;
  if (pressed & BUTTONS.A) { closeQuickMenu(); closeCurrentGame(); }
  else if (pressed & BUTTONS.Y) { closeQuickMenu(); bringToFront(); }
  else if (pressed & (BUTTONS.B | BUTTONS.GUIDE)) closeQuickMenu();
});

watcher.on('combo', async ({ name }) => {
  if (name === 'closeGame') {
    await closeCurrentGame();
  } else if (name === 'guideMenu') {
    // Nur während ein Spiel läuft – sonst öffnet die PS-Taste in der Oberfläche das normale Menü
    if (launcher.isRunning()) openQuickMenu();
  } else if (name === 'showLauncher') {
    bringToFront();
  } else if (name === 'mouseMode') {
    mouseMode.toggle();
  }
});
watcher.on('connection', (c) => send('gamepad:connection', c));
watcher.on('state', (s) => mouseMode.update(s));
// PlayStation-Controller direkt an die Oberfläche weitergeben (Chromium kann DualSense per Bluetooth
// im erweiterten Modus nicht lesen). Nur wenn die Oberfläche bedient werden darf – nie während eines Spiels im Hintergrund.
let padForwarded = false;
function uiAcceptsController() {
  if (!win || win.isDestroyed() || mouseMode.active) return false;
  if (win.isFocused()) return true;
  return win.isVisible() && !win.isMinimized() && !launcher.isRunning();
}
psWatcher.on('state', (s) => {
  mouseMode.update(s);
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
  if (on) osd.show('🖱', 'Maus- & Tastatursteuerung aktiv', `${comboText(cfg().controller.mouseModeCombo, ps)} zum Beenden`, 0);
  else osd.show('🎮', 'Controller-Steuerung', '', 1500);
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
ipcMain.handle('system:displays', () => screen.getAllDisplays().map((d, i) => ({ index: i, label: d.label || `Bildschirm ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })));
ipcMain.handle('pad:hidCount', () => psWatcher.devices.size);
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
  let games = library.games.filter((g) => g.type === 'rom');
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
if (process.env.AGS_TEST === '1') global.__ags = { watcher, launcher, osd };

app.on('second-instance', () => bringToFront());

app.whenReady().then(async () => {
  store.load();
  applyAutostart();
  applyCombos();
  powerSaveBlocker.start('prevent-display-sleep');
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
  screen.on('display-added', () => setTimeout(placeWindow, 800));
  screen.on('display-removed', () => setTimeout(placeWindow, 800));
  screen.on('display-metrics-changed', () => setTimeout(placeWindow, 800));
});

app.on('before-quit', async (e) => {
  watcher.stop();
  psWatcher.stop();
  mouseMode.stop();
  osd.destroy();
  if (!quitting && (displaySwitched || perf.applied.length || perf.previousPlan || ha.ready())) {
    e.preventDefault();
    quitting = true;
    await leaveConsoleMode();
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
