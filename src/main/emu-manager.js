'use strict';
/**
 * Emulator-Verwaltung: Emulatoren per Knopfdruck installieren, aktualisieren, entfernen.
 *  - Flatpak (Linux / AleGamestation OS): Flathub, nur für den Benutzer (kein Passwort)
 *  - Release-Seiten: GitHub, Forgejo/Gitea (z.B. Eden auf git.eden-emu.dev, Codeberg) – neueste Version laden,
 *    AppImage/ZIP/7z/tar auspacken, als Emulator in AleGamestation eintragen
 *  - eigene Quellen: Repo- oder Release-URL + optionaler Dateifilter
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');

const PLATFORM = process.platform === 'win32' ? 'win32' : 'linux';

// Konsolen, die beim Installieren eines Emulators angelegt werden, falls es sie noch nicht gibt
const SYSTEMS = {
  switch: { name: 'Nintendo Switch', short: 'Switch', color: '#e60012', extensions: ['.nsp', '.xci'], dir: 'switch' },
  wiiu: { name: 'Wii U', short: 'Wii U', color: '#009ac7', extensions: ['.wua', '.wux', '.wud', '.rpx'], dir: 'wiiu' },
  '3ds': { name: 'Nintendo 3DS', short: '3DS', color: '#c8102e', extensions: ['.3ds', '.cci', '.cia', '.3dsx'], dir: '3ds' },
  ps3: { name: 'PlayStation 3', short: 'PS3', color: '#222222', extensions: ['.iso', '.pkg'], dir: 'ps3' }
};

/**
 * Eingebaute Emulatoren. emu = ID in den Emulator-Einstellungen (vorhandene werden aktualisiert, neue angelegt).
 * flatpak: nur Linux · release: Quelle + Dateiauswahl pro Plattform
 */
const CATALOG = [
  { id: 'eden', name: 'Eden', console: 'Nintendo Switch', emu: 'eden', system: 'switch', args: '-f -g "{rom}"',
    release: 'https://git.eden-emu.dev/eden-emu/eden',
    asset: { linux: /^Eden-Linux-v[\d.]+-amd64-clang-pgo\.AppImage$/i, win32: /^Eden-Windows-v[\d.]+-amd64-msvc-standard\.zip$/i }, exe: /^eden\.exe$/i },
  { id: 'retroarch', name: 'RetroArch', console: 'NES, SNES, N64, GBA, Mega Drive …', flatpak: 'org.libretro.RetroArch', cores: true },
  { id: 'melonds', name: 'melonDS', console: 'Nintendo DS', emu: 'melonds', flatpak: 'net.kuribo64.melonDS', args: 'run net.kuribo64.melonDS -f "{rom}"',
    release: 'https://github.com/melonDS-emu/melonDS', asset: { win32: /windows.*x86_64.*\.zip$/i }, exe: /^melonds\.exe$/i },
  { id: 'dolphin', name: 'Dolphin', console: 'GameCube / Wii', emu: 'dolphin', flatpak: 'org.DolphinEmu.dolphin-emu', args: 'run org.DolphinEmu.dolphin-emu -b -e "{rom}"' },
  { id: 'duckstation', name: 'DuckStation', console: 'PlayStation', emu: 'duckstation', flatpak: 'org.duckstation.DuckStation', args: 'run org.duckstation.DuckStation -batch -fullscreen -- "{rom}"',
    release: 'https://github.com/stenzek/duckstation', prerelease: true, asset: { win32: /^duckstation-windows-x64-release\.zip$/i }, exe: /^duckstation-qt.*\.exe$/i },
  { id: 'pcsx2', name: 'PCSX2', console: 'PlayStation 2', emu: 'pcsx2', flatpak: 'net.pcsx2.PCSX2', args: 'run net.pcsx2.PCSX2 -batch -fullscreen -- "{rom}"',
    release: 'https://github.com/PCSX2/pcsx2', asset: { win32: /windows-x64-Qt\.7z$/i }, exe: /^pcsx2-qt\.exe$/i },
  { id: 'ppsspp', name: 'PPSSPP', console: 'PlayStation Portable', emu: 'ppsspp', flatpak: 'org.ppsspp.PPSSPP', args: 'run org.ppsspp.PPSSPP --fullscreen "{rom}"' },
  { id: 'cemu', name: 'Cemu', console: 'Wii U', emu: 'cemu', system: 'wiiu', flatpak: 'info.cemu.Cemu', args: 'run info.cemu.Cemu -f -g "{rom}"',
    release: 'https://github.com/cemu-project/Cemu', asset: { win32: /windows-x64\.zip$/i }, exe: /^cemu\.exe$/i },
  { id: 'azahar', name: 'Azahar', console: 'Nintendo 3DS', emu: 'azahar', system: '3ds', flatpak: 'org.azahar_emu.Azahar', args: 'run org.azahar_emu.Azahar -f "{rom}"',
    release: 'https://github.com/azahar-emu/azahar', asset: { win32: /windows-msvc\.zip$/i }, exe: /^azahar\.exe$/i },
  { id: 'rpcs3', name: 'RPCS3', console: 'PlayStation 3', emu: 'rpcs3', system: 'ps3', flatpak: 'net.rpcs3.RPCS3', args: 'run net.rpcs3.RPCS3 --no-gui "{rom}"' }
];

