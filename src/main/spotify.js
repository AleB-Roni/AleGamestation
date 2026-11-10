'use strict';
/**
 * Spotify Web API: Musik im Overlay auswählen und steuern, ohne dass sich Spotify öffnet.
 *  - Anmeldung einmalig per Browser (PKCE, keine geheimen Schlüssel – nur die Client-ID einer eigenen Spotify-App)
 *  - Spielt auf der Spotify-App dieses PCs; läuft Spotify nicht, wird es minimiert im Hintergrund gestartet
 *  - Steuerung (Abspielen/Überspringen/Auswahl) erfordert bei Spotify ein Premium-Konto
 */
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 43821;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read', 'user-read-recently-played'
].join(' ');
const API = 'https://api.spotify.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Fehlermeldungen von Spotify verständlich machen */
function explain(status, body) {
  const reason = (body && body.error && (body.error.reason || body.error.message)) || '';
  if (status === 403 && /premium/i.test(reason)) return 'Steuern über Spotify geht nur mit Spotify Premium';
  if (status === 403) return 'Spotify verweigert den Zugriff – ist dein Konto in der Spotify-App unter „User Management“ eingetragen?';
  if (status === 404 && /device/i.test(reason)) return 'Kein Spotify-Gerät gefunden – läuft Spotify auf diesem PC?';
  if (status === 429) return 'Zu viele Anfragen an Spotify – kurz warten';
  if (status === 401) return 'Spotify-Anmeldung abgelaufen – in den Einstellungen neu verbinden';
  return `Spotify antwortet mit ${status}${reason ? ': ' + reason : ''}`;
}

