'use strict';
/**
 * Konsolen-Overlay über dem laufenden Spiel (PS-/Xbox-Taste gedrückt halten).
 * Durchsichtiges Vollbild-Fenster ganz oben; die Bedienung kommt vom Controller über den Hauptprozess.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

class Overlay {
  constructor({ preload }) {
    this.preload = preload;
    this.win = null;
    this.visible = false;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve(this.win);
    this.win = new BrowserWindow({
      show: false, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
      fullscreenable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true);
    this.win.on('closed', () => { this.win = null; this.visible = false; });
    return this.win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html')).then(() => this.win);
  }

  isVisible() {
    return this.visible && !!this.win && !this.win.isDestroyed();
  }

  async show(display) {
    const win = await this._ensure();
    const d = display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setBounds(d.bounds);
    this.visible = true;
    win.webContents.send('overlay:open');
    win.show();
    // Fokus holen, damit das Spiel keine Eingaben bekommt (viele Spiele pausieren dann)
    win.focus();
    win.webContents.focus();
  }

  hide() {
    if (!this.isVisible()) return;
    this.visible = false;
    this.win.webContents.send('overlay:close');
    // Erst ausblenden lassen (Animation), dann Fenster verstecken
    setTimeout(() => { if (this.win && !this.win.isDestroyed() && !this.visible) this.win.hide(); }, 220);
  }

  send(channel, payload) {
    if (this.isVisible()) this.win.webContents.send(channel, payload);
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { Overlay };