const RA_CORES = ['snes9x', 'mesen', 'mgba', 'mupen64plus_next', 'genesis_plus_gx'];
const SKIP_ASSET = /\.(zsync|sha256|sha512|sig|asc|txt|md|torrent|json|pdb|dmg|apk|deb|rpm|msi|blockmap)$|debug|symbols|source/i;

/** Repo-/Release-URL → API-Adresse der Releases (GitHub oder Forgejo/Gitea/Codeberg) */
function parseSource(url) {
  let s = String(url || '').trim();
  if (!s) throw new Error('Keine Quelle angegeben');
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'https://github.com/' + s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('Adresse muss auf ein Repository zeigen, z.B. https://github.com/name/projekt');
  const [owner, repo] = parts;
  const r = repo.replace(/\.git$/, '');
  if (/(^|\.)github\.com$/i.test(u.hostname)) {
    return { kind: 'github', owner, repo: r, api: `https://api.github.com/repos/${owner}/${r}/releases?per_page=15`, page: `https://github.com/${owner}/${r}/releases` };
  }
  return { kind: 'gitea', owner, repo: r, api: `${u.protocol}//${u.host}/api/v1/repos/${owner}/${r}/releases?limit=15`, page: `${u.protocol}//${u.host}/${owner}/${r}/releases` };
}

