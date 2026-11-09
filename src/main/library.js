'use strict';
/**
 * Bibliothek: findet Steam-Spiele, ROMs in den konfigurierten Ordnern und manuelle PC-Spiele.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const IGNORED_STEAM_APPS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '250820']);
// 228980 = Steamworks Redistributables, 1070560/1391110/1628350 = Steam Linux Runtime, 1493710/2180100 = Proton, 250820 = SteamVR

/** Minimaler VDF-Parser (Valve KeyValues) – reicht für libraryfolders.vdf und appmanifest_*.acf */
function parseVdf(text) {
  const root = {};
  const stack = [root];
  const re = /"((?:\\.|[^"\\])*)"|(\{)|(\})/g;
  let pendingKey = null;
  let m;
  while ((m = re.exec(text))) {
    const cur = stack[stack.length - 1];
    if (m[2]) {
      const obj = {};
      if (pendingKey !== null) cur[pendingKey] = obj;
      stack.push(obj);
      pendingKey = null;
    } else if (m[3]) {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
    } else {
      const str = m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
      if (pendingKey === null) pendingKey = str;
      else { cur[pendingKey] = str; pendingKey = null; }
    }
  }
  return root;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function fileUrl(p) {
  return p ? pathToFileURL(p).href : '';
}

function findSteamPath(configured) {
  const candidates = [
    configured,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    process.env.HOME && path.join(process.env.HOME, '.steam', 'steam'),
    process.env.HOME && path.join(process.env.HOME, '.local', 'share', 'Steam')
  ].filter(Boolean);
  return candidates.find((c) => exists(path.join(c, 'steamapps'))) || '';
}

function steamCover(steamPath, appid) {
  const cache = path.join(steamPath, 'appcache', 'librarycache');
  const options = [
    path.join(cache, `${appid}_library_600x900.jpg`),
    path.join(cache, String(appid), 'library_600x900.jpg'),
    path.join(cache, `${appid}_header.jpg`),
    path.join(cache, String(appid), 'header.jpg')
  ];
  const hit = options.find(exists);
  if (hit) return fileUrl(hit);
  // Neuere Steam-Versionen legen Bilder in Unterordnern mit Hash-Namen ab
  try {
    const dir = path.join(cache, String(appid));
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const p = path.join(dir, entry.name, 'library_600x900.jpg');
        if (exists(p)) return fileUrl(p);
      }
    }
  } catch { /* ignore */ }
  return '';
}

function steamHero(steamPath, appid) {
  const cache = path.join(steamPath, 'appcache', 'librarycache');
  const hit = [path.join(cache, `${appid}_library_hero.jpg`), path.join(cache, String(appid), 'library_hero.jpg')].find(exists);
  return hit ? fileUrl(hit) : '';
}

function scanSteam(cfg) {
  if (!cfg.steam.enabled) return [];
  const steamPath = findSteamPath(cfg.steam.path);
  if (!steamPath) return [];
  const libs = new Set([path.join(steamPath, 'steamapps')]);
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const lf = vdf.libraryfolders || vdf.LibraryFolders || {};
    for (const v of Object.values(lf)) {
      const p = typeof v === 'string' ? v : v && v.path;
      if (p && exists(path.join(p, 'steamapps'))) libs.add(path.join(p, 'steamapps'));
    }
  } catch { /* ignore */ }

  const games = [];
  for (const lib of libs) {
    let files = [];
    try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(lib, f), 'utf8')).AppState;
        if (!st || IGNORED_STEAM_APPS.has(st.appid)) continue;
        // StateFlags 4 = vollständig installiert
        if (st.StateFlags && (Number(st.StateFlags) & 4) === 0) continue;
        games.push({
          id: `steam-${st.appid}`,
          type: 'steam',
          system: 'steam',
          name: st.name,
          appid: st.appid,
          installDir: path.join(lib, 'common', st.installdir || ''),
          cover: steamCover(steamPath, st.appid),
          hero: steamHero(steamPath, st.appid)
        });
      } catch { /* ignore */ }
    }
  }
  return games.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** "Legend of Zelda, The - A Link to the Past" -> "The Legend of Zelda - A Link to the Past" */
