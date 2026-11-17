'use strict';
/**
 * RomM-Server (https://romm.app, getestet mit der API von 5.4): ROMs anzeigen, empfehlen und herunterladen.
 * Anmeldung: Client-Token (rmm_…, empfohlen) oder Benutzername + Passwort (HTTP Basic).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { romTitle, titleScore } = require('./scraper');

// AleGamestation-Konsole → RomM-Plattform-Kürzel (RomM „UniversalPlatformSlug“)
const SLUGS = {
  nes: ['nes', 'famicom'], snes: ['snes', 'sfam'], n64: ['n64'], gb: ['gb', 'gbc'], gbc: ['gbc'], gba: ['gba'], nds: ['nds'], '3ds': ['3ds'],
  gc: ['ngc', 'wii'], wii: ['wii'], wiiu: ['wiiu'], switch: ['switch'], switch2: ['switch-2'], 'switch-2': ['switch-2'],
  sms: ['sms'], md: ['genesis'], genesis: ['genesis'], saturn: ['saturn'], dc: ['dc'], ps1: ['psx'], psx: ['psx'], ps2: ['ps2'], ps3: ['ps3'],
  psp: ['psp'], psvita: ['psvita'], pce: ['tg16'], arcade: ['arcade'], gamegear: ['gamegear'], segacd: ['segacd'], n3ds: ['3ds']
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Ist diese Server-ROM schon lokal vorhanden? → lokales Spiel (oder null) */
function findLocal(rom, localGames) {
  const fsName = String(rom.fs_name || '').toLowerCase();
  const stem = String(rom.fs_name_no_ext || '').toLowerCase();
  // 1. gleicher Datei- oder Ordnername
  for (const g of localGames) {
    if (!g.rom) continue;
    const base = path.basename(g.rom).toLowerCase();
    const bstem = path.basename(g.rom, path.extname(g.rom)).toLowerCase();
    const dirs = path.dirname(g.rom).split(/[\\/]/).map((d) => d.toLowerCase());
    if (base === fsName || (stem && bstem === stem) || (fsName && dirs.includes(fsName)) || (stem && dirs.includes(stem))) return g;
  }
  // 2. gleicher Titel (ohne Region/Version), z.B. „Super Mario World (USA).sfc“ ≙ „Super Mario World (Europe).zip“
  const title = romTitle({ name: rom.name || rom.fs_name_no_ext });
  if (!norm(title)) return null;
  let best = null; let score = 0;
  for (const g of localGames) {
    const t = romTitle(g);
    const s = norm(t) === norm(title) ? 1 : titleScore(title, t);
    if (s > score) { score = s; best = g; }
  }
  return score >= 0.92 ? best : null;
}

