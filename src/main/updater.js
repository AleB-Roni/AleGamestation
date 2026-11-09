'use strict';
/**
 * Automatische Updates über GitHub Releases (electron-updater).
 * Sucht beim Start nach neuen Versionen, lädt sie im Hintergrund und installiert auf Wunsch sofort
 * oder automatisch beim nächsten Beenden. Funktioniert nur in der installierten Version (nicht mit "npm start").
 */
const { app } = require('electron');
const { EventEmitter } = require('events');

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle', version: app.getVersion(), available: null, progress: 0, error: '' };
    this.au = null;
    if (!app.isPackaged) {
      this.state.status = 'dev';
      return;
    }
    try {
      this.au = require('electron-updater').autoUpdater;
    } catch {
      this.state.status = 'unsupported';
      return;
    }
    const au = this.au;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.allowPrerelease = false;
    au.on('checking-for-update', () => this._set({ status: 'checking', error: '' }));
    au.on('update-available', (info) => this._set({ status: 'downloading', available: info.version, notes: stripHtml(info.releaseNotes), progress: 0 }));
    au.on('update-not-available', () => this._set({ status: 'latest' }));
    au.on('download-progress', (p) => this._set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (info) => this._set({ status: 'ready', available: info.version, progress: 100 }));
    au.on('error', (err) => this._set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] }));
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  get() {
    return { ...this.state };
  }

  async check() {
    if (!this.au) return this.get();
    try {
      await this.au.checkForUpdates();
    } catch (err) {
      this._set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] });
    }
    return this.get();
  }

  /** Beendet die App und startet die Installation des heruntergeladenen Updates (still, danach Neustart). */
  install() {
    if (!this.au || this.state.status !== 'ready') return false;
    this.au.quitAndInstall(true, true);
    return true;
  }
}

function stripHtml(notes) {
  if (!notes) return '';
  const text = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes);
  return text.replace(/<[^>]+>/g, '').trim().slice(0, 600);
}

module.exports = { Updater };