function fixArticle(name) {
  return String(name).replace(/^(.+?), (The|A|An|Der|Die|Das|Le|La|Les)( - .*)?$/i, '$2 $1$3');
}

/** Hübscher Name aus Dateiname: "Super Mario World (USA) [!].sfc" -> "Super Mario World" */
function prettyName(file) {
  const base = path.basename(file, path.extname(file));
  const clean = base.replace(/\s*[([].*?[)\]]/g, '').replace(/_/g, ' ').trim();
  return fixArticle(clean || base);
}

function findRomCover(romPath, systemId, mediaDir) {
  const dir = path.dirname(romPath);
  const base = path.basename(romPath, path.extname(romPath));
  const dirs = [dir, path.join(dir, 'covers'), path.join(dir, 'media', 'covers'), path.join(dir, 'media', 'box2dfront'), path.join(dir, 'images')];
  if (mediaDir) dirs.push(path.join(mediaDir, systemId, 'covers'));
  for (const d of dirs) {
    for (const ext of IMAGE_EXT) {
      const p = path.join(d, base + ext);
      if (exists(p)) return fileUrl(p);
    }
  }
  return '';
}

/** Heruntergeladener Screenshot / Fanart als Hintergrundbild */
function findRomSnap(romPath, systemId, mediaDir) {
  if (!mediaDir) return '';
  const p = path.join(mediaDir, systemId, 'snaps', path.basename(romPath, path.extname(romPath)) + '.png');
  return exists(p) ? fileUrl(p) : '';
}

function walk(dir, exts, depth, out) {
  if (depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['covers', 'media', 'images', 'saves', 'states'].includes(e.name.toLowerCase())) walk(full, exts, depth - 1, out);
    } else if (exts.includes(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function scanRoms(cfg, mediaDir) {
  const games = [];
  for (const sys of cfg.systems) {
    if (sys.enabled === false) continue;
    const exts = (sys.extensions || []).map((e) => (e.startsWith('.') ? e : '.' + e).toLowerCase());
    const files = [];
    for (const d of sys.romDirs || []) walk(d, exts, 2, files);
    let titles = {};
    if (mediaDir) { try { titles = JSON.parse(fs.readFileSync(path.join(mediaDir, sys.id, 'names.json'), 'utf8')); } catch { /* keine */ } }
    // .cue/.bin Duplikate vermeiden: wenn .cue/.m3u existiert, zugehörige .bin ignorieren
    const set = new Set(files.map((f) => f.toLowerCase()));
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.bin') {
        const stem = f.slice(0, -4).toLowerCase();
        if (set.has(stem + '.cue')) continue;
      }
      games.push({
        id: `rom-${sys.id}-${Buffer.from(f).toString('base64url').slice(-40)}`,
        type: 'rom',
        system: sys.id,
        name: fixArticle(titles[path.basename(f, path.extname(f))] || prettyName(f)),
        rom: f,
        cover: findRomCover(f, sys.id, mediaDir),
        hero: findRomSnap(f, sys.id, mediaDir)
      });
    }
  }
  return games.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function manualGames(cfg) {
  return (cfg.pcGames || []).filter((g) => g && g.exe).map((g, i) => ({
    id: g.id || `pc-${i}`,
    type: 'pc',
    system: 'pc',
    source: 'Manuell hinzugefügt',
    name: g.name || prettyName(g.exe),
    exe: g.exe,
    args: g.args || '',
    cwd: g.cwd || '',
    killMode: g.killMode || 'dir',
    processName: g.processName || '',
    cover: toImageUrl(g.cover)
  }));
}

function toImageUrl(p) {
  if (!p) return '';
  return /^(https?|file|data):/.test(p) ? p : fileUrl(p);
}

/** Epic Games: Manifeste unter C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests */
function scanEpic(cfg) {
  if (!cfg.stores || !cfg.stores.epic || process.platform !== 'win32') return [];
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const games = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch { return []; }
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!m.DisplayName || !m.InstallLocation || (m.AppCategories || []).includes('plugins')) continue;
      if (m.bIsIncompleteInstall) continue;
      games.push({
        id: `epic-${m.AppName}`,
        type: 'epic',
        system: 'epic',
        source: 'Epic Games',
        name: m.DisplayName,
        launchUrl: `com.epicgames.launcher://apps/${encodeURIComponent(`${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}`)}?action=launch&silent=true`,
        installDir: m.InstallLocation,
        exe: m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : '',
        cover: ''
      });
    } catch { /* ignore */ }
  }
  return games.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** GOG Galaxy / GOG-Installationen stehen in der Registry */
