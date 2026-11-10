'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseVdf, prettyName, scanLibrary, resolveEmulator } = require('../src/main/library');
const { splitArgs, fillPlaceholders } = require('../src/main/launcher');
const { parseCombo, BUTTONS, GamepadWatcher } = require('../src/main/gamepad-watcher');
const { mergeDefaults, DEFAULT_CONFIG, ConfigStore } = require('../src/main/config');

test('VDF-Parser liest libraryfolders und appmanifest', () => {
  const v = parseVdf(`"libraryfolders" { "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "570" "123" } } "1" { "path" "D:\\\\SteamLibrary" } }`);
  assert.strictEqual(v.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.strictEqual(v.libraryfolders['1'].path, 'D:\\SteamLibrary');
  const m = parseVdf(`"AppState"\n{\n\t"appid"\t\t"570"\n\t"name"\t\t"Dota 2"\n\t"installdir"\t\t"dota 2 beta"\n}`);
  assert.deepStrictEqual(m.AppState, { appid: '570', name: 'Dota 2', installdir: 'dota 2 beta' });
});

test('Spielnamen werden aus Dateinamen bereinigt', () => {
  assert.strictEqual(prettyName('Super Mario World (USA) [!].sfc'), 'Super Mario World');
  assert.strictEqual(prettyName('zelda_ocarina.z64'), 'zelda ocarina');
});

test('Argumente mit Anführungszeichen und Platzhaltern', () => {
  const args = splitArgs('-f -L cores\\snes9x_libretro.dll "{rom}"').map((a) => fillPlaceholders(a, { rom: 'C:\\ROMs\\My Game.sfc' }));
  assert.deepStrictEqual(args, ['-f', '-L', 'cores\\snes9x_libretro.dll', 'C:\\ROMs\\My Game.sfc']);
});

test('Controller-Kombinationen inkl. Aliasse', () => {
  assert.strictEqual(parseCombo('BACK+START'), BUTTONS.BACK | BUTTONS.START);
  assert.strictEqual(parseCombo('select + options'), BUTTONS.BACK | BUTTONS.START);
  assert.strictEqual(parseCombo('PS'), BUTTONS.GUIDE);
  assert.strictEqual(parseCombo('FOO'), 0);
});

test('Watcher löst Kombination erst nach Haltezeit aus', async () => {
  const w = new GamepadWatcher();
  w.setCombos([{ name: 'closeGame', combo: 'BACK+START', holdMs: 50 }]);
  const fired = [];
  w.on('combo', (c) => fired.push(c.name));
  w._update(0, BUTTONS.BACK | BUTTONS.START);
  w._update(0, 0); // zu kurz
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(fired, []);
  w._update(0, BUTTONS.BACK | BUTTONS.START | BUTTONS.A);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(fired, ['closeGame']);
});

test('Konfiguration ergänzt fehlende Schlüssel', () => {
  const merged = mergeDefaults(DEFAULT_CONFIG, { general: { uiScale: 1.3 }, favorites: ['x'] });
  assert.strictEqual(merged.general.uiScale, 1.3);
  assert.strictEqual(merged.general.startFullscreen, true);
  assert.deepStrictEqual(merged.favorites, ['x']);
  assert.ok(merged.controller.closeGameCombo);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-'));
  const s = new ConfigStore(dir);
  s.load();
  assert.ok(fs.existsSync(path.join(dir, 'config.json')));
});

test('ROM-Scan, Cover-Erkennung und Emulator pro Spiel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-roms-'));
  fs.mkdirSync(path.join(dir, 'covers'));
  fs.writeFileSync(path.join(dir, 'Game A (USA).sfc'), '');
  fs.writeFileSync(path.join(dir, 'covers', 'Game A (USA).png'), '');
  fs.writeFileSync(path.join(dir, 'readme.txt'), '');
  const emuExe = path.join(dir, 'emu.exe');
  fs.writeFileSync(emuExe, '');
  const cfg = mergeDefaults(DEFAULT_CONFIG, {
    steam: { enabled: false },
    stores: { epic: false, gog: false },
    emulators: [{ id: 'e1', name: 'Emu Eins', exe: emuExe, args: '"{rom}"' }, { id: 'e2', name: 'Emu Zwei', exe: '', args: '' }],
    systems: [{ id: 'snes', name: 'SNES', short: 'SNES', extensions: ['.sfc'], romDirs: [dir], emulator: 'e1' }],
    pcGames: [{ id: 'pc-1', name: 'Kodi', exe: 'C:\\Kodi\\kodi.exe' }]
  });
  const lib = scanLibrary(cfg);
  const rom = lib.games.find((g) => g.type === 'rom');
  assert.strictEqual(rom.name, 'Game A');
  assert.match(rom.cover, /^file:.*covers/);
  assert.strictEqual(rom.emulatorName, 'Emu Eins');
  assert.ok(lib.systems.find((s) => s.id === 'snes').emulatorFound);
  assert.ok(lib.games.find((g) => g.id === 'pc-1'));

  cfg.gameOverrides[rom.id] = { emulator: 'e2', name: 'Umbenannt' };
  const lib2 = scanLibrary(cfg);
  const rom2 = lib2.games.find((g) => g.type === 'rom');
  assert.strictEqual(rom2.emulatorName, 'Emu Zwei');
  assert.strictEqual(rom2.emulatorOverride, true);
  assert.strictEqual(rom2.name, 'Umbenannt');
  assert.strictEqual(resolveEmulator(cfg, rom2).emulator.id, 'e2');
});