class Spotify {
  /**
   * @param {{ getConfig: Function, file: string, openUrl: Function, fetch?: Function }} opts
   *   file = eigene Datei für die Anmeldedaten (nicht in config.json, damit die Oberfläche sie nicht überschreibt)
   */
  constructor(opts) {
    this.getConfig = opts.getConfig;
    this.file = opts.file;
    this.auth = {};
    try { this.auth = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { this.auth = {}; }
    this.openUrl = opts.openUrl;
    this.fetch = opts.fetch || globalThis.fetch;
    this.access = { token: '', expires: 0 };
    this.server = null;
    this.cache = { playlists: null, at: 0 };
  }

  save(patch) {
    Object.assign(this.auth, patch);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.auth, null, 2)); } catch { /* ignore */ }
  }

  cfg() { return { ...this.auth, clientId: String((this.getConfig().spotify || {}).clientId || '').trim() }; }
  isConnected() { return !!(this.cfg().clientId && this.auth.refreshToken); }
  status() { return { connected: this.isConnected(), user: this.auth.user || '', product: this.auth.product || '', redirect: REDIRECT }; }

  /** Einmalige Anmeldung im Browser; liefert den Spotify-Namen */
  async connect() {
    const clientId = this.cfg().clientId;
    if (!clientId) throw new Error('Zuerst die Client-ID deiner Spotify-App eintragen');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const code = await new Promise((resolve, reject) => {
      if (this.server) { try { this.server.close(); } catch { /* ignore */ } }
      const timer = setTimeout(() => { done(); reject(new Error('Anmeldung abgebrochen (Zeit abgelaufen)')); }, 5 * 60000);
      const done = () => { clearTimeout(timer); try { this.server.close(); } catch { /* ignore */ } this.server = null; };
      this.server = http.createServer((req, res) => {
        const u = new URL(req.url, REDIRECT);
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const ok = u.searchParams.get('code') && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:90vh"><h2>${ok ? '✔ Spotify ist verbunden – du kannst dieses Fenster schließen.' : '✖ Anmeldung fehlgeschlagen: ' + (u.searchParams.get('error') || 'unbekannt')}</h2></body>`);
        done();
        if (ok) resolve(u.searchParams.get('code'));
        else reject(new Error('Spotify-Anmeldung fehlgeschlagen: ' + (u.searchParams.get('error') || 'unbekannt')));
      });
      this.server.on('error', (err) => { done(); reject(new Error(`Port ${PORT} ist belegt (${err.code})`)); });
      this.server.listen(PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state });
        this.openUrl(`https://accounts.spotify.com/authorize?${q}`);
      });
    });
    await this._token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    const me = await this.api('GET', '/me');
    this.save({ user: (me && (me.display_name || me.id)) || '', product: (me && me.product) || '' });
    return { user: me && (me.display_name || me.id), product: me && me.product };
  }

  disconnect() {
    this.access = { token: '', expires: 0 };
    this.cache = { playlists: null, at: 0 };
    this.save({ refreshToken: '', user: '', product: '' });
  }

  async _token(params) {
    const res = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString()
    });
    const j = JSON.parse((await res.text()) || '{}');
    if (!res.ok || !j.access_token) {
      if (j.error === 'invalid_grant') this.save({ refreshToken: '' });
      throw new Error('Spotify-Anmeldung fehlgeschlagen: ' + (j.error_description || j.error || res.status));
    }
    this.access = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
    if (j.refresh_token) this.save({ refreshToken: j.refresh_token });
  }

  async token() {
    if (this.access.token && Date.now() < this.access.expires) return this.access.token;
    const c = this.cfg();
    if (!c.clientId || !c.refreshToken) throw new Error('Spotify ist nicht verbunden (Einstellungen → Spotify)');
    await this._token({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId });
    return this.access.token;
  }

  async api(method, p, body, retry = true) {
    const res = await this.fetch(API + p, {
      method, headers: { Authorization: 'Bearer ' + (await this.token()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 && retry) { this.access.token = ''; return this.api(method, p, body, false); }
    const text = res.status === 204 ? '' : await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    if (!res.ok) { const e = new Error(explain(res.status, j)); e.status = res.status; throw e; }
    return j;
  }

  /** Was läuft gerade? */
  async now() {
    if (!this.isConnected()) return { connected: false };
    const p = await this.api('GET', '/me/player?additional_types=episode');
    if (!p || !p.item) return { connected: true, active: !!(p && p.device), playing: false, device: p && p.device ? p.device.name : '' };
    const it = p.item;
    const imgs = (it.album && it.album.images) || (it.images) || [];
    return {
      connected: true, active: true, playing: !!p.is_playing, shuffle: !!p.shuffle_state,
      title: it.name, artist: (it.artists || []).map((a) => a.name).join(', ') || (it.show && it.show.name) || '',
      image: (imgs[imgs.length > 1 ? 1 : 0] || {}).url || '', progress: p.progress_ms || 0, duration: it.duration_ms || 0,
      device: p.device ? p.device.name : '', volume: p.device ? p.device.volume_percent : null
    };
  }

  /** Playlists für die Auswahl im Overlay (inkl. „Lieblingssongs“) */
  async playlists(force = false) {
    if (!force && this.cache.playlists && Date.now() - this.cache.at < 5 * 60000) return this.cache.playlists;
    const j = await this.api('GET', '/me/playlists?limit=40');
    const list = [{ id: 'liked', uri: 'liked', name: 'Lieblingssongs', image: '', liked: true }].concat(((j && j.items) || []).filter(Boolean).map((p) => ({
      id: p.id, uri: p.uri, name: p.name, image: ((p.images || [])[0] || {}).url || '', owner: p.owner && p.owner.display_name
    })));
    this.cache = { playlists: list, at: Date.now() };
    return list;
  }

  /** Spotify-Desktop-App minimiert starten (falls sie nicht läuft) */
  startApp() {
    const exe = path.join(process.env.APPDATA || '', 'Spotify', 'Spotify.exe');
    if (process.platform === 'win32' && fs.existsSync(exe)) {
      try { spawn(exe, ['--minimized'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; } catch { /* weiter */ }
    }
    return false;
  }

  /** Gerät zum Abspielen wählen: aktives, sonst dieser PC; startet Spotify bei Bedarf im Hintergrund */
  async device() {
    const pick = (list) => list.find((d) => d.is_active) ||
      list.find((d) => d.type === 'Computer' && d.name.toLowerCase() === os.hostname().toLowerCase()) ||
      list.find((d) => d.type === 'Computer') || list[0];
    let list = ((await this.api('GET', '/me/player/devices')) || {}).devices || [];
    let d = pick(list);
    if (d) return d;
    if (!this.startApp()) throw new Error('Spotify läuft nicht auf diesem PC – bitte einmal starten');
    for (let i = 0; i < 15 && !d; i++) {
      await sleep(1000);
      list = ((await this.api('GET', '/me/player/devices')) || {}).devices || [];
      d = pick(list);
    }
    if (!d) throw new Error('Spotify wurde gestartet, ist aber noch nicht bereit – gleich nochmal versuchen');
    return d;
  }

  /** Playlist (oder Lieblingssongs) abspielen */
  async play(uri) {
    const dev = await this.device();
    let body;
    if (uri === 'liked') {
      const j = await this.api('GET', '/me/tracks?limit=50');
      const uris = ((j && j.items) || []).map((x) => x.track && x.track.uri).filter(Boolean);
      if (!uris.length) throw new Error('Keine Lieblingssongs gefunden');
      body = { uris };
    } else body = { context_uri: uri };
    await this.api('PUT', `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, body);
    return true;
  }

  /** Steuerung: playpause | next | prev | shuffle | volup | voldown */
  async control(cmd) {
    if (cmd === 'next') return this.api('POST', '/me/player/next');
    if (cmd === 'prev') return this.api('POST', '/me/player/previous');
    const st = await this.api('GET', '/me/player');
    if (cmd === 'playpause') {
      if (st && st.is_playing) return this.api('PUT', '/me/player/pause');
      if (st && st.device) return this.api('PUT', '/me/player/play');
      const dev = await this.device();
      return this.api('PUT', '/me/player', { device_ids: [dev.id], play: true });
    }
    if (cmd === 'shuffle') return this.api('PUT', `/me/player/shuffle?state=${!(st && st.shuffle_state)}`);
    if (cmd === 'volup' || cmd === 'voldown') {
      const v = st && st.device ? st.device.volume_percent : 50;
      const nv = Math.max(0, Math.min(100, v + (cmd === 'volup' ? 10 : -10)));
      return this.api('PUT', `/me/player/volume?volume_percent=${nv}`);
    }
    return null;
  }
}

module.exports = { Spotify, REDIRECT, explain };