/** ZIP entpacken: Windows-tar (bsdtar, ab Windows 10), sonst unzip, notfalls PowerShell */
async function extractZip(zip, dest) {
  const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 20 }, (err) => resolve(!err)));
  if (await run('tar', ['-xf', zip, '-C', dest])) return;
  if (await run('unzip', ['-o', '-q', zip, '-d', dest])) return;
  if (process.platform === 'win32') {
    const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
    if (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`])) return;
  }
  throw new Error('Entpacken fehlgeschlagen');
}

class RomM extends EventEmitter {
  /**
   * @param {{ getConfig: Function, fetch: Function, cacheDir: string, trace?: Function }} opts
   */
  constructor(opts) {
    super();
    this.getConfig = opts.getConfig;
    this.fetch = opts.fetch;
    this.cacheDir = opts.cacheDir;
    this.trace = opts.trace || (() => {});
    this.cache = new Map(); // key -> { at, data }
    this.downloads = new Map(); // romId -> { name, received, total, abort }
    this.reachable = null;
  }

  cfg() { return this.getConfig().romm || {}; }
  enabled() { const c = this.cfg(); return !!(c.enabled && c.url); }
  /** Aktive Adresse: Heimnetz, sonst (wenn nicht erreichbar) die Adresse für unterwegs (z.B. Tailscale) */
  base() { return this.useRemote && this.cfg().remoteUrl ? this.clean(this.cfg().remoteUrl) : this.clean(this.cfg().url); }
  clean(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\/api$/, ''); }

  headers() {
    const c = this.cfg();
    if (c.token) return { Authorization: `Bearer ${String(c.token).trim()}` };
    if (c.user) return { Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.password || ''}`).toString('base64') };
    return {};
  }

  async request(p, { query, timeout = 10000, raw = false } = {}) {
    if (!this.base()) throw new Error('Keine RomM-Adresse eingetragen');
    const u = new URL(this.base() + p);
    for (const [k, v] of Object.entries(query || {})) {
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
      else if (v !== undefined && v !== null) u.searchParams.set(k, v);
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    let r;
    try {
      r = await this.fetch(u.toString(), { headers: { Accept: 'application/json', ...this.headers() }, signal: ctl.signal });
    } catch (err) {
      clearTimeout(t);
      // Heimnetz nicht erreichbar → einmal die Adresse für unterwegs (Tailscale) versuchen, und umgekehrt
      if (!this._retrying && this.cfg().remoteUrl && this.clean(this.cfg().remoteUrl) !== this.clean(this.cfg().url)) {
        this._retrying = true;
        this.useRemote = !this.useRemote;
        this.trace(`RomM: wechsle auf ${this.useRemote ? 'Adresse für unterwegs' : 'Heimnetz-Adresse'} (${this.base()})`);
        try { return await this.request(p, { query, timeout, raw }); } catch (e2) { this.useRemote = !this.useRemote; throw e2; } finally { this._retrying = false; }
      }
      throw new Error(`RomM nicht erreichbar (${this.base()}): ${err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message}`);
    } finally { clearTimeout(t); }
    if (r.status === 401 || r.status === 403) throw new Error('RomM: Anmeldung abgelehnt – Benutzer/Passwort oder Client-Token prüfen (Rechte: roms.read, platforms.read)');
    if (!r.ok) throw new Error(`RomM antwortet mit Fehler ${r.status}`);
    return raw ? r : r.json();
  }

  async cached(key, ms, fn) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ms) return c.data;
    const data = await fn();
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }
  clearCache() { this.cache.clear(); }

  /** Verbindung prüfen: Version, angemeldeter Benutzer, Plattformen */
  async test() {
    const hb = await this.request('/api/heartbeat');
    const me = await this.request('/api/users/me').catch(() => null); // Client-Token ohne „me.read“ ist ok
    const platforms = await this.platforms(true);
    this.reachable = true;
    return { version: hb && hb.SYSTEM && hb.SYSTEM.VERSION, user: me && me.username, platforms: platforms.length, roms: platforms.reduce((n, p) => n + (p.rom_count || 0), 0) };
  }

  /** Erreichbar? (kurz, für die Oberfläche) */
  async ping() {
    if (!this.enabled()) { this.reachable = null; return false; }
    try { await this.request('/api/heartbeat', { timeout: 4000 }); this.reachable = true; } catch { this.reachable = false; }
    return this.reachable;
  }

  platforms(force = false) {
    if (force) this.cache.delete('platforms');
    return this.cached('platforms', 5 * 60000, async () => {
      const list = await this.request('/api/platforms');
      return (Array.isArray(list) ? list : list.items || []).map((p) => ({
        id: p.id, slug: p.slug, fs_slug: p.fs_slug, name: p.custom_name || p.display_name || p.name, rom_count: p.rom_count || 0
      }));
    });
  }

  /** RomM-Plattformen einer Konsole: eigene Zuordnung, sonst automatisch über Kürzel/Name */
  async platformsFor(sys) {
    const map = (this.cfg().platformMap || {})[sys.id];
    const all = await this.platforms();
    if (Array.isArray(map)) return all.filter((p) => map.includes(p.id));
    if (map === 'none') return [];
    const slugs = SLUGS[sys.id] || [sys.id];
    let hit = all.filter((p) => slugs.includes(p.slug) || slugs.includes(p.fs_slug));
    if (!hit.length) hit = all.filter((p) => norm(p.name) === norm(sys.name) || norm(p.fs_slug) === norm(sys.id));
    return hit;
  }

  /** Alle ROMs einer Plattform (seitenweise) */
  roms(platformId) {
    return this.cached('roms:' + platformId, 3 * 60000, async () => {
      const out = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const page = await this.request('/api/roms', { query: { platform_ids: [platformId], limit: 500, offset, order_by: 'name', order_dir: 'asc' }, timeout: 20000 });
        const items = Array.isArray(page) ? page : page.items || [];
        out.push(...items);
        if (items.length < 500 || (page.total && out.length >= page.total)) break;
      }
      return out;
    });
  }

  /** Für die Oberfläche: kompakte Angaben + ob schon lokal vorhanden */
  view(rom, localGames, sysId) {
    const local = findLocal(rom, localGames);
    const m = rom.metadatum || {};
    return {
      id: rom.id, system: sysId, name: rom.name || rom.fs_name_no_ext, fsName: rom.fs_name, size: rom.fs_size_bytes || 0,
      multi: !!rom.has_multiple_files, platform: rom.platform_display_name || rom.platform_slug,
      cover: rom.path_cover_large || rom.path_cover_small || rom.url_cover ? `agsromm://cover/${rom.id}` : '',
      summary: rom.summary || '', genres: m.genres || [], rating: m.average_rating || null,
      year: m.first_release_date ? new Date(m.first_release_date > 1e11 ? m.first_release_date : m.first_release_date * 1000).getFullYear() : null,
      regions: rom.regions || [], added: rom.created_at || null,
      local: local ? local.id : null
    };
  }

  /** Server-ROMs einer Konsole, mit Markierung „schon heruntergeladen“ */
  async listForSystem(sys, localGames) {
    const plats = await this.platformsFor(sys);
    const out = [];
    for (const p of plats) for (const rom of await this.roms(p.id)) { this.romIndex(rom); out.push(this.view(rom, localGames, sys.id)); }
    return { platforms: plats.map((p) => p.name), roms: out };
  }

  romIndex(rom) {
    if (!this.index) this.index = new Map();
    this.index.set(rom.id, rom);
  }

  /** RomM-Empfehlungen (aus RomMs eigener Ähnlichkeits-Suche + Spielverlauf) – lokal schon vorhandene weggelassen */
  async recommendations(systems, localGames, limit = 30) {
    const list = await this.cached('reco', 10 * 60000, async () => {
      try { return await this.request('/api/recommendations', { query: { limit: 50 } }); } catch (err) {
        this.trace('Empfehlungen nicht verfügbar: ' + err.message);
        return [];
      }
    });
    const bySlug = new Map();
    for (const s of systems) for (const sl of SLUGS[s.id] || [s.id]) if (!bySlug.has(sl)) bySlug.set(sl, s);
    const out = [];
    for (const r of list || []) {
      const rom = r.rom || r;
      const sys = bySlug.get(rom.platform_slug) || bySlug.get(rom.platform_fs_slug);
      if (!sys) continue; // Konsole gibt es in AleGamestation nicht
      this.romIndex(rom);
      const v = this.view(rom, localGames.filter((g) => g.system === sys.id), sys.id);
      if (v.local) continue;
      v.reason = r.seed_rom_name ? `Weil du ${r.seed_rom_name} gespielt hast` : '';
      out.push(v);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Cover über die App holen (mit Anmeldung) und zwischenspeichern */
  async coverFile(romId) {
    const dir = path.join(this.cacheDir, 'covers');
    for (const ext of ['.png', '.jpg', '.webp']) { const f = path.join(dir, romId + ext); if (fs.existsSync(f)) return f; }
    let rom = this.index && this.index.get(Number(romId));
    if (!rom) { rom = await this.request(`/api/roms/${romId}`); this.romIndex(rom); }
    const src = rom.path_cover_large || rom.path_cover_small || rom.url_cover;
    if (!src) return '';
    const url = /^https?:/i.test(src) ? src : this.base() + src;
    const r = await this.fetch(url, { headers: /^https?:/i.test(src) && !url.startsWith(this.base()) ? {} : this.headers() });
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || '';
    const ext = /png/.test(type) ? '.png' : /webp/.test(type) ? '.webp' : '.jpg';
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, romId + ext);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return f;
  }

  /**
   * ROM in den ROM-Ordner der Konsole laden. Mehrteilige Spiele kommen als ZIP und werden in einen Unterordner entpackt.
   * Fortschritt: 'progress' { id, name, received, total, done, error, file }
   */
  async download(romId, destDir) {
    romId = Number(romId);
    if (this.downloads.has(romId)) throw new Error('Wird bereits heruntergeladen');
    let rom = this.index && this.index.get(Number(romId));
    if (!rom) { rom = await this.request(`/api/roms/${romId}`); this.romIndex(rom); }
    if (!destDir) throw new Error('Für diese Konsole ist kein ROM-Ordner eingetragen');
    fs.mkdirSync(destDir, { recursive: true });
    const name = rom.name || rom.fs_name_no_ext;
    const multi = !!rom.has_multiple_files;
    const fileName = multi ? `${rom.fs_name}.zip` : rom.fs_name;
    const target = path.join(destDir, multi ? rom.fs_name : rom.fs_name);
    if (fs.existsSync(target)) throw new Error(`„${rom.fs_name}“ liegt schon im ROM-Ordner`);
    const part = path.join(destDir, fileName + '.part');
    const ctl = new AbortController();
    const st = { id: romId, name, received: 0, total: rom.fs_size_bytes || 0, abort: () => ctl.abort() };
    this.downloads.set(romId, st);
    const emit = (extra = {}) => this.emit('progress', { id: romId, name, received: st.received, total: st.total, ...extra });
    emit();
    try {
      const r = await this.fetch(`${this.base()}/api/roms/${romId}/content/${encodeURIComponent(fileName)}`, { headers: this.headers(), signal: ctl.signal });
      if (r.status === 401 || r.status === 403) throw new Error('RomM: Download nicht erlaubt – Anmeldung prüfen');
      if (!r.ok || !r.body) throw new Error(`RomM antwortet mit Fehler ${r.status}`);
      const len = Number(r.headers.get('content-length')) || 0;
      if (len) st.total = len;
      let last = 0;
      const src = Readable.fromWeb(r.body);
      src.on('data', (chunk) => {
        st.received += chunk.length;
        if (Date.now() - last > 300) { last = Date.now(); emit(); }
      });
      await pipeline(src, fs.createWriteStream(part));
      let file;
      if (multi) {
        fs.mkdirSync(target, { recursive: true });
        await extractZip(part, target);
        fs.rmSync(part, { force: true });
        file = target;
      } else {
        fs.renameSync(part, target);
        file = target;
      }
      this.trace(`Heruntergeladen: ${name} → ${file}`);
      emit({ done: true, file });
      return file;
    } catch (err) {
      fs.rmSync(part, { force: true });
      const msg = err.name === 'AbortError' ? 'Abgebrochen' : err.message;
      emit({ error: msg });
      throw new Error(msg);
    } finally {
      this.downloads.delete(romId);
    }
  }

  cancel(romId) {
    const d = this.downloads.get(Number(romId));
    if (d) d.abort();
    return !!d;
  }
}

module.exports = { RomM, findLocal, extractZip, SLUGS };