test('PlayStation-HID-Reports werden korrekt gelesen', () => {
  const { parseReport } = require('../src/main/ps-hid-watcher');
  // DualSense USB: Report 0x01, Buttons ab Byte 8
  const ds = Buffer.alloc(64); ds[0] = 0x01; ds[8] = 0x08 | 0x20; // kein Steuerkreuz, ✕
  ds[9] = 0x10 | 0x20; // Create + Options
  assert.strictEqual(parseReport(0x0ce6, ds), BUTTONS.A | BUTTONS.BACK | BUTTONS.START);
  // DualSense Bluetooth: Report 0x31, eins weiter
  const bt = Buffer.alloc(78); bt[0] = 0x31; bt[9] = 0x00 | 0x80; bt[11] = 0x01; // Steuerkreuz hoch, △, PS
  assert.strictEqual(parseReport(0x0ce6, bt), BUTTONS.UP | BUTTONS.Y | BUTTONS.GUIDE);
  // DualShock 4 USB: Buttons ab Byte 5, R2 analog
  const ds4 = Buffer.alloc(64); ds4[0] = 0x01; ds4[5] = 0x08 | 0x40; ds4[6] = 0x01; ds4[9] = 200;
  assert.strictEqual(parseReport(0x09cc, ds4), BUTTONS.B | BUTTONS.LB | BUTTONS.RT);
  // DualShock 4 Bluetooth: Report 0x11
  const ds4bt = Buffer.alloc(78); ds4bt[0] = 0x11; ds4bt[7] = 0x08 | 0x10; ds4bt[9] = 0x02;
  assert.strictEqual(parseReport(0x05c4, ds4bt), BUTTONS.X | BUTTONS.TOUCHPAD);
  assert.strictEqual(parseReport(0x0ce6, Buffer.from([0x05, 1, 2])), null);
  // Kombination mit PlayStation-Namen
  assert.strictEqual(parseCombo('CREATE+OPTIONS'), BUTTONS.BACK | BUTTONS.START);
});

test('Leistungsmodus: Empfehlungen und Prozessnamen', () => {
  const { RECOMMENDED, names } = require('../src/main/performance');
  const we = RECOMMENDED.find((r) => r.name === 'Wallpaper Engine');
  assert.deepStrictEqual(names(we), ['wallpaper64', 'wallpaper32']);
  assert.ok(RECOMMENDED.every((r) => r.process && ['pause', 'close', 'kill'].includes(r.action)));
  assert.strictEqual(DEFAULT_CONFIG.performance.programs[0].name, 'Wallpaper Engine');
});

