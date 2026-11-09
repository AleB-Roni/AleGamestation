'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const { ConfigStore, DEFAULT_CONFIG } = require('./config');
const { scanLibrary, detectEmulators } = require('./library');
const { Launcher } = require('./launcher');
const { GamepadWatcher } = require('./gamepad-watcher');
const system = require('./system');
const { Updater } = require('./updater');

// Nur eine Instanz erlauben
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const store = new ConfigStore(app.getPath('userData'));
const launcher = new Launcher(() => store.get());
const watcher = new GamepadWatcher();
let updater = null;
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
    { name: 'showLauncher', combo: c.showLauncherCombo, holdMs: c.comboHoldMs }
  ]);
}

function applyAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { app.setLoginItemSettings({ openAtLogin: !!cfg().general.autostartWithWindows, args: [] }); } catch { /* ignore */ }
  }
}

async function enterConsoleMode() {
  const d = cfg().display;
  await system.runCommands(d.customCommandsOnStart);
  if (!skipDisplaySwitch && d.onStart && d.onStart !== 'none') {
    const r = await system.setDisplayMode(d.onStart);
    if (r.ok) {
      displaySwitched = true;
      await new Promise((res) => setTimeout(res, d.switchDelayMs || 2500));
    }
  }
}

async function leaveConsoleMode() {
  const d = cfg().display;
  if (displaySwitched && d.onExit && d.onExit !== 'none') {
    await system.setDisplayMode(d.onExit);
    displaySwitched = false;
  }
  await system.runCommands(d.customCommandsOnExit);
}

function refreshLibrary() {
  library = scanLibrary(cfg());
  return library;
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
  win.on('closed', () => { win = null; });
  win.on('focus', () => send('window:focus', true));
  win.on('blur', () => send('window:focus', false));
}

// ---------- Launcher-Events ----------
launcher.on('started', (status) => {
  send('game:status', status);
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

watcher.on('combo', async ({ name }) => {
  if (name === 'closeGame' && launcher.isRunning()) {
    send('toast', { type: 'info', text: 'Spiel wird beendet …' });
    await launcher.kill();
  } else if (name === 'showLauncher') {
    bringToFront();
  }
});
watcher.on('connection', (c) => send('gamepad:connection', c));

// ---------- IPC ----------
ipcMain.handle('config:get', () => store.get());
ipcMain.handle('config:defaults', () => DEFAULT_CONFIG);
ipcMain.handle('config:save', (_e, data) => {
  const saved = store.save(data);
  applyCombos();
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
  if (['shutdown', 'restart'].includes(action) && cfg().display.restoreBeforeShutdown) await leaveConsoleMode();
  return system.power(action);
});
ipcMain.handle('system:displayMode', (_e, mode) => system.setDisplayMode(mode));
ipcMain.handle('system:displays', () => screen.getAllDisplays().map((d, i) => ({ index: i, label: d.label || `Bildschirm ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })));
ipcMain.handle('system:info', () => ({ platform: process.platform, version: app.getVersion(), watcher: process.platform === 'win32' }));

ipcMain.handle('update:get', () => (updater ? updater.get() : { status: 'idle', version: app.getVersion() }));
ipcMain.handle('update:check', () => (updater ? updater.check() : null));
ipcMain.handle('update:install', async () => {
  if (!updater || updater.get().status !== 'ready') return false;
  // Anzeige vorher wiederherstellen, dann Installer starten (App startet danach automatisch neu)
  quitting = true;
  watcher.stop();
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
  updater = new Updater();
  updater.on('state', (s) => send('update:state', s));
  if (cfg().general.autoUpdate !== false) setTimeout(() => updater.check(), 5000);
  // Wenn Windows die Bildschirme ändert (TV an/aus), Fenster neu platzieren
  screen.on('display-added', () => setTimeout(placeWindow, 800));
  screen.on('display-removed', () => setTimeout(placeWindow, 800));
  screen.on('display-metrics-changed', () => setTimeout(placeWindow, 800));
});

app.on('before-quit', async (e) => {
  watcher.stop();
  if (!quitting && displaySwitched) {
    e.preventDefault();
    quitting = true;
    await leaveConsoleMode();
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
