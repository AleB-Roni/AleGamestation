'use strict';
/**
 * Updates über GitHub Releases.
 *  - Fragt die GitHub-API nach der neuesten Version (Versionsnummer, Änderungen, Download-Link)
 *  - Lädt das Update über electron-updater herunter und installiert es (nur in der installierten App)
 *  - Ohne electron-updater (Entwicklerversion): Hinweis + Link zum Installer
 */
const { EventEmitter } = require('events');

const REPO = 'AleB-Roni/AleGamestation';

/** "1.10.0" > "1.9.2" ? 1 : -1 / 0 */
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Release-Text (Markdown) vereinfachen: Überschriften/Links entfernen, max. ~40 Zeilen */
function cleanNotes(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trimEnd())
    .filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim()))
    .slice(0, 40)
    .join('\n')
    .trim();
}

class Updater extends EventEmitter {
  /**
   * @param {{ version: string, isPackaged: boolean, fetch: Function, getConfig: Function, autoUpdater?: object }} opts
   */
  constructor(opts) {
    super();
    this.fetch = opts.fetch || globalThis.fetch;
    this.getConfig = opts.getConfig || (() => ({}));
    this.state = {
      status: 'idle', version: opts.version, available: null, notes: '', releaseUrl: `https://github.com/${REPO}/releases/latest`,
      installerUrl: '', publishedAt: '', progress: 0, error: '', canInstall: false, lastCheck: 0
    };
    this.au = null;
    if (opts.isPackaged) {
      try { this.au = opts.autoUpdater || require('electron-updater').autoUpdater; } catch { this.au = null; }
    }
    this.state.canInstall = !!this.au;
    if (!this.au) return;
    const au = this.au;
    au.autoDownload = false; // wird bei jeder Prüfung aus der Einstellung gesetzt
    au.autoInstallOnAppQuit = true;
    au.allowPrerelease = false;
    au.on('update-available', (info) => {
      const auto = this._autoDownload();
      this._set({ status: auto ? 'downloading' : 'available', available: info.version, progress: 0 });
    });
    au.on('update-not-available', () => { if (this.state.status === 'checking') this._set({ status: 'latest' }); });
    au.on('download-progress', (p) => this._set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (info) => this._set({ status: 'ready', available: info.version, progress: 100 }));
    au.on('error', (err) => {
      // Fehler beim Herunterladen anzeigen; Fehler bei der reinen Prüfung übernimmt die GitHub-Abfrage
      if (this.state.status === 'downloading') this._set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] });
    });
  }

  _autoDownload() {
    const g = this.getConfig().general || {};
    return g.autoDownloadUpdates !== false;
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  get() {
    return { ...this.state };
  }

  /** Neueste Version direkt bei GitHub abfragen */
  async fetchLatest() {
    const res = await this.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AleGamestation' }
    });
    if (res.status === 404) throw new Error('Update-Quelle nicht gefunden – ist das GitHub-Repository privat? Updates funktionieren nur, wenn es öffentlich ist');
    if (res.status === 403) throw new Error('GitHub hat zu viele Anfragen gemeldet – bitte später erneut suchen');
    if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
    const r = JSON.parse(await res.text());
    const exe = (r.assets || []).find((a) => /\.exe$/i.test(a.name));
    return {
      version: String(r.tag_name || '').replace(/^v/, ''),
      notes: cleanNotes(r.body),
      releaseUrl: r.html_url,
      installerUrl: exe ? exe.browser_download_url : '',
      publishedAt: r.published_at || ''
    };
  }

  async check() {
    if (['checking', 'downloading'].includes(this.state.status)) return this.get();
    this._set({ status: 'checking', error: '', lastCheck: Date.now() });
    let latest = null;
    try {
      latest = await this.fetchLatest();
    } catch (err) {
      // Netzwerkfehler vs. Antwort von GitHub unterscheiden
      const msg = /Update-Quelle|zu viele Anfragen/.test(err.message) ? err.message : `Keine Verbindung zu GitHub: ${err.message}`;
      this._set({ status: 'error', error: msg });
      return this.get();
    }
    const newer = compareVersions(latest.version, this.state.version) > 0;
    this._set({ releaseUrl: latest.releaseUrl, installerUrl: latest.installerUrl, publishedAt: latest.publishedAt, notes: latest.notes, available: newer ? latest.version : null });
    if (!newer) { this._set({ status: 'latest' }); return this.get(); }

    if (!this.au) { this._set({ status: 'available' }); return this.get(); }
    if (this.state.status === 'ready') return this.get();
    try {
      this.au.autoDownload = this._autoDownload();
      await this.au.checkForUpdates();
      // Falls electron-updater kein Ereignis geliefert hat
      if (this.state.status === 'checking') this._set({ status: this.au.autoDownload ? 'downloading' : 'available' });
    } catch (err) {
      this._set({ status: 'available', error: 'Automatische Installation nicht möglich – Installer über die Release-Seite laden' });
      this.state.canInstall = false;
    }
    return this.get();
  }

  /** Update herunterladen (wenn nicht automatisch) */
  async download() {
    if (!this.au) return false;
    if (this.state.status === 'ready' || this.state.status === 'downloading') return true;
    this._set({ status: 'downloading', progress: 0, error: '' });
    try {
      await this.au.downloadUpdate();
      return true;
    } catch (err) {
      this._set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] });
      return false;
    }
  }

  /** Beendet die App und installiert das heruntergeladene Update (still, danach Neustart). */
  install() {
    if (!this.au || this.state.status !== 'ready') return false;
    this.au.quitAndInstall(true, true);
    return true;
  }
}

module.exports = { Updater, compareVersions, cleanNotes, REPO };