test('Cover-Abgleich: Namen normalisieren und beste Region wählen', () => {
  const { normalize, bestMatch } = require('../src/main/scraper');
  assert.strictEqual(normalize('Legend of Zelda, The - A Link to the Past (USA).sfc'), normalize('The Legend of Zelda - A Link to the Past'));
  const files = ['Super Mario World (Japan).png', 'Super Mario World (USA).png', 'Super Mario World (Europe).png', 'Super Mario World (USA) (Beta).png'];
  assert.strictEqual(bestMatch('Super Mario World (USA).sfc', files), 'Super Mario World (USA).png');
  assert.strictEqual(bestMatch('super_mario_world.sfc', files), 'Super Mario World (Europe).png');
  assert.strictEqual(bestMatch('Unbekanntes Spiel.sfc', files), null);
});

test('ScreenScraper: Antwort auswerten, Region bevorzugen, Bild speichern', async () => {
  const { Scraper } = require('../src/main/scraper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-ss-'));
  const rom = path.join(dir, 'Sonic.md');
  fs.writeFileSync(rom, Buffer.alloc(1024, 1));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(500)]);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('jeuInfos.php')) {
      return { ok: true, text: async () => JSON.stringify({ response: { jeu: { medias: [
        { type: 'box-2D', region: 'us', url: 'https://ss/box-us' },
        { type: 'box-2D', region: 'eu', url: 'https://ss/box-eu' },
        { type: 'fanart', region: 'wor', url: 'https://ss/fanart' }
      ] } } }) };
    }
    return { ok: true, arrayBuffer: async () => png };
  };
  const cfg = mergeDefaults(DEFAULT_CONFIG, { scraper: { screenscraper: { user: 'u', password: 'p', devid: 'd', devpassword: 'dp' } } });
  const s = new Scraper({ mediaDir: path.join(dir, 'media'), fetch: fakeFetch, getConfig: () => cfg });
  const r = await s.scrapeGame({ id: 'x', system: 'md', rom, name: 'Sonic' });
  assert.deepStrictEqual([r.covers, r.snaps, r.source], [true, true, 'screenscraper']);
  assert.ok(calls[0].includes('systemeid=1') && calls[0].includes('romnom=Sonic.md') && calls[0].includes('crc='));
  assert.ok(calls.includes('https://ss/box-eu'), 'europäisches Cover bevorzugt');
  assert.ok(fs.existsSync(path.join(dir, 'media', 'md', 'covers', 'Sonic.png')));
  // Bibliothek findet das heruntergeladene Bild
  const lib = scanLibrary(mergeDefaults(DEFAULT_CONFIG, { steam: { enabled: false }, stores: { epic: false, gog: false },
    systems: [{ id: 'md', name: 'MD', extensions: ['.md'], romDirs: [dir], emulator: 'x' }] }), { mediaDir: path.join(dir, 'media') });
  assert.match(lib.games[0].cover, /media.*covers.*Sonic\.png/);
  assert.match(lib.games[0].hero, /snaps.*Sonic\.png/);
});

test('Spielnamen: Artikel nach vorne', () => {
  assert.strictEqual(prettyName('Legend of Zelda, The - A Link to the Past (USA).sfc'), 'The Legend of Zelda - A Link to the Past');
});

