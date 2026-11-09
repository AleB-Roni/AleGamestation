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

  launch: (id) => ipcRenderer.invoke('game:launch', id),
  kill: () => ipcRenderer.invoke('game:kill'),
  gameStatus: () => ipcRenderer.invoke('game:status'),

  power: (action) => ipcRenderer.invoke('system:power', action),
  setDisplayMode: (mode) => ipcRenderer.invoke('system:displayMode', mode),
  displays: () => ipcRenderer.invoke('system:displays'),
  info: () => ipcRenderer.invoke('system:info'),

  updateState: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: on('update:state'),

  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  onGameStatus: on('game:status'),
  onConfigChanged: on('config:changed'),
  onToast: on('toast'),
  onWindowFocus: on('window:focus'),
  onGamepadConnection: on('gamepad:connection')
});
