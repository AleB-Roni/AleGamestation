'use strict';
/**
 * Cover-Download für ROMs.
 *  - libretro-thumbnails (kostenlos, ohne Konto): Box-Art + Screenshots, Abgleich über den Dateinamen
 *  - ScreenScraper.fr (optional, mit Konto): sehr große Datenbank, Abgleich über Dateiname/Größe/CRC
 * Bilder landen in <mediaDir>/<system>/covers|snaps/<ROM-Name>.png und werden von der Bibliothek automatisch gefunden.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { EventEmitter } = require('events');

// Systemnamen bei libretro (Ordner auf thumbnails.libretro.com)
const LIBRETRO_SYSTEMS = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gba: 'Nintendo - Game Boy Advance',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  nds: 'Nintendo - Nintendo DS',
  gc: 'Nintendo - GameCube',
  wii: 'Nintendo - Wii',
  md: 'Sega - Mega Drive - Genesis',
  sms: 'Sega - Master System - Mark III',
  gg: 'Sega - Game Gear',
  saturn: 'Sega - Saturn',
  dc: 'Sega - Dreamcast',
  ps1: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  psp: 'Sony - PlayStation Portable',
  pce: 'NEC - PC Engine - TurboGrafx 16',
  neogeo: 'SNK - Neo Geo',
  arcade: 'MAME',
  atari2600: 'Atari - 2600'
};
// System-IDs bei ScreenScraper
const SCREENSCRAPER_IDS = {
  md: 1, sms: 2, nes: 3, snes: 4, gb: 9, gbc: 10, gba: 12, gc: 13, n64: 14, nds: 15, wii: 16,
  gg: 21, saturn: 22, dc: 23, pce: 31, neogeo: 142, ps1: 57, ps2: 58, psp: 61, arcade: 75, atari2600: 26,
  '3ds': 17, wiiu: 18, switch: 225, ps3: 59, vita: 62, xbox: 32, x360: 33
};
/** Eigene Konsolen (ID "sys-…"): System am Namen erkennen, z.B. "Switch 1 & 2" -> switch */
const NAME_SYSTEM = [
  [/switch/i, 'switch'], [/wii\s*u/i, 'wiiu'], [/3ds/i, '3ds'], [/\bds\b|nintendo ds/i, 'nds'], [/game\s*cube|\bgc\b/i, 'gc'], [/\bwii\b/i, 'wii'],
  [/n64|nintendo 64/i, 'n64'], [/snes|super nintendo/i, 'snes'], [/\bnes\b|entertainment system/i, 'nes'], [/advance|gba/i, 'gba'],
  [/game\s*boy color|gbc/i, 'gbc'], [/game\s*boy|\bgb\b/i, 'gb'], [/ps\s*vita|vita/i, 'vita'], [/ps3|playstation 3/i, 'ps3'], [/ps2|playstation 2/i, 'ps2'],
  [/psp|portable/i, 'psp'], [/ps1|psx|playstation/i, 'ps1'], [/dreamcast/i, 'dc'], [/saturn/i, 'saturn'], [/mega\s*drive|genesis/i, 'md'],
  [/master system/i, 'sms'], [/game gear/i, 'gg'], [/xbox 360|x360/i, 'x360'], [/xbox/i, 'xbox'], [/arcade|mame|fbneo/i, 'arcade']
];
/** Suchname für ein ROM: angezeigter Name ohne Klammer-Tags und Titel-IDs */
function romTitle(game) {
  return String(game.name || path.basename(game.rom || '', path.extname(game.rom || '')))
    .replace(/\s*[([].*?[)\]]/g, '').replace(/\s+v\d[\d.]*$/i, '').trim();
}
function systemFromName(name) {
  const hit = NAME_SYSTEM.find(([re]) => re.test(String(name || '')));
  return hit ? hit[1] : '';
}
// Dateiendung -> genaueres System (z.B. .gbc im GBA-Ordner)
const EXT_SYSTEM = { '.gb': 'gb', '.gbc': 'gbc', '.wbfs': 'wii', '.sms': 'sms', '.gg': 'gg', '.nsp': 'switch', '.xci': 'switch', '.nsz': 'switch', '.xcz': 'switch', '.3ds': '3ds', '.cia': '3ds', '.wua': 'wiiu', '.wux': 'wiiu' };

const REGION_PREF = ['de', 'eu', 'wor', 'us', 'ss', 'jp'];