test('Home Assistant: Fernseher einschalten, warten, HDMI-Eingang wählen', async () => {
  const { HomeAssistant } = require('../src/main/homeassistant');
  let tv = { state: 'off', attributes: { source: 'HDMI 1', source_list: ['HDMI 1', 'HDMI 2'] } };
  const calls = [];
  const fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push(`${opts.method} ${u.pathname}${opts.body ? ' ' + opts.body : ''}`);
    assert.strictEqual(opts.headers.Authorization, 'Bearer TOKEN');
    let body = null;
    if (u.pathname === '/api/states/media_player.tv') body = tv;
    if (u.pathname === '/api/services/media_player/turn_on') { setTimeout(() => { tv = { ...tv, state: 'on' }; }, 50); body = []; }
    if (u.pathname === '/api/services/media_player/select_source') { tv = { ...tv, attributes: { ...tv.attributes, source: JSON.parse(opts.body).source } }; body = []; }
    if (u.pathname === '/api/services/scene/turn_on' || u.pathname === '/api/services/light/turn_off' || u.pathname === '/api/services/media_player/turn_off') body = [];
    return { ok: body !== null, status: body !== null ? 200 : 404, text: async () => JSON.stringify(body) };
  };
  const cfg = { homeassistant: { enabled: true, url: 'http://ha.local:8123/', token: 'TOKEN', tvEntity: 'media_player.tv', source: 'HDMI 2', waitForTvSeconds: 5,
    startServices: ['scene.gaming', 'light.turn_off:light.decke'], turnOffAtShutdown: true } };
  const ha = new HomeAssistant({ fetch, getConfig: () => cfg });
  const r = await ha.onStart();
  assert.deepStrictEqual(r, { on: true, source: 'HDMI 2' });
  assert.ok(calls.includes('POST /api/services/media_player/turn_on {"entity_id":"media_player.tv"}'));
  assert.ok(calls.some((c) => c.startsWith('POST /api/services/media_player/select_source') && c.includes('HDMI 2')));
  assert.ok(calls.includes('POST /api/services/scene/turn_on {"entity_id":"scene.gaming"}'));
  assert.ok(calls.includes('POST /api/services/light/turn_off {"entity_id":"light.decke"}'));
  // Einschalten passiert vor dem Umschalten des Eingangs
  assert.ok(calls.findIndex((c) => c.includes('turn_on {"entity_id":"media_player.tv"}')) < calls.findIndex((c) => c.includes('select_source')));
  await ha.onExit({ shutdown: true });
  assert.ok(calls.includes('POST /api/services/media_player/turn_off {"entity_id":"media_player.tv"}'));
  // Deaktiviert -> nichts passiert
  cfg.homeassistant.enabled = false;
  assert.strictEqual(await ha.onStart(), null);
});

test('Maussteuerung: Stick bewegt Maus, Tasten klicken, Kombination wird ignoriert', () => {
  const { MouseMode, curve } = require('../src/main/mouse-mode');
  assert.strictEqual(curve(0.1), 0); // Totzone
  assert.ok(curve(1) === 1 && curve(-1) === -1 && curve(0.6) > 0 && curve(0.6) < 0.6);
  const sent = [];
  const mm = new MouseMode({ getConfig: () => ({ controller: { mouseSpeed: 1 } }), send: (l) => sent.push(l) });
  // Beim Einschalten sind BACK+Y gedrückt -> Y darf kein Enter auslösen
  mm.update({ id: 'p', mask: BUTTONS.BACK | BUTTONS.Y, axes: [0, 0, 0, 0] });
  mm.setActive(true);
  clearInterval(mm.timer);
  mm.lastTick = Date.now() - 20; mm.tick();
  assert.ok(!sent.some((l) => l.startsWith('k 13')));
  mm.update({ id: 'p', mask: 0, axes: [1, 0.5, 0, -1] });
  mm.lastTick = Date.now() - 20; mm.tick();
  const move = sent.find((l) => l.startsWith('m '));
  assert.ok(move, 'Maus bewegt');
  const [, dx, dy] = move.split(' ').map(Number);
  assert.ok(dx > 10 && dy > 0 && dy < dx);
  mm.update({ id: 'p', mask: BUTTONS.A, axes: [0, 0, 0, 0] });
  mm.lastTick = Date.now() - 20; mm.tick();
  assert.ok(sent.includes('b L 1'));
  mm.update({ id: 'p', mask: BUTTONS.Y, axes: [0, 0, 0, 0] });
  mm.lastTick = Date.now() - 20; mm.tick();
  assert.ok(sent.includes('b L 0') && sent.includes('k 13 1'));
  mm.setActive(false);
  assert.ok(sent.includes('k 13 0'), 'beim Ausschalten alles loslassen');
});

