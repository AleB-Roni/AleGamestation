'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getDefaults: () => ipcRenderer.invoke('config:defaults'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  configPath: () => ipcRenderer.invoke('config:path'),
  openConfigFile: () => ipcRenderer.invoke('config:openFile'),

  getLibrary: () => ipcRenderer.invoke('library:get'),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
  detectEmulators: () => ipcRenderer.invoke('emulators:detect'),
  emulatorProfiles: () => ipcRenderer.invoke('emulators:profiles'),

  launch: (id) => ipcRenderer.invoke('game:launch', id),
  kill: () => ipcRenderer.invoke('game:kill'),
  gameStatus: () => ipcRenderer.invoke('game:status'),

  power: (action, extra) => ipcRenderer.invoke('system:power', action, extra),
  setDisplayMode: (mode) => ipcRenderer.invoke('system:displayMode', mode),
  displays: () => ipcRenderer.invoke('system:displays'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  tvStatus: () => ipcRenderer.invoke('tv:status'),
  activateTv: () => ipcRenderer.invoke('tv:activate'),
  listAudio: () => ipcRenderer.invoke('audio:list'),
  applyAudio: () => ipcRenderer.invoke('audio:apply'),
  restoreAudio: () => ipcRenderer.invoke('audio:restore'),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'),
  tvOnly: (mode) => ipcRenderer.invoke('displays:tvOnly', mode),
  restoreDisplays: () => ipcRenderer.invoke('displays:restore'),
  info: () => ipcRenderer.invoke('system:info'),
  scrape: (opts) => ipcRenderer.invoke('scrape:start', opts),
  haTest: () => ipcRenderer.invoke('ha:test'),
  launchEmulator: (systemId) => ipcRenderer.invoke('emulator:launch', systemId),
  openRomDir: (systemId) => ipcRenderer.invoke('system:openRomDir', systemId),
  haTv: (on) => ipcRenderer.invoke('ha:tv', on),
  toggleMouseMode: () => ipcRenderer.invoke('mouse:toggle'),
  onMouseMode: on('mousemode'),
  cancelScrape: () => ipcRenderer.invoke('scrape:cancel'),
  mediaDir: () => ipcRenderer.invoke('scrape:mediaDir'),
  onScrapeProgress: on('scrape:progress'),
  onLibraryChanged: on('library:changed'),
  recommendedPrograms: () => ipcRenderer.invoke('performance:recommended'),
  runningPrograms: () => ipcRenderer.invoke('performance:running'),

  updateState: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  openUpdatePage: (url) => ipcRenderer.invoke('update:openPage', url),
  onUpdateState: on('update:state'),

  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  onGameStatus: on('game:status'),
  onConfigChanged: on('config:changed'),
  onToast: on('toast'),
  onWindowFocus: on('window:focus'),
  onNavCommand: on('nav:command'),
  appMode: () => ipcRenderer.invoke('app:mode'),
  createSetupShortcut: () => ipcRenderer.invoke('app:setupShortcut'),
  startConsoleMode: () => ipcRenderer.invoke('app:startConsoleMode'),
  onOpenSettings: on('app:openSettings'),
  onAskExit: on('app:askExit'),
  onGamepadConnection: on('gamepad:connection'),
  onPadState: on('pad:state'),
  // Konsolen-Overlay
  overlayData: () => ipcRenderer.invoke('overlay:data'),
  overlaySpotify: () => ipcRenderer.invoke('overlay:spotify'),
  overlayAction: (a) => ipcRenderer.invoke('overlay:action', a),
  overlayPlaylists: () => ipcRenderer.invoke('overlay:playlists'),
  overlayAleClip: () => ipcRenderer.invoke('overlay:aleclip'),
  aleclipStatus: () => ipcRenderer.invoke('aleclip:status'),
  aleclipStart: () => ipcRenderer.invoke('aleclip:start'),
  spotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  spotifyConnect: () => ipcRenderer.invoke('spotify:connect'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify:disconnect'),
  spotifyTest: () => ipcRenderer.invoke('spotify:test'),
  spotifyDashboard: () => ipcRenderer.invoke('spotify:dashboard'),
  onOverlayOpen: on('overlay:open'),
  onOverlayClose: on('overlay:close'),
  onOverlayRefresh: on('overlay:refresh'),
  hidControllers: () => ipcRenderer.invoke('pad:hidCount'),
  // Debug-Modus
  debugLog: (entry) => ipcRenderer.invoke('debug:log', entry),
  debugState: () => ipcRenderer.invoke('debug:state'),
  debugReport: () => ipcRenderer.invoke('debug:report'),
  debugOpenFolder: () => ipcRenderer.invoke('debug:openFolder'),
  onDebugEvent: on('debug:event')
});