function scanGog(cfg) {
  if (!cfg.stores || !cfg.stores.gog || process.platform !== 'win32') return [];
  let out = '';
  try {
    out = require('child_process').execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  } catch { return []; }
  const games = [];
  let cur = null;
  const push = () => { if (cur && cur.gameName && cur.exe && exists(cur.exe)) games.push(cur); };
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { push(); cur = { key: line.trim() }; continue; }
    const m = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*)$/);
    if (m && cur) cur[m[1]] = m[2].trim();
  }
  push();
  return games.map((g) => {
    const dir = g.path || path.dirname(g.exe);
    const icon = ['goggame-' + g.gameID + '.ico', 'cover.jpg'].map((n) => path.join(dir, n)).find(exists);
    return {
      id: `gog-${g.gameID || g.gameName}`,
      type: 'pc',
      system: 'gog',
      source: 'GOG',
      name: g.gameName,
      exe: g.exe,
      args: g.launchParam || '',
      cwd: g.workingDir || dir,
      killMode: 'dir',
      cover: icon && icon.endsWith('.jpg') ? fileUrl(icon) : ''
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Bekannte Emulatoren und typische Installationsorte (für "Emulatoren automatisch suchen") */
const KNOWN_EMULATORS = [
  { match: /^retroarch/, exe: 'retroarch.exe', dirs: ['C:\\RetroArch-Win64', 'C:\\RetroArch', '%PROGRAMFILES%\\RetroArch', '%APPDATA%\\RetroArch', '%STEAMAPPS%\\RetroArch'] },
  { match: /^dolphin$/, exe: 'Dolphin.exe', dirs: ['%PROGRAMFILES%\\Dolphin', '%PROGRAMFILES%\\Dolphin-x64', 'C:\\Emulatoren\\Dolphin', 'C:\\Emulatoren\\Dolphin-x64'] },
  { match: /^pcsx2$/, exe: 'pcsx2-qt.exe', dirs: ['%PROGRAMFILES%\\PCSX2', 'C:\\Emulatoren\\PCSX2'] },
  { match: /^duckstation$/, exe: 'duckstation-qt-x64-ReleaseLTCG.exe', dirs: ['%LOCALAPPDATA%\\Programs\\DuckStation', 'C:\\Emulatoren\\DuckStation', '%PROGRAMFILES%\\DuckStation'] },
  { match: /^ppsspp$/, exe: 'PPSSPPWindows64.exe', dirs: ['%PROGRAMFILES%\\PPSSPP', 'C:\\Emulatoren\\PPSSPP'] },
  { match: /^melonds$/, exe: 'melonDS.exe', dirs: ['C:\\Emulatoren\\melonDS', '%PROGRAMFILES%\\melonDS'] }
];

function expandEnv(p) {
  return p
    .replace('%PROGRAMFILES%', process.env.ProgramFiles || 'C:\\Program Files')
    .replace('%APPDATA%', process.env.APPDATA || '')
    .replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA || '')
    .replace('%STEAMAPPS%', path.join(findSteamPath('') || 'C:\\Program Files (x86)\\Steam', 'steamapps', 'common'));
}

/** Sucht Emulatoren an typischen Orten und trägt gefundene Pfade ein. Gibt Liste der Änderungen zurück. */
function detectEmulators(cfg) {
  const changes = [];
  for (const emu of cfg.emulators) {
    if (emu.exe && exists(emu.exe)) continue;
    const known = KNOWN_EMULATORS.find((k) => k.match.test(emu.id));
    if (!known) continue;
    const exeName = path.basename(emu.exe || known.exe) || known.exe;
    for (const d of known.dirs.map(expandEnv)) {
      const candidate = [path.join(d, exeName), path.join(d, known.exe)].find(exists);
      if (candidate) { emu.exe = candidate; changes.push({ id: emu.id, name: emu.name, exe: candidate }); break; }
    }
  }
  return changes;
}

function applyOverrides(cfg, games) {
  const ov = cfg.gameOverrides || {};
  for (const g of games) {
    const o = ov[g.id];
    if (!o) continue;
    if (o.name) g.name = o.name;
    if (o.cover) g.cover = toImageUrl(o.cover);
    if (o.hidden) g.hidden = true;
  }
  return games;
}

/** Emulator für ein ROM-Spiel bestimmen (Spiel-Override > System-Standard) */
function resolveEmulator(cfg, game) {
  const sys = cfg.systems.find((s) => s.id === game.system);
  const ov = (cfg.gameOverrides || {})[game.id] || {};
  const id = ov.emulator || (sys && sys.emulator);
  return { emulator: cfg.emulators.find((e) => e.id === id) || null, isOverride: !!ov.emulator };
}

function scanLibrary(cfg, opts = {}) {
  const steam = scanSteam(cfg);
  const epic = scanEpic(cfg);
  const gog = scanGog(cfg);
  const pc = manualGames(cfg);
  const roms = scanRoms(cfg, opts.mediaDir);
  for (const g of roms) {
    const { emulator, isOverride } = resolveEmulator(cfg, g);
    g.emulatorId = emulator ? emulator.id : '';
    g.emulatorName = emulator ? emulator.name : 'Kein Emulator';
    g.emulatorOverride = isOverride;
    g.source = emulator ? emulator.name : 'Kein Emulator';
  }
  for (const g of steam) g.source = 'Steam';

  const emulators = cfg.emulators.map((e) => ({ id: e.id, name: e.name, exe: e.exe, found: !!e.exe && exists(e.exe) }));
  const systems = [];
  if (steam.length) systems.push({ id: 'steam', kind: 'store', name: 'Steam', short: 'Steam', color: '#1b2838' });
  if (epic.length) systems.push({ id: 'epic', kind: 'store', name: 'Epic Games', short: 'Epic', color: '#2a2a2a' });
  if (gog.length) systems.push({ id: 'gog', kind: 'store', name: 'GOG', short: 'GOG', color: '#86328a' });
  if (pc.length) systems.push({ id: 'pc', kind: 'store', name: 'Eigene Spiele', short: 'Eigene', color: '#0f7b6c' });
  for (const s of cfg.systems) {
    if (s.enabled === false) continue;
    const emu = cfg.emulators.find((e) => e.id === s.emulator);
    systems.push({
      id: s.id, kind: 'emulator', name: s.name, short: s.short || s.name, color: s.color || '#444',
      emulatorId: emu ? emu.id : '', emulatorName: emu ? emu.name : 'Kein Emulator',
      emulatorFound: !!emu && exists(emu.exe),
      count: roms.filter((g) => g.system === s.id).length,
      logo: s.logo ? toImageUrl(s.logo) : '',
      romDirs: s.romDirs || []
    });
  }
  const games = applyOverrides(cfg, [...steam, ...epic, ...gog, ...pc, ...roms]);
  return { systems, games, emulators, steamFound: !!findSteamPath(cfg.steam.path) };
}

module.exports = { scanLibrary, parseVdf, prettyName, findSteamPath, detectEmulators, resolveEmulator };