test('PlayStation: Analog-Sticks auslesen', () => {
  const { parseAxes } = require('../src/main/ps-hid-watcher');
  const ds = Buffer.alloc(64); ds[0] = 0x01; ds[1] = 255; ds[2] = 0; ds[3] = 128; ds[4] = 128;
  const a = parseAxes(0x0ce6, ds);
  assert.ok(a[0] === 1 && a[1] === -1 && a[2] === 0);
  const bt = Buffer.alloc(78); bt[0] = 0x31; bt[2] = 1; bt[3] = 128; bt[4] = 128; bt[5] = 255;
  assert.ok(parseAxes(0x0ce6, bt)[0] < -0.98 && parseAxes(0x0ce6, bt)[3] === 1);
});

test('Touchpad: Daten lesen und als Maus verwenden', () => {
  const { parseTouch, TouchpadMouse } = require('../src/main/touchpad');
  // Touchpunkt kodieren (4 Bytes): aktiv-Bit, ID, 12 Bit X, 12 Bit Y
  const enc = (buf, o, f) => {
    if (!f) { buf[o] = 0x80; return; }
    buf[o] = f.id & 0x7f; buf[o + 1] = f.x & 0xff; buf[o + 2] = ((f.x >> 8) & 0x0f) | ((f.y & 0x0f) << 4); buf[o + 3] = f.y >> 4;
  };
  const report = (fingers, bt) => {
    const b = Buffer.alloc(bt ? 78 : 64); b[0] = bt ? 0x31 : 0x01;
    const o = bt ? 34 : 33; enc(b, o, fingers[0]); enc(b, o + 4, fingers[1]); return b;
  };
  assert.deepStrictEqual(parseTouch(0x0ce6, report([{ id: 5, x: 1500, y: 900 }])).fingers, [{ id: 5, x: 1500, y: 900 }]);
  assert.strictEqual(parseTouch(0x0ce6, report([{ id: 1, x: 10, y: 20 }, { id: 2, x: 1900, y: 1000 }], true)).fingers.length, 2);
  assert.strictEqual(parseTouch(0x0ce6, report([])).fingers.length, 0);

  const sent = []; let enabled = true;
  const tp = new TouchpadMouse({ send: (l) => sent.push(l), getConfig: () => ({ controller: {} }), isEnabled: () => enabled });
  const t = (fingers) => parseTouch(0x0ce6, report(fingers));
  // Bewegen
  tp.update('d', t([{ id: 1, x: 100, y: 100 }]), false, 0);
  tp.update('d', t([{ id: 1, x: 140, y: 110 }]), false, 30);
  const m = sent.find((l) => l.startsWith('m '));
  assert.ok(m && Number(m.split(' ')[1]) > 40 && Number(m.split(' ')[2]) > 0);
  // Loslassen nach Bewegung: kein Tipp-Klick
  tp.update('d', t([]), false, 60);
  assert.ok(!sent.includes('b L 1'));
  // Kurz antippen = Linksklick
  tp.update('d', t([{ id: 2, x: 500, y: 500 }]), false, 1000);
  tp.update('d', t([]), false, 1100);
  assert.deepStrictEqual(sent.slice(-2), ['b L 1', 'b L 0']);
  // Mit 2 Fingern drücken = Rechtsklick
  tp.update('d', t([{ id: 3, x: 500, y: 500 }, { id: 4, x: 800, y: 500 }]), true, 2000);
  assert.strictEqual(sent[sent.length - 1], 'b R 1');
  tp.update('d', t([{ id: 3, x: 500, y: 500 }, { id: 4, x: 800, y: 500 }]), false, 2100);
  assert.strictEqual(sent[sent.length - 1], 'b R 0');
  // 2 Finger bewegen = scrollen
  tp.update('d', t([{ id: 3, x: 500, y: 560 }, { id: 4, x: 800, y: 560 }]), false, 2200);
  assert.ok(sent[sent.length - 1].startsWith('w '));
  tp.update('d', t([]), false, 2300);
  // Während eines Spiels: nichts senden
  enabled = false; const n = sent.length;
  tp.update('d', t([{ id: 6, x: 100, y: 100 }]), true, 3000);
  tp.update('d', t([{ id: 6, x: 300, y: 300 }]), true, 3030);
  assert.strictEqual(sent.length, n);
});