/** Wildcard („*windows*.zip“) oder /Regex/ → RegExp */
function toPattern(p) {
  if (!p) return null;
  if (p instanceof RegExp) return p;
  const m = String(p).match(/^\/(.+)\/([a-z]*)$/);
  if (m) return new RegExp(m[1], m[2] || 'i');
  return new RegExp(String(p).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
}

/** Passende Datei eines Releases für diese Plattform */
function pickAsset(assets, platform, hint) {
  const list = (assets || []).filter((a) => a && a.name && !SKIP_ASSET.test(a.name));
  const re = toPattern(hint);
  if (re) return list.find((a) => re.test(a.name)) || null;
  const arm = /aarch64|arm64|armhf|armv7/i;
  let cands;
  if (platform === 'win32') {
    cands = list.filter((a) => /win/i.test(a.name) && /\.(zip|7z|exe)$/i.test(a.name) && !arm.test(a.name) && !/setup|install/i.test(a.name));
    if (!cands.length) cands = list.filter((a) => /\.(zip|7z)$/i.test(a.name) && !arm.test(a.name) && !/linux|mac|osx|android/i.test(a.name));
  } else {
    cands = list.filter((a) => /\.appimage$/i.test(a.name) && !arm.test(a.name));
    if (!cands.length) cands = list.filter((a) => /linux/i.test(a.name) && /\.(tar\.gz|tar\.xz|tgz|zip)$/i.test(a.name) && !arm.test(a.name));
  }
  const score = (a) => (/x86_64|amd64|x64/i.test(a.name) ? 4 : 0) + (/appimage$/i.test(a.name) ? 2 : 0) + (/\.zip$/i.test(a.name) ? 1 : 0) - (/legacy|debug|nightly/i.test(a.name) ? 3 : 0);
  return cands.sort((a, b) => score(b) - score(a))[0] || null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => execFile(cmd, args, { maxBuffer: 8 << 20, timeout: opts.timeout || 0, windowsHide: true }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') })));
}

/** Archiv auspacken: bsdtar (Windows 10+), sonst unzip / 7z / tar */
async function extract(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (/\.(tar\.gz|tgz|tar\.xz)$/i.test(file) && (await run('tar', ['-xf', file, '-C', dest])).ok) return;
  if ((await run('tar', ['-xf', file, '-C', dest])).ok) return;
  if (/\.zip$/i.test(file) && (await run('unzip', ['-o', '-q', file, '-d', dest])).ok) return;
  if ((await run('7z', ['x', '-y', `-o${dest}`, file])).ok) return;
  if (process.platform === 'win32' && /\.zip$/i.test(file)) {
    const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
    if ((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(file)} -DestinationPath ${q(dest)} -Force`])).ok) return;
  }
  throw new Error('Archiv konnte nicht entpackt werden: ' + path.basename(file));
}

/** Startdatei im ausgepackten Ordner finden */
function findExe(dir, hint, id) {
  const found = [];
  const walk = (d, depth) => {
    if (depth < 0) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth - 1);
      else if (process.platform === 'win32' ? /\.exe$/i.test(e.name) : (/\.appimage$/i.test(e.name) || (() => { try { return (fs.statSync(p).mode & 0o111) && !/\.(so|sh|py)(\.|$)/i.test(e.name); } catch { return false; } })())) {
        if (!/unins|update|crash|vc_?redist|setup|install|maintenance/i.test(e.name)) found.push(p);
      }
    }
  };
  walk(dir, 3);
  const re = toPattern(hint);
  return (re && found.find((p) => re.test(path.basename(p))))
    || found.find((p) => path.basename(p).toLowerCase().startsWith(String(id).toLowerCase()))
    || found.sort((a, b) => { try { return fs.statSync(b).size - fs.statSync(a).size; } catch { return 0; } })[0] || '';
}

const flatpakDirs = (id) => [path.join('/var/lib/flatpak/app', id), path.join(os.homedir(), '.local/share/flatpak/app', id)];

class EmuManager extends EventEmitter {
  /**
   * @param {{ getConfig: Function, updateConfig: (fn: Function) => void, fetch: Function, trace?: Function }} opts
   */
  constructor(opts) {
    super();
    this.getConfig = opts.getConfig;
    this.updateConfig = opts.updateConfig;
    this.fetch = opts.fetch;
    this.trace = opts.trace || (() => {});
    this.cache = new Map();
    this.busy = new Map(); // id -> Schritt
  }

  conf() { return this.getConfig().emuManager || {}; }
  baseDir() {
    const c = this.conf();
    if (c.dir) return c.dir;
    return PLATFORM === 'win32' ? 'C:\\Emulatoren' : path.join(os.homedir(), 'Emulatoren');
  }

  /** Einträge für diese Plattform: eingebaut + eigene Quellen */
  entries() {
    const own = (this.conf().sources || []).map((s) => ({
      id: s.id, name: s.name || s.id, console: s.console || 'Eigene Quelle', release: s.url, asset: { [PLATFORM]: s.asset || '' },
      exe: s.exe || '', args: s.args || '"{rom}"', emu: s.emu || s.id, prerelease: !!s.prerelease, custom: true
    }));
    const builtIn = CATALOG.map((e) => ({ ...e, flatpak: PLATFORM === 'linux' ? e.flatpak : null }))
      .filter((e) => e.flatpak || (e.release && (!e.asset || e.asset[PLATFORM] !== undefined)));
    return [...builtIn, ...own];
  }
  entry(id) { return this.entries().find((e) => e.id === id); }

  async cached(key, ms, fn) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < ms) return c.data;
    const data = await fn();
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  // ---------- Flatpak ----------
  flatpakInstalled(id) { return flatpakDirs(id).some((d) => fs.existsSync(d)); }
  async flatpakVersion(id) {
    const r = await run('flatpak', ['info', id]);
    const m = r.out.match(/^\s*(?:Version|Versión|Version:)\s*:?\s*(.+)$/mi);
    return m ? m[1].trim() : '';
  }
  flatpakUpdates() {
    return this.cached('fp-updates', 10 * 60000, async () => {
      const ids = new Set();
      for (const scope of ['--user', '--system']) {
        const r = await run('flatpak', ['remote-ls', scope, '--updates', '--columns=application'], { timeout: 60000 });
        r.out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).forEach((x) => ids.add(x));
      }
      return ids;
    });
  }

  // ---------- Releases ----------
  async latestRelease(e) {
    const src = parseSource(e.release);
    const list = await this.cached('rel:' + src.api, 10 * 60000, async () => {
      const r = await this.fetch(src.api, { headers: { Accept: 'application/json', 'User-Agent': 'AleGamestation' } });
      if (r.status === 403 || r.status === 429) throw new Error('Zu viele Anfragen an die Release-Seite – später erneut versuchen');
      if (!r.ok) throw new Error(`Release-Seite antwortet mit Fehler ${r.status} (${src.page})`);
      return r.json();
    });
    const hint = e.asset && e.asset[PLATFORM];
    const cands = (Array.isArray(list) ? list : []).filter((x) => !x.draft).map((x) => ({ rel: x, asset: pickAsset(x.assets, PLATFORM, hint) })).filter((x) => x.asset);
    const stable = cands.find((x) => !x.rel.prerelease);
    const pick = e.prerelease ? cands[0] : stable || cands[0];
    if (!pick) throw new Error(`Keine passende Datei für ${PLATFORM === 'win32' ? 'Windows' : 'Linux'} gefunden (${src.page})`);
    return {
      version: pick.rel.tag_name || pick.rel.name, name: pick.asset.name, size: pick.asset.size || 0,
      url: pick.asset.browser_download_url, page: src.page, date: pick.rel.published_at || ''
    };
  }

  /** Übersicht mit Zustand (installiert, Version, Update verfügbar) */
  async list({ checkOnline = true } = {}) {
    const inst = this.conf().installed || {};
    const fpUpdates = checkOnline && PLATFORM === 'linux' ? await this.flatpakUpdates().catch(() => new Set()) : new Set();
    const out = [];
    for (const e of this.entries()) {
      const row = { id: e.id, name: e.name, console: e.console, custom: !!e.custom, kind: e.flatpak ? 'flatpak' : 'release', busy: this.busy.get(e.id) || '' };
      if (e.flatpak) {
        row.installed = this.flatpakInstalled(e.flatpak);
        row.version = row.installed ? await this.flatpakVersion(e.flatpak) : '';
        row.update = row.installed && fpUpdates.has(e.flatpak);
        row.source = 'Flathub';
      } else {
        const i = inst[e.id];
        row.installed = !!(i && i.exe && fs.existsSync(i.exe));
        row.version = row.installed ? i.version : '';
        row.source = (() => { try { return parseSource(e.release).page; } catch { return e.release; } })();
        if (checkOnline) {
          try { const l = await this.latestRelease(e); row.latest = l.version; row.size = l.size; row.update = row.installed && l.version !== i.version; } catch (err) { row.error = err.message; }
        }
      }
      out.push(row);
    }
    return out;
  }

  progress(id, step, extra = {}) {
    if (step) this.busy.set(id, step); else this.busy.delete(id);
    this.emit('progress', { id, step, ...extra });
  }

  /** Installieren oder aktualisieren */
  async install(id) {
    const e = this.entry(id);
    if (!e) throw new Error('Unbekannter Emulator');
    if (this.busy.has(id)) throw new Error('Läuft bereits');
    try {
      if (e.flatpak) await this.installFlatpak(e);
      else await this.installRelease(e);
      this.cache.delete('fp-updates');
      this.progress(id, '', { done: true });
      return true;
    } catch (err) {
      this.progress(id, '', { error: err.message });
      throw err;
    }
  }

  async installFlatpak(e) {
    await run('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo']);
    const update = this.flatpakInstalled(e.flatpak);
    this.progress(e.id, update ? 'Aktualisiere …' : 'Installiere …');
    const r = update
      ? await run('flatpak', ['update', '--noninteractive', '-y', e.flatpak], { timeout: 30 * 60000 })
      : await run('flatpak', ['install', '--user', '--noninteractive', '-y', 'flathub', e.flatpak], { timeout: 30 * 60000 });
    if (!r.ok) throw new Error(`${e.name}: ${(r.err || r.out).trim().split('\n').pop()}`);
    await run('flatpak', ['override', '--user', '--filesystem=home', e.flatpak]);
    if (e.cores) await this.retroArchCores(e);
    this.register(e, '/usr/bin/flatpak', e.args);
    this.trace(`${e.name} ${update ? 'aktualisiert' : 'installiert'} (Flatpak)`);
  }

  async retroArchCores(e) {
    const dir = path.join(os.homedir(), '.var/app/org.libretro.RetroArch/config/retroarch/cores');
    fs.mkdirSync(dir, { recursive: true });
    for (const c of RA_CORES) {
      this.progress(e.id, `Core ${c} …`);
      const tmp = path.join(os.tmpdir(), `ags-core-${c}.zip`);
      try {
        await this.download(`https://buildbot.libretro.com/nightly/linux/x86_64/latest/${c}_libretro.so.zip`, tmp, e.id);
        await extract(tmp, dir);
      } catch (err) { this.trace(`Core ${c}: ${err.message}`); } finally { fs.rmSync(tmp, { force: true }); }
    }
  }

  async download(url, file, id) {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'AleGamestation' } });
    if (!r.ok || !r.body) throw new Error(`Download fehlgeschlagen (${r.status})`);
    const total = Number(r.headers.get('content-length')) || 0;
    let got = 0; let last = 0;
    const src = Readable.fromWeb(r.body);
    src.on('data', (ch) => {
      got += ch.length;
      if (Date.now() - last > 400) { last = Date.now(); this.emit('progress', { id, step: this.busy.get(id) || 'Lade …', received: got, total }); }
    });
    await pipeline(src, fs.createWriteStream(file));
  }

  async installRelease(e) {
    this.progress(e.id, 'Suche neueste Version …');
    const rel = await this.latestRelease(e);
    const dir = path.join(this.baseDir(), e.id);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(os.tmpdir(), `ags-emu-${e.id}-${Date.now()}-${rel.name}`);
    this.progress(e.id, `Lade ${rel.version} …`);
    try {
      await this.download(rel.url, tmp, e.id);
      let exe;
      if (/\.appimage$/i.test(rel.name)) {
        exe = path.join(dir, `${e.id}.AppImage`);
        fs.copyFileSync(tmp, exe);
        fs.chmodSync(exe, 0o755);
      } else if (/\.exe$/i.test(rel.name)) {
        exe = path.join(dir, rel.name);
        fs.copyFileSync(tmp, exe);
      } else {
        this.progress(e.id, 'Entpacke …');
        // Über die vorhandenen Dateien entpacken – eigene Einstellungen/„user“-Ordner bleiben erhalten
        await extract(tmp, dir);
        exe = findExe(dir, e.exe, e.id);
        if (!exe) throw new Error('Startdatei im Archiv nicht gefunden – bei eigenen Quellen den Namen der Startdatei angeben');
        if (PLATFORM === 'linux') { try { fs.chmodSync(exe, 0o755); } catch { /* ok */ } }
      }
      this.updateConfig((c) => {
        c.emuManager = c.emuManager || {};
        c.emuManager.installed = { ...(c.emuManager.installed || {}), [e.id]: { version: rel.version, exe, file: rel.name, at: new Date().toISOString() } };
      });
      this.register(e, exe, e.args);
      this.trace(`${e.name} ${rel.version} installiert: ${exe}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** In den Emulator-Einstellungen eintragen bzw. Pfad aktualisieren; Konsole anlegen, falls nötig */
  register(e, exe, args) {
    if (!e.emu) return;
    this.updateConfig((c) => {
      const list = c.emulators || (c.emulators = []);
      let emu = list.find((x) => x.id === e.emu);
      if (!emu) {
        emu = { id: e.emu, name: e.name, exe, args: args || '"{rom}"' };
        list.push(emu);
      } else {
        emu.exe = exe;
        if (exe.endsWith('flatpak') && args) emu.args = args;
      }
      const sysId = e.system;
      if (sysId && SYSTEMS[sysId] && !(c.systems || []).some((s) => s.id === sysId)) {
        const p = SYSTEMS[sysId];
        const romDir = PLATFORM === 'win32' ? `C:\\ROMs\\${p.dir}` : path.join(os.homedir(), 'ROMs', p.dir);
        try { fs.mkdirSync(romDir, { recursive: true }); } catch { /* ok */ }
        (c.systems || (c.systems = [])).push({ id: sysId, name: p.name, short: p.short, color: p.color, extensions: p.extensions, romDirs: [romDir], emulator: e.emu, enabled: true });
      }
    });
  }

  async remove(id) {
    const e = this.entry(id);
    if (!e) throw new Error('Unbekannter Emulator');
    this.progress(id, 'Entferne …');
    try {
      if (e.flatpak) {
        const r = await run('flatpak', ['uninstall', '--user', '--noninteractive', '-y', e.flatpak], { timeout: 10 * 60000 });
        if (!r.ok && this.flatpakInstalled(e.flatpak)) throw new Error((r.err || r.out).trim().split('\n').pop());
      } else {
        const i = (this.conf().installed || {})[id];
        if (i && i.exe) {
          // Nur die Programmdatei bzw. den Programmordner im Emulator-Ordner entfernen
          const dir = path.join(this.baseDir(), id);
          if (i.exe.startsWith(dir)) fs.rmSync(dir, { recursive: true, force: true });
        }
        this.updateConfig((c) => { if (c.emuManager && c.emuManager.installed) delete c.emuManager.installed[id]; });
      }
    } finally { this.progress(id, '', { done: true }); }
    return true;
  }

  /** Alle installierten Emulatoren mit verfügbarem Update aktualisieren */
  async updateAll() {
    const rows = await this.list();
    const done = [];
    for (const r of rows.filter((x) => x.installed && x.update)) {
      try { await this.install(r.id); done.push(r.name); } catch (err) { this.trace(`Update ${r.name}: ${err.message}`); }
    }
    return done;
  }
}

module.exports = { EmuManager, CATALOG, parseSource, pickAsset, findExe, toPattern };
