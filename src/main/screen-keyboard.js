'use strict';
/**
 * Bildschirmtastatur für den Controller: kleines Fenster unten auf dem Bildschirm, ganz oben, ohne Fokus –
 * das Spiel/Programm behält den Fokus und bekommt die getippten Zeichen. Bedienung kommt vom Hauptprozess (pad:state).
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

class ScreenKeyboard {
  constructor({ preload }) {
    this.preload = preload;
    this.win = null;
    this.visible = false;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve(this.win);
    this.win = new BrowserWindow({
      show: false, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, focusable: false,
      fullscreenable: false, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setContentProtection(true); // nicht in Aufnahmen/Clips
    this.win.setVisibleOnAllWorkspaces(true);
    this.win.on('closed', () => { this.win = null; this.visible = false; });
    return this.win.loadFile(path.join(__dirname, '..', 'renderer', 'keyboard.html')).then(() => this.win);
  }

  hwnd() {
    if (!this.win || this.win.isDestroyed()) return 0;
    const buf = this.win.getNativeWindowHandle();
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
  }

  isVisible() {
    return this.visible && !!this.win && !this.win.isDestroyed();
  }

  async show(display) {
    const win = await this._ensure();
    const d = display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = d.bounds;
    const width = Math.round(Math.min(wa.width * 0.78, 1500));
    const height = Math.round(Math.min(wa.height * 0.42, 470));
    win.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + wa.height - height - wa.height * 0.03), width, height });
    this.visible = true;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.send('kbd:open');
    win.showInactive();
  }

  hide() {
    if (!this.isVisible()) return;
    this.visible = false;
    this.win.webContents.send('kbd:close');
    setTimeout(() => { if (this.win && !this.win.isDestroyed() && !this.visible) this.win.hide(); }, 160);
  }

  send(channel, payload) {
    if (this.isVisible()) this.win.webContents.send(channel, payload);
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { ScreenKeyboard };