/** Vergleichsname: Kleinbuchstaben, ohne Klammer-Tags, ohne Sonderzeichen, Artikel vorne/hinten vereinheitlicht */
function normalize(name) {
  return String(name)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/^(.*), (the|a|an|der|die|das)\b/i, '$2 $1')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function regionOf(name) {
  const m = String(name).match(/\(([^)]*)\)/);
  return m ? m[1].toLowerCase() : '';
}

/** Bestes Bild aus einer Liste von Dateinamen für einen ROM-Namen wählen */
function bestMatch(romFile, files) {
  const base = path.basename(romFile, path.extname(romFile));
  const exact = files.find((f) => f.replace(/\.png$/i, '') === base);
  if (exact) return exact;
  const key = normalize(base);
  const candidates = files.filter((f) => normalize(f) === key);
  if (!candidates.length) return null;
  const romRegion = regionOf(base);
  const score = (f) => {
    const r = regionOf(f);
    let s = 0;
    if (romRegion && r === romRegion) s += 100;
    if (/europe|germany/.test(r)) s += 30;
    if (/usa|world/.test(r)) s += 20;
    if (/beta|proto|sample|demo|hack|pirate/i.test(f)) s -= 50;
    if (/rev|v1\./i.test(f)) s -= 1;
    return s;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

function libretroSafe(name) {
  // libretro ersetzt diese Zeichen in Dateinamen durch "_"
  return name.replace(/[&*/:`<>?\\|"]/g, '_');
}

class Scraper extends EventEmitter {
  /**
   * @param {object} opts { mediaDir, fetch, getConfig }
   */
  constructor(opts) {
    super();
    this.mediaDir = opts.mediaDir;
    this.fetch = opts.fetch || globalThis.fetch;
    this.getConfig = opts.getConfig;
    this.trace = opts.trace || (() => {});
    this.listCache = new Map();
    this.running = false;
    this.cancelled = false;
  }

  coverPath(systemId, romFile, kind = 'covers') {
    const base = path.basename(romFile, path.extname(romFile));
    return path.join(this.mediaDir, systemId, kind, base + '.png');
  }

  async _get(url, asBuffer) {
    const res = await this.fetch(url, { headers: { 'User-Agent': 'AleGamestation' } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.text();
  }

  async _save(file, buf) {
    if (!buf || buf.length < 200) throw new Error('Leere Bilddatei');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, buf);
  }

  // ---------- libretro ----------
  async _libretroList(sysName, kind) {
    const key = sysName + '/' + kind;
    if (!this.listCache.has(key)) {
      const url = `https://thumbnails.libretro.com/${encodeURIComponent(sysName)}/${kind}/`;
      const p = this._get(url).then((html) => [...html.matchAll(/href="([^"?/][^"]*\.png)"/gi)].map((m) => decodeURIComponent(m[1])))
        .catch(() => []);
      this.listCache.set(key, p);
    }
    return this.listCache.get(key);
  }

  async _libretro(game, sysKey, want) {
    const sysName = LIBRETRO_SYSTEMS[sysKey];
    if (!sysName) return {};
    const out = {};
    const base = `https://thumbnails.libretro.com/${encodeURIComponent(sysName)}`;
    const romBase = libretroSafe(path.basename(game.rom, path.extname(game.rom)));
    for (const [kind, folder] of [['covers', 'Named_Boxarts'], ['snaps', 'Named_Snaps']]) {
      if (!want[kind]) continue;
      const files = await this._libretroList(sysName, folder);
      const hit = files.length ? bestMatch(romBase + '.png', files) : romBase + '.png';
      if (!hit) continue;
      if (kind === 'covers') out.title = hit.replace(/\.png$/i, '').replace(/\s*[([].*?[)\]]/g, '').replace(/_/g, '&').trim();
      try {
        out[kind] = await this._get(`${base}/${folder}/${encodeURIComponent(hit)}`, true);
      } catch { /* nicht vorhanden */ }
    }
    return out;
  }

  // ---------- ScreenScraper ----------
  _ssReady(ss) {
    return ss && ss.devid && ss.devpassword && ss.user && ss.password;
  }

  async _screenscraper(game, sysKey, want, ss) {
    const sysId = SCREENSCRAPER_IDS[sysKey];
    if (!sysId) return {};
    const stat = await fs.promises.stat(game.rom).catch(() => null);
    const params = new URLSearchParams({
      devid: ss.devid, devpassword: ss.devpassword, softname: 'AleGamestation',
      ssid: ss.user, sspassword: ss.password, output: 'json', romtype: 'rom',
      systemeid: String(sysId), romnom: path.basename(game.rom)
    });
    if (stat) params.set('romtaille', String(stat.size));
    // CRC nur für kleine Dateien berechnen (große ISOs würden zu lange dauern)
    if (stat && stat.size < 64 * 1024 * 1024 && typeof zlib.crc32 === 'function') {
      const crc = zlib.crc32(await fs.promises.readFile(game.rom));
      params.set('crc', (crc >>> 0).toString(16).toUpperCase().padStart(8, '0'));
    }
    let json;
    try {
      json = JSON.parse(await this._get('https://api.screenscraper.fr/api2/jeuInfos.php?' + params));
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw new Error('ScreenScraper: Zugangsdaten ungültig oder Limit erreicht');
      if (err.status === 430 || err.status === 429) throw new Error('ScreenScraper: Tageslimit erreicht');
      return {};
    }
    const medias = (json && json.response && json.response.jeu && json.response.jeu.medias) || [];
    const pick = (types) => {
      for (const t of types) {
        const list = medias.filter((m) => m.type === t);
        if (!list.length) continue;
        list.sort((a, b) => rank(a.region) - rank(b.region));
        return list[0].url;
      }
      return null;
    };
    const rank = (r) => { const i = REGION_PREF.indexOf(r); return i === -1 ? 99 : i; };
    const out = {};
    const coverUrl = want.covers && pick(['box-2D', 'box-3D', 'mixrbv2', 'mixrbv1']);
    const snapUrl = want.snaps && pick(['fanart', 'ss', 'sstitle']);
    const names = (json.response.jeu.noms || []);
    const nm = names.sort((a, b) => rank(a.region) - rank(b.region))[0];
    if (nm && nm.text) out.title = nm.text;
    if (coverUrl) try { out.covers = await this._get(coverUrl, true); } catch { /* ignore */ }
    if (snapUrl) try { out.snaps = await this._get(snapUrl, true); } catch { /* ignore */ }
    return out;
  }

  /** Offiziellen Spielnamen merken (wird angezeigt, wenn der Dateiname unsauber ist) */
  _saveTitle(game, title) {
    // Nacheinander schreiben – parallele Downloads würden sich sonst gegenseitig überschreiben
    this._titleQueue = (this._titleQueue || Promise.resolve()).then(() => this._writeTitle(game, title)).catch(() => {});
    return this._titleQueue;
  }

  async _writeTitle(game, title) {
    const file = path.join(this.mediaDir, game.system, 'names.json');
    let map = {};
    try { map = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { /* neu */ }
    map[path.basename(game.rom, path.extname(game.rom))] = title;
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(map, null, 1));
  }

  /** Ein Spiel scrapen. Gibt { covers: bool, snaps: bool, source } zurück. */
  async scrapeGame(game, opts = {}) {
    // Ohne ROM-Datei: PC-Spiel (Steam, Epic, GOG, eigenes Programm)
    if (!game.rom) return this.scrapePcGame(game, opts);
    const cfg = this.getConfig();
    const sc = cfg.scraper || {};
    const sysCfg = cfg.systems.find((s) => s.id === game.system) || {};
    const sysKey = EXT_SYSTEM[path.extname(game.rom).toLowerCase()] || sysCfg.scraperSystem
      || (LIBRETRO_SYSTEMS[game.system] || SCREENSCRAPER_IDS[game.system] ? game.system : systemFromName(sysCfg.name) || game.system);
    const want = {
      covers: opts.force || !fs.existsSync(this.coverPath(game.system, game.rom, 'covers')),
      snaps: sc.downloadSnaps !== false && (opts.force || !fs.existsSync(this.coverPath(game.system, game.rom, 'snaps')))
    };
    if (!want.covers && !want.snaps) return { skipped: true };
    const result = { covers: false, snaps: false, source: '' };
    const sources = sc.source === 'libretro' ? ['libretro'] : sc.source === 'screenscraper' ? ['screenscraper'] : ['screenscraper', 'libretro'];
    // SteamGridDB (kostenloser Schlüssel) als letzte Quelle – hat auch viele Switch-/neuere Konsolenspiele
    if (sc.steamgriddbKey) sources.push('steamgriddb');
    for (const src of sources) {
      if (!want.covers && !want.snaps) break;
      let got = {};
      if (src === 'screenscraper') {
        if (!this._ssReady(sc.screenscraper)) continue;
        got = await this._screenscraper(game, sysKey, want, sc.screenscraper);
      } else if (src === 'steamgriddb') {
        got = await this.sgdb(romTitle(game), sc.steamgriddbKey, want).catch(() => ({}));
      } else {
        if (!LIBRETRO_SYSTEMS[sysKey]) continue; // z.B. Switch: libretro hat keine Bilder
        got = await this._libretro(game, sysKey, want);
      }
      if (got.title && got.covers && want.covers) await this._saveTitle(game, got.title);
      for (const kind of ['covers', 'snaps']) {
        if (got[kind] && want[kind]) {
          try {
            await this._save(this.coverPath(game.system, game.rom, kind), got[kind]);
            result[kind] = true;
            want[kind] = false;
            result.source = result.source || src;
          } catch { /* ungültiges Bild */ }
        }
      }
    }
    return result;
  }

  // ---------- PC-Spiele (Steam, Epic, GOG, eigene) ----------

  /** Speichername für PC-Spiele (ohne ROM-Datei): aus der Spiel-ID */
  pcKey(game) {
    return String(game.id).replace(/[^a-z0-9_-]+/gi, '_') + '.img';
  }

  /** Steam-Shop nach einem Spielnamen durchsuchen -> App-ID (nur bei eindeutigem Treffer) */
  async steamSearch(name) {
    const clean = String(name).replace(/[™®©]/g, '').replace(/\s*[([].*?[)\]]/g, '').trim();
    if (!clean) return null;
    let json;
    try {
      json = JSON.parse(await this._get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(clean)}&l=german&cc=DE`));
    } catch { return null; }
    const items = (json && json.items) || [];
    const key = normalize(clean);
    const exact = items.find((i) => normalize(i.name) === key);
    if (exact) return exact.id;
    // z.B. "The Witcher 3" -> "The Witcher 3: Wild Hunt"
    const prefix = items.find((i) => normalize(i.name).startsWith(key) && key.length >= 6);
    if (prefix) return prefix.id;
    const contained = items.find((i) => key.startsWith(normalize(i.name)) && normalize(i.name).length >= 6);
    return contained ? contained.id : null;
  }

  /** SteamGridDB (optional, kostenloser API-Schlüssel) */
  async sgdb(name, key, want) {
    const auth = { headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'AleGamestation' } };
    const get = async (u) => {
      const res = await this.fetch('https://www.steamgriddb.com/api/v2' + u, auth);
      if (res.status === 401) throw new Error('SteamGridDB: API-Schlüssel ungültig');
      if (!res.ok) return null;
      return JSON.parse(await res.text());
    };
    const search = await get('/search/autocomplete/' + encodeURIComponent(name));
    const hit = search && search.data && search.data[0];
    if (!hit) return {};
    const out = {};
    if (want.covers) {
      const g = await get(`/grids/game/${hit.id}?dimensions=600x900,342x482,660x930&types=static`);
      const url = g && g.data && g.data[0] && g.data[0].url;
      if (url) try { out.covers = await this._get(url, true); } catch { /* ignore */ }
    }
    if (want.snaps) {
      const h = await get(`/heroes/game/${hit.id}?types=static`);
      const url = h && h.data && h.data[0] && h.data[0].url;
      if (url) try { out.snaps = await this._get(url, true); } catch { /* ignore */ }
    }
    return out;
  }

  /**
   * Bild-Adressen eines Steam-Spiels über die Shop-Schnittstelle.
   * Neuere Spiele haben Pfade mit Prüfsumme (…/apps/<id>/<hash>/library_capsule.jpg) – feste Adressen gibt es dort nicht.
   */
  async steamAssets(appid) {
    const input = { ids: [{ appid: Number(appid) }], context: { language: 'german', country_code: 'DE' }, data_request: { include_assets: true } };
    try {
      const j = JSON.parse(await this._get('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=' + encodeURIComponent(JSON.stringify(input))));
      const item = j && j.response && j.response.store_items && j.response.store_items[0];
      const a = item && item.assets;
      if (!a || !a.asset_url_format) return null;
      const url = (file) => (file ? 'https://shared.steamstatic.com/store_item_assets/' + a.asset_url_format.replace('${FILENAME}', file) : '');
      return {
        covers: [a.library_capsule_2x, a.library_capsule].filter(Boolean).map(url),
        snaps: [a.library_hero_2x, a.library_hero].filter(Boolean).map(url),
        header: [a.header, a.main_capsule].filter(Boolean).map(url)
      };
    } catch { return null; }
  }

  /** Bilder von Steams Bilderserver für eine App-ID (erst die echten Adressen, dann die alten festen Pfade) */
  async steamCdn(appid, want) {
    const base = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/`;
    const assets = await this.steamAssets(appid);
    const first = async (urls) => {
      for (const u of urls) {
        try { return await this._get(u, true); } catch { /* nächste Adresse */ }
      }
      return null;
    };
    const out = {};
    if (want.covers) {
      out.covers = await first([...((assets && assets.covers) || []), base + 'library_600x900_2x.jpg', base + 'library_600x900.jpg']);
      // Notlösung: Querformat-Bild, wenn es kein Hochformat-Cover gibt
      if (!out.covers) out.covers = await first([...((assets && assets.header) || []), base + 'header.jpg']);
      if (!out.covers) delete out.covers;
    }
    if (want.snaps) {
      out.snaps = await first([...((assets && assets.snaps) || []), base + 'library_hero.jpg']);
      if (!out.snaps) delete out.snaps;
    }
    this.trace(`Steam ${appid}: Cover ${out.covers ? 'gefunden' : 'nicht gefunden'}, Hintergrund ${out.snaps ? 'gefunden' : 'nicht gefunden'}${assets ? '' : ' (Shop-Schnittstelle ohne Daten)'}`);
    return out;
  }

  async scrapePcGame(game, opts = {}) {
    const sc = this.getConfig().scraper || {};
    const key = this.pcKey(game);
    const want = {
      covers: opts.force || !game.cover || !!game.coverIsHeader,
      snaps: sc.downloadSnaps !== false && (opts.force || !game.hero)
    };
    if (!want.covers && !want.snaps) return { skipped: true };
    const result = { covers: false, snaps: false, source: '' };
    const save = async (got, src) => {
      for (const kind of ['covers', 'snaps']) {
        if (got[kind] && want[kind]) {
          try { await this._save(this.coverPath(game.system, key, kind), got[kind]); result[kind] = true; want[kind] = false; result.source = result.source || src; } catch { /* ungültig */ }
        }
      }
    };
    // 1. Steam-Spiele: direkt über die App-ID
    if (game.type === 'steam' && game.appid) await save(await this.steamCdn(game.appid, want), 'steam');
    // Steam-Spiel ohne eigene Shop-Seite (z.B. Playtest/Demo): über den Namen das Hauptspiel suchen
    if ((want.covers || want.snaps) && game.type === 'steam') {
      const appid = await this.steamSearch(game.name);
      if (appid && String(appid) !== String(game.appid)) await save(await this.steamCdn(appid, want), 'steam-suche');
    }
    // 2. SteamGridDB (falls Schlüssel eingetragen) – auch für Spiele, die es nicht auf Steam gibt
    if ((want.covers || want.snaps) && sc.steamgriddbKey) await save(await this.sgdb(game.name, sc.steamgriddbKey, want), 'steamgriddb');
    // 3. Andere Spiele: im Steam-Shop nach dem Namen suchen
    if ((want.covers || want.snaps) && game.type !== 'steam') {
      const appid = await this.steamSearch(game.name);
      if (appid) await save(await this.steamCdn(appid, want), 'steam-suche');
    }
    return result;
  }

  /** Mehrere Spiele nacheinander scrapen, mit Fortschritt-Events. */
  async scrapeAll(games, opts = {}) {
    if (this.running) throw new Error('Cover-Download läuft bereits');
    this.running = true;
    this.cancelled = false;
    const stats = { total: games.length, done: 0, found: 0, missing: 0, errors: 0, error: '' };
    this.emit('progress', { ...stats, current: '' });
    const ssActive = this._ssReady((this.getConfig().scraper || {}).screenscraper);
    const concurrency = ssActive ? 1 : 4; // ScreenScraper erlaubt kostenlosen Konten nur 1 gleichzeitige Anfrage
    let index = 0;
    const worker = async () => {
      while (!this.cancelled && index < games.length) {
        const game = games[index++];
        this.emit('progress', { ...stats, current: game.name });
        try {
          const r = await this.scrapeGame(game, opts);
          if (r.covers || r.snaps || r.skipped) stats.found++; else stats.missing++;
          this.trace(`${game.name}: ${r.skipped ? 'übersprungen' : r.covers || r.snaps ? `gefunden (${r.source || '?'})` : 'nichts gefunden'}`);
        } catch (err) {
          stats.errors++;
          stats.error = err.message;
          this.trace(`${game.name}: Fehler ${err.message}`);
          if (/Zugangsdaten|Tageslimit|API-Schlüssel/.test(err.message)) this.cancelled = true;
        }
        stats.done++;
        this.emit('progress', { ...stats, current: game.name });
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      this.running = false;
    }
    const final = { ...stats, finished: true, cancelled: this.cancelled };
    this.emit('progress', final);
    return final;
  }

  cancel() {
    this.cancelled = true;
  }
}

module.exports = { Scraper, normalize, bestMatch, LIBRETRO_SYSTEMS, SCREENSCRAPER_IDS, systemFromName, romTitle };