test('Eigene Programme: Verknüpfungen, URLs und Batch-Dateien richtig starten', () => {
  const { Launcher, isSafeKillDir, readUrlFile } = require('../src/main/launcher');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-launch-'));
  const exe = path.join(dir, 'Tool', 'tool.exe'); fs.mkdirSync(path.dirname(exe)); fs.writeFileSync(exe, '');
  const lnk = path.join(dir, 'Tool.lnk'); fs.writeFileSync(lnk, '');
  const store = path.join(dir, 'StoreApp.lnk'); fs.writeFileSync(store, '');
  const url = path.join(dir, 'Seite.url'); fs.writeFileSync(url, '[InternetShortcut]\r\nURL=steam://rungameid/570\r\n');
  const bat = path.join(dir, 'start.bat'); fs.writeFileSync(bat, '@echo off');
  const l = new Launcher(() => ({}), {
    readShortcutLink: (p) => (p === lnk ? { target: exe, args: '--fullscreen', cwd: '' } : { target: '' })
  });
  assert.deepStrictEqual(l.resolveTarget({ exe: lnk, args: '-x' }), { mode: 'spawn', exe, args: ['--fullscreen', '-x'], cwd: path.dirname(exe) });
  assert.strictEqual(l.resolveTarget({ exe: store }).mode, 'open');
  assert.strictEqual(readUrlFile(url), 'steam://rungameid/570');
  assert.deepStrictEqual(l.resolveTarget({ exe: url }), { mode: 'url', url: 'steam://rungameid/570' });
  assert.deepStrictEqual(l.resolveTarget({ exe: 'steam://open/bigpicture' }), { mode: 'url', url: 'steam://open/bigpicture' });
  assert.strictEqual(l.resolveTarget({ exe: bat }).viaCmd, true);
  assert.strictEqual(l.resolveTarget({ exe }).mode, 'spawn');
  // Systemordner dürfen nie "als Spielordner" beendet werden
  const old = process.env.SystemRoot;
  process.env.SystemRoot = path.join(dir, 'Windows');
  assert.strictEqual(isSafeKillDir(path.join(dir, 'Windows', 'System32')), false);
  assert.strictEqual(isSafeKillDir(path.join(dir, 'Windows')), false);
  assert.strictEqual(isSafeKillDir(path.parse(dir).root), false);
  assert.strictEqual(isSafeKillDir(path.join(dir, 'Tool')), true);
  if (old === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = old;
});

test('Updates: GitHub abfragen, Versionen vergleichen, herunterladen', async () => {
  const { Updater, compareVersions, cleanNotes } = require('../src/main/updater');
  assert.strictEqual(compareVersions('1.10.0', '1.9.3'), 1);
  assert.strictEqual(compareVersions('v1.5.0', '1.5.0'), 0);
  assert.strictEqual(compareVersions('1.4.0', '1.5.0'), -1);
  assert.strictEqual(cleanNotes('## Neu\n- **Fett** [Link](http://x)\n\n\n- Zwei'), 'Neu\n- Fett Link\n\n- Zwei');
  const release = { tag_name: 'v1.5.0', body: '- Tastatur\n- Konsolen-Bilder', html_url: 'https://github.com/AleB-Roni/AleGamestation/releases/tag/v1.5.0',
    assets: [{ name: 'AleGamestation-Setup-1.5.0.exe', browser_download_url: 'https://github.com/x.exe' }, { name: 'latest.yml' }] };
  const fetch = async (url) => { assert.match(url, /api\.github\.com\/repos\/AleB-Roni\/AleGamestation\/releases\/latest/); return { ok: true, text: async () => JSON.stringify(release) }; };
  // Ohne electron-updater (Entwicklerversion): nur Hinweis + Installer-Link
  const u1 = new Updater({ version: '1.4.0', isPackaged: false, fetch });
  const s1 = await u1.check();
  assert.deepStrictEqual([s1.status, s1.available, s1.canInstall, s1.installerUrl], ['available', '1.5.0', false, 'https://github.com/x.exe']);
  assert.match(s1.notes, /Tastatur/);
  // Bereits aktuell
  assert.strictEqual((await new Updater({ version: '1.5.0', isPackaged: false, fetch }).check()).status, 'latest');
  // Mit (simuliertem) electron-updater, automatisches Herunterladen aus
  const { EventEmitter } = require('events');
  const au = new EventEmitter();
  au.checkForUpdates = async () => { au.emit('update-available', { version: '1.5.0' }); };
  au.downloadUpdate = async () => { au.emit('download-progress', { percent: 50 }); au.emit('update-downloaded', { version: '1.5.0' }); };
  let installed = false; au.quitAndInstall = () => { installed = true; };
  const u2 = new Updater({ version: '1.4.0', isPackaged: true, fetch, autoUpdater: au, getConfig: () => ({ general: { autoDownloadUpdates: false } }) });
  const s2 = await u2.check();
  assert.deepStrictEqual([s2.status, s2.canInstall], ['available', true]);
  await u2.download();
  assert.strictEqual(u2.get().status, 'ready');
  assert.ok(u2.install() && installed);
  // GitHub nicht erreichbar
  const u3 = new Updater({ version: '1.4.0', isPackaged: false, fetch: async () => { throw new Error('offline'); } });
  assert.strictEqual((await u3.check()).status, 'error');
});

test('Emulatoren ohne Konsole erscheinen trotzdem im Emulatoren-Tab', () => {
  const cfg = mergeDefaults(DEFAULT_CONFIG, {
    steam: { enabled: false }, stores: { epic: false, gog: false },
    emulators: [{ id: 'ra', name: 'RetroArch', exe: '', args: '' }, { id: 'eden', name: 'Eden', exe: '', args: '' }],
    systems: [{ id: 'snes', name: 'SNES', extensions: ['.sfc'], romDirs: [], emulator: 'ra' }]
  });
  const lib = scanLibrary(cfg);
  const emu = lib.systems.filter((s) => s.kind === 'emulator');
  assert.deepStrictEqual(emu.map((s) => s.id), ['snes', 'emu:eden']);
  assert.strictEqual(emu[1].standalone, true);
  // Sobald Eden einer Konsole zugeordnet ist, verschwindet die Einzel-Kachel
  cfg.systems.push({ id: 'switch', name: 'Switch', extensions: ['.nsp'], romDirs: [], emulator: 'eden' });
  assert.deepStrictEqual(scanLibrary(cfg).systems.filter((s) => s.kind === 'emulator').map((s) => s.id), ['snes', 'switch']);
});

test('PS-Taste: Schnellmenü-Kombination und Tasten-Ereignisse', async () => {
  const w = new GamepadWatcher();
  w.setCombos([{ name: 'guideMenu', combo: 'GUIDE', holdMs: 0 }, { name: 'closeGame', combo: 'CREATE+OPTIONS', holdMs: 30 }]);
  const combos = []; const pressed = [];
  w.on('combo', (c) => combos.push(c.name));
  w.on('pressed', (p) => pressed.push(p.pressed));
  w._update('ps:1', BUTTONS.GUIDE);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(combos, ['guideMenu']);
  w._update('ps:1', 0);
  w._update('ps:1', BUTTONS.A);
  assert.deepStrictEqual(pressed, [BUTTONS.GUIDE, BUTTONS.A]);
  // Create + Options (= BACK + START) gehalten
  w._update('ps:1', BUTTONS.BACK | BUTTONS.START);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(combos.includes('closeGame'));
});

test('PC-Spiele: Bilder über Steam-CDN, Steam-Suche und SteamGridDB', async () => {
  const { Scraper } = require('../src/main/scraper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-pc-'));
  const img = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(600)]);
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => img });
    if (url.includes('storesearch')) {
      if (url.includes('Witcher')) return ok({ items: [{ id: 999, name: 'Gwent' }, { id: 292030, name: 'The Witcher 3: Wild Hunt' }] });
      return ok({ items: [{ id: 1, name: 'Etwas völlig anderes' }] });
    }
    if (url.includes('steamgriddb.com/api/v2/search')) { assert.strictEqual(opts.headers.Authorization, 'Bearer KEY'); return ok({ data: [{ id: 42 }] }); }
    if (url.includes('steamgriddb.com/api/v2/grids')) return ok({ data: [{ url: 'https://cdn2.steamgriddb.com/grid.png' }] });
    if (url.includes('steamgriddb.com/api/v2/heroes')) return ok({ data: [{ url: 'https://cdn2.steamgriddb.com/hero.png' }] });
    if (url.includes('library_600x900_2x.jpg') && url.includes('/570/')) return { ok: false, status: 404 }; // ältere Spiele ohne 2x
    return ok({});
  };
  let cfg = { scraper: { downloadSnaps: true }, systems: [] };
  const s = new Scraper({ mediaDir: dir, fetch, getConfig: () => cfg });
  // Steam-Spiel ohne lokales Bild
  const r1 = await s.scrapePcGame({ id: 'steam-570', type: 'steam', system: 'steam', appid: '570', name: 'Dota 2' });
  assert.deepStrictEqual([r1.covers, r1.snaps, r1.source], [true, true, 'steam']);
  assert.ok(calls.includes('https://shared.steamstatic.com/store_item_assets/steam/apps/570/library_600x900.jpg'));
  assert.ok(fs.existsSync(path.join(dir, 'steam', 'covers', 'steam-570.png')));
  // Epic-Spiel: über die Steam-Suche (Präfix-Treffer, nicht "Gwent")
  const r2 = await s.scrapePcGame({ id: 'epic-Abc', type: 'epic', system: 'epic', name: 'The Witcher 3' });
  assert.strictEqual(r2.source, 'steam-suche');
  assert.ok(calls.some((u) => u.includes('/apps/292030/')));
  // Kein passender Treffer -> nichts Falsches laden
  const r3 = await s.scrapePcGame({ id: 'pc-1', type: 'pc', system: 'pc', name: 'Mein Tool' });
  assert.deepStrictEqual([r3.covers, r3.snaps], [false, false]);
  // Mit SteamGridDB-Schlüssel
  cfg = { scraper: { downloadSnaps: true, steamgriddbKey: 'KEY' }, systems: [] };
  const r4 = await s.scrapePcGame({ id: 'pc-2', type: 'pc', system: 'pc', name: 'Fortnite' });
  assert.deepStrictEqual([r4.covers, r4.snaps, r4.source], [true, true, 'steamgriddb']);
  // Bibliothek findet die heruntergeladenen Bilder
  const lib = scanLibrary(mergeDefaults(DEFAULT_CONFIG, { steam: { enabled: false }, stores: { epic: false, gog: false }, systems: [], emulators: [],
    pcGames: [{ id: 'pc-2', name: 'Fortnite', exe: 'C:\\Fortnite.exe' }] }), { mediaDir: dir });
  const g = lib.games.find((x) => x.id === 'pc-2');
  assert.match(g.cover, /pc\/covers\/pc-2\.png$/);
  assert.match(g.hero, /pc\/snaps\/pc-2\.png$/);
});

test('Spotify-Titel aus dem Fenstertitel lesen', () => {
  const { parseSpotifyTitle } = require('../src/main/media');
  assert.deepStrictEqual(parseSpotifyTitle('Daft Punk - Get Lucky (feat. Pharrell)'), { running: true, playing: true, artist: 'Daft Punk', title: 'Get Lucky (feat. Pharrell)' });
  assert.deepStrictEqual(parseSpotifyTitle('Spotify Premium'), { running: true, playing: false });
  assert.deepStrictEqual(parseSpotifyTitle(''), { running: false, playing: false });
});

test('Tasten loslassen wird gemeldet (PS-Taste halten vs. kurz drücken)', () => {
  const w = new GamepadWatcher();
  const ev = [];
  w.on('pressed', (e) => ev.push('down:' + e.pressed));
  w.on('released', (e) => ev.push('up:' + e.released));
  w._update('ps:1', BUTTONS.GUIDE);
  w._update('ps:1', 0);
  assert.deepStrictEqual(ev, ['down:' + BUTTONS.GUIDE, 'up:' + BUTTONS.GUIDE]);
});
