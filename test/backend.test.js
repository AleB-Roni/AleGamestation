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
  const cfg = { homeassistant: { enabled: true, url: 'http://ha.local:8123/', token: 'TOKEN', tvEntity: 'media_player.tv', source: 'HDMI 2', waitForTvSeconds: 5, sourceDelaySeconds: 0,
    startServices: ['scene.gaming', 'light.turn_off:light.decke'], turnOffAtShutdown: true } };
  const ha = new HomeAssistant({ fetch, getConfig: () => cfg });
  const r = await ha.onStart();
  assert.deepStrictEqual(r, { on: true, source: 'HDMI 2', via: '' });
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

test('Updates: verständliche Meldung, wenn das Repository privat ist (404)', async () => {
  const { Updater } = require('../src/main/updater');
  const u = new Updater({ version: '1.7.0', isPackaged: false, fetch: async () => ({ ok: false, status: 404, text: async () => '{}' }) });
  const s = await u.check();
  assert.strictEqual(s.status, 'error');
  assert.match(s.error, /privat/);
});

test('ROMs ausblenden: Update-/DLC-Dateien automatisch und eigene Regeln', () => {
  const { isUpdateFile, romHideReason } = require('../src/main/library');
  // Switch: Basisspiel [v0]/…000 sichtbar, Update [v65536]/…800 und DLC ausgeblendet
  assert.strictEqual(isUpdateFile('Zelda [01007EF00011E000][v0].nsp'), false);
  assert.strictEqual(isUpdateFile('Zelda [01007EF00011E800][v65536].nsp'), true);
  assert.strictEqual(isUpdateFile('Zelda DLC [01007EF00011F001][v0].nsp'), true);
  assert.strictEqual(isUpdateFile('Game (Update 1.2).nsp'), true);
  assert.strictEqual(isUpdateFile('Game [UPD].xci'), true);
  assert.strictEqual(isUpdateFile('Updates/Game.nsp'), true);
  assert.strictEqual(isUpdateFile('Cabbage Patch Kids (USA).nes'), false);
  assert.strictEqual(romHideReason({ hideUpdates: false }, 'Game [UPD].xci'), '');
  assert.strictEqual(romHideReason({ hidePatterns: ['demo'] }, 'Game (Demo).iso'), 'rule');
  assert.strictEqual(romHideReason({ hidePatterns: ['*(Beta)'] }, 'Game (Beta).iso'), 'rule');
  assert.strictEqual(romHideReason({ hidePatterns: ['*(Beta)'] }, 'Game (Beta) X.iso'), '');
  assert.strictEqual(romHideReason({ hidePatterns: ['Bonus'] }, 'Bonus/Extra.iso'), 'rule');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-hide-'));
  fs.mkdirSync(path.join(dir, 'Updates'));
  fs.writeFileSync(path.join(dir, 'Game [0100AAAA0000B000][v0].nsp'), '');
  fs.writeFileSync(path.join(dir, 'Updates', 'Game [0100AAAA0000B800][v131072].nsp'), '');
  fs.writeFileSync(path.join(dir, 'Game (Demo).nsp'), '');
  const cfg = mergeDefaults(DEFAULT_CONFIG, {
    steam: { enabled: false }, stores: { epic: false, gog: false },
    emulators: [], systems: [{ id: 'switch', name: 'Switch', extensions: ['.nsp'], romDirs: [dir], hidePatterns: ['demo'] }]
  });
  let lib = scanLibrary(cfg);
  const sys = lib.systems.find((s) => s.id === 'switch');
  assert.strictEqual(sys.count, 1);
  assert.strictEqual(sys.hiddenCount, 2);
  const demo = lib.games.find((g) => /Demo/.test(g.rom));
  assert.strictEqual(demo.hiddenBy, 'rule');
  cfg.gameOverrides[demo.id] = { hidden: false }; // trotz Regel anzeigen
  lib = scanLibrary(cfg);
  assert.strictEqual(lib.systems.find((s) => s.id === 'switch').count, 2);
});

test('Spotify: Token erneuern, aktuellen Titel lesen, Playlist auf diesem PC abspielen', async () => {
  const { Spotify } = require('../src/main/spotify');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-sp-'));
  const file = path.join(dir, 'spotify.json');
  fs.writeFileSync(file, JSON.stringify({ refreshToken: 'r1' }));
  const calls = [];
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  const fetch = async (url, o = {}) => {
    calls.push(`${o.method || 'GET'} ${url.replace('https://api.spotify.com/v1', '')}${o.body && !url.includes('token') ? ' ' + o.body : ''}`);
    if (url.includes('/api/token')) return reply(200, { access_token: 'a1', expires_in: 3600, refresh_token: 'r2' });
    if (url.endsWith('/me/player?additional_types=episode')) return reply(200, { is_playing: true, shuffle_state: false, progress_ms: 1000, device: { name: 'PC', volume_percent: 40 }, item: { name: 'Get Lucky', duration_ms: 5000, artists: [{ name: 'Daft Punk' }], album: { images: [{ url: 'big' }, { url: 'mid' }] } } });
    if (url.endsWith('/me/player/devices')) return reply(200, { devices: [{ id: 'phone', type: 'Smartphone', name: 'Handy' }, { id: 'pc', type: 'Computer', name: 'GAMING-PC' }] });
    if (url.includes('/me/player/play')) return reply(204);
    if (url.includes('/me/playlists')) return reply(200, { items: [{ id: 'p1', uri: 'spotify:playlist:p1', name: 'Mix', images: [{ url: 'img' }] }] });
    return reply(404, { error: { message: 'x' } });
  };
  const sp = new Spotify({ getConfig: () => ({ spotify: { clientId: 'cid' } }), file, fetch, openUrl: () => {} });
  assert.ok(sp.isConnected());
  const now = await sp.now();
  assert.deepStrictEqual([now.title, now.artist, now.image, now.playing], ['Get Lucky', 'Daft Punk', 'mid', true]);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).refreshToken, 'r2'); // neues Token gespeichert
  const pls = await sp.playlists();
  assert.deepStrictEqual(pls.map((p) => p.name), ['Lieblingssongs', 'Mix']);
  await sp.play('spotify:playlist:p1');
  assert.ok(calls.includes('PUT /me/player/play?device_id=pc {"context_uri":"spotify:playlist:p1"}'), calls.join('\n'));
});

test('Debug-Bericht: Passwörter und Tokens werden unkenntlich gemacht', () => {
  const { redact } = require('../src/main/debug-log');
  const r = redact({ homeassistant: { url: 'http://ha', token: 'abc123' }, scraper: { screenscraper: { user: 'ale', password: 'geheim' }, steamgriddbKey: 'k' }, spotify: { clientId: 'cid' } });
  assert.strictEqual(r.homeassistant.url, 'http://ha');
  assert.match(r.homeassistant.token, /^\*\*\*/);
  assert.match(r.scraper.screenscraper.password, /^\*\*\*/);
  assert.match(r.scraper.steamgriddbKey, /^\*\*\*/);
  assert.strictEqual(r.scraper.screenscraper.user, 'ale');
  assert.strictEqual(r.spotify.clientId, 'cid');
});

test('Home Assistant: TV ist aus „nicht verfügbar“ – über Chromecast einschalten, dann HDMI-Eingang am TV wählen', async () => {
  const { HomeAssistant } = require('../src/main/homeassistant');
  let tv = { state: 'unavailable', attributes: {} };
  let castSwitchedBack = false;
  const calls = [];
  const fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push(`${opts.method} ${u.pathname}${opts.body ? ' ' + opts.body : ''}`);
    let body = null;
    if (u.pathname === '/api/states/media_player.tv') body = tv;
    if (u.pathname === '/api/services/media_player/turn_on' && JSON.parse(opts.body).entity_id === 'media_player.chromecast') {
      // Chromecast weckt den TV per CEC und schaltet auf seinen eigenen Eingang
      setTimeout(() => { tv = { state: 'on', attributes: { source: 'HDMI 3 (Chromecast)', source_list: ['HDMI 1', 'HDMI 3 (Chromecast)'] } }; }, 300);
      body = [];
    }
    if (u.pathname === '/api/services/media_player/select_source') {
      if (tv.state === 'unavailable') return { ok: false, status: 500, text: async () => '' };
      tv = { ...tv, attributes: { ...tv.attributes, source: JSON.parse(opts.body).source } };
      // Beim ersten Mal schaltet CEC kurz danach zurück auf den Chromecast
      if (!castSwitchedBack) { castSwitchedBack = true; setTimeout(() => { tv = { ...tv, attributes: { ...tv.attributes, source: 'HDMI 3 (Chromecast)' } }; }, 500); }
      body = [];
    }
    return { ok: body !== null, status: body !== null ? 200 : 404, text: async () => JSON.stringify(body) };
  };
  const cfg = { homeassistant: { enabled: true, url: 'http://ha', token: 'T', tvEntity: 'media_player.tv', powerOnEntity: 'media_player.chromecast', source: 'HDMI 1', waitForTvSeconds: 5, sourceDelaySeconds: 0 } };
  const ha = new HomeAssistant({ fetch, getConfig: () => cfg });
  const r = await ha.tvOn();
  assert.deepStrictEqual(r, { on: true, source: 'HDMI 1', via: 'media_player.chromecast' });
  assert.ok(!calls.some((c) => c.includes('turn_on {"entity_id":"media_player.tv"}')), 'TV selbst wird nicht eingeschaltet');
  assert.ok(calls.filter((c) => c.includes('select_source')).length >= 2, 'Eingang wird nach dem Zurückschalten erneut gewählt');
});

test('Emulatoren im Vollbild: Argument für bekannte Emulatoren ergänzen', () => {
  const { withFullscreen, profileFor } = require('../src/main/emulator-profiles');
  const run = (exe, a) => withFullscreen(exe, a, splitArgs(a)).args;
  assert.deepStrictEqual(run('C:\\Emu\\eden.exe', '"{rom}"'), ['-f', '{rom}']);
  assert.deepStrictEqual(run('C:\\Emu\\Ryujinx.exe', '"{rom}"'), ['--fullscreen', '{rom}']);
  assert.deepStrictEqual(run('C:\\Emu\\yuzu.exe', '-f -g "{rom}"'), ['-f', '-g', '{rom}']); // schon drin -> nichts doppelt
  assert.deepStrictEqual(run('C:\\Dolphin\\Dolphin.exe', '-b -e "{rom}"'), ['-C', 'Dolphin.Display.Fullscreen=True', '-b', '-e', '{rom}']);
  assert.deepStrictEqual(run('C:\\x\\unbekannt.exe', '"{rom}"'), ['{rom}']);
  assert.strictEqual(profileFor('C:\\x\\flycast.exe').fullscreen, null);
  assert.strictEqual(profileFor('D:\\Switch\\citron.exe').args, '-f -g "{rom}"');
});

test('AleClip: Status abfragen und Clip mit Länge und Ende anfordern', async () => {
  const net = require('net');
  const { AleClip } = require('../src/main/aleclip');
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\ags-test-${process.pid}` : path.join(os.tmpdir(), `ags-test-${process.pid}.sock`);
  const got = [];
  const server = net.createServer((c) => {
    let buf = '';
    c.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      const msg = JSON.parse(buf);
      got.push(msg);
      const reply = msg.cmd === 'status' ? { ok: true, replay: true, replaySeconds: 120, buffered: 50 }
        : msg.cmd === 'save_replay' ? { ok: true, saving: true, seconds: msg.seconds } : { ok: false, error: 'x' };
      c.end(JSON.stringify(reply) + '\n');
    });
  });
  await new Promise((r) => server.listen(sock, r));
  const a = new AleClip({ getConfig: () => ({ aleclip: {} }), pipe: sock });
  assert.deepStrictEqual(await a.status(), { ok: true, replay: true, replaySeconds: 120, buffered: 50 });
  const r = await a.saveReplay(30, 2.34);
  assert.strictEqual(r.seconds, 30);
  assert.deepStrictEqual(got[1], { cmd: 'save_replay', seconds: 30, end_ago: 2.3 });
  await assert.rejects(a.command('kaputt'), /x/);
  await new Promise((r) => server.close(r));
  // Läuft nicht -> verständliche Meldung
  const off = new AleClip({ getConfig: () => ({ aleclip: {} }), pipe: sock });
  assert.strictEqual((await off.status()).offline, true);
  await assert.rejects(off.saveReplay(10), /läuft nicht/);
});

test('Steam-Cover: neue Bild-Adressen mit Prüfsumme über die Shop-Schnittstelle', async () => {
  const { Scraper } = require('../src/main/scraper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-steam-'));
  const calls = [];
  const img = Buffer.alloc(5000, 1);
  const fetch = async (url) => {
    calls.push(url);
    const ok = (body, bin) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), arrayBuffer: async () => bin });
    if (url.includes('IStoreBrowseService/GetItems')) {
      return ok({ response: { store_items: [{ appid: 4069520, assets: { asset_url_format: 'steam/apps/4069520/${FILENAME}?t=1', library_capsule: 'abc/library_capsule.jpg', library_hero: 'def/library_hero.jpg', header: 'abc/header.jpg' } }] } });
    }
    if (url.includes('/apps/4069520/abc/library_capsule.jpg') || url.includes('/apps/4069520/def/library_hero.jpg')) return ok(null, img);
    return { ok: false, status: 404, text: async () => '' }; // alte feste Pfade gibt es nicht mehr
  };
  const s = new Scraper({ mediaDir: dir, getConfig: () => ({ scraper: { downloadSnaps: true }, systems: [] }), fetch });
  const r = await s.scrapePcGame({ id: 'steam-4069520', type: 'steam', system: 'steam', appid: 4069520, name: 'Super Battle Golf' });
  assert.deepStrictEqual([r.covers, r.snaps, r.source], [true, true, 'steam']);
  assert.ok(calls.some((u) => u.includes('/abc/library_capsule.jpg')));
  assert.ok(fs.existsSync(path.join(dir, 'steam', 'covers', 'steam-4069520.png')));
});

test('Cover-Suche: eigene Konsole am Namen erkennen (z.B. „Switch 1 & 2“)', () => {
  const { systemFromName, romTitle } = require('../src/main/scraper');
  assert.strictEqual(systemFromName('Switch 1 & 2'), 'switch');
  assert.strictEqual(systemFromName('Nintendo 3DS'), '3ds');
  assert.strictEqual(systemFromName('Meine Sammlung'), '');
  assert.strictEqual(romTitle({ name: 'Mario Kart 8 Deluxe [0100152000022000][v0]' }), 'Mario Kart 8 Deluxe');
});

test('Konsole mit mehreren Emulatoren: Standard + Emulator pro Spiel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-multi-'));
  fs.writeFileSync(path.join(dir, 'Zelda.nsp'), '');
  fs.writeFileSync(path.join(dir, 'Pokemon.nsp'), '');
  const exe = path.join(dir, 'eden.exe'); fs.writeFileSync(exe, '');
  const exe2 = path.join(dir, 'Ryujinx.exe'); fs.writeFileSync(exe2, '');
  const cfg = mergeDefaults(DEFAULT_CONFIG, {
    steam: { enabled: false }, stores: { epic: false, gog: false },
    emulators: [{ id: 'eden', name: 'Eden', exe, args: '"{rom}"' }, { id: 'ryu', name: 'Ryujinx', exe: exe2, args: '"{rom}"' }],
    systems: [{ id: 'switch', name: 'Switch', extensions: ['.nsp'], romDirs: [dir], emulator: 'eden', emulators: ['ryu'] }]
  });
  let lib = scanLibrary(cfg);
  const poke = lib.games.find((g) => /Pokemon/.test(g.rom));
  cfg.gameOverrides[poke.id] = { emulator: 'ryu' };
  lib = scanLibrary(cfg);
  assert.strictEqual(lib.games.find((g) => g.id === poke.id).emulatorName, 'Ryujinx');
  assert.strictEqual(lib.games.find((g) => /Zelda/.test(g.rom)).emulatorName, 'Eden');
  // Weiterer Emulator der Konsole erscheint nicht als eigene, nicht zugeordnete Kachel
  assert.ok(!lib.systems.some((s) => s.id === 'emu:ryu'));
});

test('Switch-2-Cover: Suchname bereinigen und Shop-Titel unscharf zuordnen', () => {
  const { romTitle, titleScore } = require('../src/main/scraper');
  assert.strictEqual(romTitle({ name: 'Super Mario Party Jamboree – Nintendo Switch 2 Edition + Jamboree TV [0100ABC][v0]' }), 'Super Mario Party Jamboree');
  assert.ok(titleScore('Zelda Tears of the Kingdom', 'The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition') >= 0.75);
  assert.ok(titleScore('Pokemon Legends Z-A', 'Pokémon Legends: Z-A – Nintendo Switch 2 Edition') >= 0.75);
  assert.ok(titleScore('Mario Kart World', 'Super Mario Kart') < 0.75);
  assert.ok(titleScore('Donkey Kong Bananza', 'Donkey Kong Country Returns HD') < 0.75);
});

test('Home Assistant: Antwort beim Beenden (Fernseher aus / anlassen) überschreibt die Einstellung', async () => {
  const { HomeAssistant } = require('../src/main/homeassistant');
  const calls = [];
  const fetch = async (url, opts) => { calls.push(new URL(url).pathname); return { ok: true, status: 200, text: async () => '[]' }; };
  const cfg = { homeassistant: { enabled: true, url: 'http://ha', token: 'T', tvEntity: 'media_player.tv', turnOffAtExit: false, sourceAtExit: '' } };
  const ha = new HomeAssistant({ fetch, getConfig: () => cfg });
  await ha.onExit({ tvOff: true });
  assert.ok(calls.includes('/api/services/media_player/turn_off'), 'Ausschalten trotz turnOffAtExit=false');
  calls.length = 0;
  cfg.homeassistant.turnOffAtExit = true;
  await ha.onExit({ tvOff: false });
  assert.ok(!calls.includes('/api/services/media_player/turn_off'), 'Anlassen trotz turnOffAtExit=true');
});

test('Absicherung: Wiederherstellungsdatei wird gemerkt, ergänzt, übernommen und sauber gelöscht', () => {
  const { CrashGuard } = require('../src/main/crash-guard');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-guard-'));
  const g = new CrashGuard({ dir });
  g.update({ audioPrev: 'x' }); // noch nicht scharf → nichts
  assert.strictEqual(fs.existsSync(g.file), false);
  g.arm({ saved: 'AAA', primary: 'mon-main', primaryName: 'Hauptmonitor' });
  g.update({ audioPrev: '{dev}' });
  const st = JSON.parse(fs.readFileSync(g.file, 'utf8'));
  assert.deepStrictEqual([st.saved, st.primary, st.audioPrev, st.pid], ['AAA', 'mon-main', '{dev}', process.pid]);
  // Eigener (laufender) Stand ist kein Überbleibsel
  assert.strictEqual(g.leftover(), null);
  // Stand eines plötzlich beendeten Laufs
  fs.writeFileSync(g.file, JSON.stringify({ ...st, pid: 999999 }));
  const left = g.leftover();
  assert.strictEqual(left.primaryName, 'Hauptmonitor');
  g.clearLeftover(left);
  assert.strictEqual(fs.existsSync(g.file), false);
  // Wächter arbeitet gerade (.restoring frisch) → nicht doppelt zurückstellen
  fs.writeFileSync(g.file + '.restoring', JSON.stringify({ ...st, pid: 999999 }));
  assert.strictEqual(g.leftover(), null);
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(g.file + '.restoring', old, old);
  assert.ok(g.leftover(), 'hängengebliebener Wächter → beim Start übernehmen');
  // Sauber beendet
  g.arm({ saved: 'B' });
  g.disarm();
  assert.strictEqual(fs.existsSync(g.file), false);
});

test('Maussteuerung: Stick bewegt die Maus nur, wenn eingeschaltet', () => {
  const { MouseMode } = require('../src/main/mouse-mode');
  for (const mouseStick of [true, false]) {
    const lines = [];
    const m = new MouseMode({ getConfig: () => ({ controller: { mouseSpeed: 1, mouseStick } }), send: (l) => lines.push(l) });
    m.update({ id: 'p', mask: 0, axes: [1, 0, 0, 0] });
    m.setActive(true);
    m.lastTick = Date.now() - 40;
    m.tick();
    m.setActive(false);
    assert.strictEqual(lines.some((l) => l.startsWith('m ')), mouseStick, `mouseStick=${mouseStick}: ${lines.join(' | ')}`);
  }
});

test('RomM: schon vorhandene ROMs erkennen (Dateiname, Ordner, Titel)', () => {
  const { findLocal } = require('../src/main/romm');
  const local = [
    { id: 'a', rom: 'C:\\ROMs\\snes\\Super Mario World (Europe).zip', name: 'Super Mario World' },
    { id: 'b', rom: 'C:\\ROMs\\psx\\Final Fantasy VII (Europe)\\Final Fantasy VII (Europe).cue', name: 'Final Fantasy VII' },
    { id: 'c', rom: '/roms/snes/Chrono Trigger (USA).sfc', name: 'Chrono Trigger' }
  ];
  assert.strictEqual(findLocal({ fs_name: 'Chrono Trigger (USA).sfc', fs_name_no_ext: 'Chrono Trigger (USA)', name: 'Chrono Trigger' }, local).id, 'c');
  assert.strictEqual(findLocal({ fs_name: 'Final Fantasy VII (Europe)', fs_name_no_ext: 'Final Fantasy VII (Europe)', name: 'Final Fantasy VII' }, local).id, 'b');
  assert.strictEqual(findLocal({ fs_name: 'Super Mario World (USA).sfc', fs_name_no_ext: 'Super Mario World (USA)', name: 'Super Mario World' }, local).id, 'a');
  assert.strictEqual(findLocal({ fs_name: 'Super Mario World 2 - Yoshi\'s Island (USA).sfc', fs_name_no_ext: 'x', name: 'Super Mario World 2: Yoshi\'s Island' }, local), null);
  assert.strictEqual(findLocal({ fs_name: 'Donkey Kong Country (Europe).sfc', fs_name_no_ext: 'Donkey Kong Country (Europe)', name: 'Donkey Kong Country' }, local), null);
});

test('RomM: Anmeldung, Plattformen, Liste mit „schon vorhanden“, Empfehlungen, Download (auch mehrteilig)', async () => {
  const { RomM } = require('../src/main/romm');
  const fake = await require('./fake-romm').start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-romm-'));
  const conf = { romm: { enabled: true, url: fake.url + '/', token: 'rmm_test' } };
  const r = new RomM({ getConfig: () => conf, fetch: (u, o) => fetch(u, o), cacheDir: path.join(dir, 'cache') });
  try {
    const t = await r.test();
    assert.deepStrictEqual([t.version, t.user, t.platforms, t.roms], ['5.4.0', 'ale', 2, 4]);
    // Falsches Token → verständliche Meldung
    conf.romm.token = 'falsch';
    await assert.rejects(() => (r.clearCache(), r.test()), /Anmeldung abgelehnt/);
    // Benutzer + Passwort
    conf.romm.token = ''; conf.romm.user = 'ale'; conf.romm.password = 'geheim';
    r.clearCache();
    const snesDir = path.join(dir, 'snes');
    fs.mkdirSync(snesDir);
    fs.writeFileSync(path.join(snesDir, 'Chrono Trigger (USA).sfc'), 'x');
    const local = [{ id: 'ct', system: 'snes', type: 'rom', rom: path.join(snesDir, 'Chrono Trigger (USA).sfc'), name: 'Chrono Trigger' }];
    const list = await r.listForSystem({ id: 'snes', name: 'Super Nintendo' }, local);
    assert.deepStrictEqual(list.platforms, ['Super Nintendo']);
    assert.strictEqual(list.roms.length, 3);
    assert.strictEqual(list.roms.find((x) => x.id === 13).local, 'ct');
    assert.ok(list.roms.find((x) => x.id === 11).cover.startsWith('agsromm://cover/'));
    // Empfehlungen ohne vorhandene, nur für eingerichtete Konsolen (ohne PS1 → keine FF7)
    const reco = await r.recommendations([{ id: 'snes', name: 'SNES' }], local);
    assert.deepStrictEqual(reco.map((x) => x.id).sort(), [11, 12]);
    assert.match(reco[0].reason, /Super Mario World/);
    // Cover wird mit Anmeldung geholt und zwischengespeichert
    const cover = await r.coverFile(11);
    assert.ok(fs.existsSync(cover) && cover.endsWith('.png'));
    // Download einzelne Datei
    const prog = [];
    r.on('progress', (p) => prog.push(p));
    const f = await r.download(11, snesDir);
    assert.strictEqual(path.basename(f), 'Super Mario World (USA).sfc');
    assert.strictEqual(fs.statSync(f).size, 2048);
    assert.ok(prog.some((p) => p.done));
    await assert.rejects(() => r.download(11, snesDir), /liegt schon/);
    // Mehrteilig: ZIP wird in einen Ordner entpackt
    const psxDir = path.join(dir, 'psx');
    const g = await r.download(21, psxDir);
    assert.ok(fs.existsSync(path.join(g, 'Final Fantasy VII (Europe).cue')));
    assert.ok(!fs.readdirSync(psxDir).some((x) => x.endsWith('.part')));
  } finally {
    fake.close();
  }
});

test('Linux: Flatpak-ID erkennen, sichere Ordner, Prozesse im Spielordner finden und beenden', { skip: process.platform === 'win32' }, async () => {
  const { flatpakId, isSafeKillDir, pidsInDir, Launcher } = require('../src/main/launcher');
  assert.strictEqual(flatpakId('/usr/bin/flatpak', 'run org.libretro.RetroArch -f -L "x" "{rom}"'), 'org.libretro.RetroArch');
  assert.strictEqual(flatpakId('/usr/bin/flatpak', ['run', '--branch=stable', 'org.DolphinEmu.dolphin-emu', '-b']), 'org.DolphinEmu.dolphin-emu');
  assert.strictEqual(flatpakId('/usr/bin/retroarch', 'run x'), '');
  for (const d of ['/usr/bin', '/usr', '/', process.env.HOME, '/var/lib/flatpak', '/usr/lib/steam']) assert.strictEqual(isSafeKillDir(d), false, d);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-game-'));
  assert.strictEqual(isSafeKillDir(dir), true);
  // „Spiel“ im Ordner starten (Befehlszeile enthält den Ordner, wie bei Proton)
  const script = path.join(dir, 'game.js');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [script], { stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await pidsInDir(dir)).includes(child.pid), 'Prozess im Spielordner nicht gefunden');
  // Steam-artiger Start: nur Ordner bekannt → Beenden findet und beendet ihn
  const l = new Launcher(() => ({ controller: { gracefulCloseMs: 300 } }));
  l.current = { game: { id: 'g', name: 'Spiel' }, child: null, pid: null, dirs: [dir], startedAt: Date.now() };
  const exited = new Promise((r) => l.once('exited', r));
  await l.kill();
  await exited;
  await new Promise((r) => setTimeout(r, 200));
  assert.deepStrictEqual(await pidsInDir(dir), []);
});

test('Emulator-Verwaltung: Quellen erkennen und passende Datei wählen (Eden, eigene Quellen)', () => {
  const { parseSource, pickAsset, CATALOG } = require('../src/main/emu-manager');
  const eden = parseSource('https://git.eden-emu.dev/eden-emu/eden/releases');
  assert.strictEqual(eden.api, 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases?limit=15');
  assert.strictEqual(parseSource('stenzek/duckstation').api, 'https://api.github.com/repos/stenzek/duckstation/releases?per_page=15');
  assert.strictEqual(parseSource('github.com/PCSX2/pcsx2/releases/tag/v2.0').repo, 'pcsx2');
  assert.throws(() => parseSource('https://github.com/nur-ein-teil'));
  const names = ['Eden-Linux-v0.2.1-aarch64-clang-pgo.AppImage', 'Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage', 'Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage.zsync',
    'Eden-Linux-v0.2.1-amd64-gcc-standard.AppImage', 'Eden-Linux-v0.2.1-legacy-gcc-standard.AppImage', 'Eden-Windows-v0.2.1-amd64-msvc-standard.zip',
    'Eden-Windows-v0.2.1-arm64-clang-pgo.zip', 'Eden-Android-v0.2.1-standard.apk', 'Eden-macOS-v0.2.1.dmg', 'Eden-v0.2.1.torrent'].map((name) => ({ name }));
  const e = CATALOG.find((x) => x.id === 'eden');
  assert.strictEqual(pickAsset(names, 'linux', e.asset.linux).name, 'Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage');
  assert.strictEqual(pickAsset(names, 'win32', e.asset.win32).name, 'Eden-Windows-v0.2.1-amd64-msvc-standard.zip');
  // Ohne Filter: automatisch (x86_64, kein ARM, keine .zsync)
  assert.match(pickAsset(names, 'linux').name, /amd64.*\.AppImage$/);
  assert.strictEqual(pickAsset(names, 'win32').name, 'Eden-Windows-v0.2.1-amd64-msvc-standard.zip');
  // Eigener Filter als Platzhalter
  assert.strictEqual(pickAsset(names, 'linux', '*gcc-standard*').name, 'Eden-Linux-v0.2.1-amd64-gcc-standard.AppImage');
});

test('Emulator-Verwaltung: neueste Version von einer Forgejo-Release-Seite laden, eintragen, Konsole anlegen, aktualisieren', async () => {
  const http = require('http');
  const { EmuManager } = require('../src/main/emu-manager');
  let version = 'v0.2.0';
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/repos/eden-emu/eden/releases')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify([{ tag_name: version, prerelease: false, assets: [
        { name: `Eden-Linux-${version}-amd64-clang-pgo.AppImage`, size: 4, browser_download_url: `http://127.0.0.1:${srv.address().port}/dl/eden.AppImage` },
        { name: `Eden-Windows-${version}-amd64-msvc-standard.zip`, size: 4, browser_download_url: `http://127.0.0.1:${srv.address().port}/dl/eden.zip` }
      ] }]));
    }
    if (req.url === '/dl/eden.AppImage') return res.end('#!/bin/sh\necho eden ' + version + '\n');
    if (req.url === '/dl/eden.zip') return res.end(require('./fake-zip')([['eden.exe', 'MZ'], ['eden-room.exe', 'MZ']]));
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-emus-'));
  const conf = { emulators: [], systems: [], emuManager: { dir, installed: {}, sources: [] } };
  const m = new EmuManager({ getConfig: () => conf, updateConfig: (fn) => fn(conf), fetch: (u, o) => fetch(u, o) });
  // Eden-Quelle auf den Testserver umbiegen (eigene Quelle mit gleichem Aufbau)
  conf.emuManager.sources.push({ id: 'eden-test', name: 'Eden Test', url: `http://127.0.0.1:${srv.address().port}/eden-emu/eden`, emu: 'eden', args: '-f -g "{rom}"' });
  try {
    let rows = await m.list();
    const row = rows.find((r) => r.id === 'eden-test');
    assert.deepStrictEqual([row.installed, row.latest], [false, 'v0.2.0']);
    await m.install('eden-test');
    const inst = conf.emuManager.installed['eden-test'];
    assert.strictEqual(inst.version, 'v0.2.0');
    assert.ok(fs.existsSync(inst.exe));
    if (process.platform !== 'win32') assert.ok(fs.statSync(inst.exe).mode & 0o111, 'AppImage ausführbar');
    assert.strictEqual(conf.emulators.find((x) => x.id === 'eden').exe, inst.exe);
    // neue Version auf dem Server → Update erkannt und installiert
    version = 'v0.2.1';
    m.cache.clear();
    rows = await m.list();
    assert.strictEqual(rows.find((r) => r.id === 'eden-test').update, true);
    assert.deepStrictEqual(await m.updateAll(), ['Eden Test']);
    assert.strictEqual(conf.emuManager.installed['eden-test'].version, 'v0.2.1');
    // Entfernen
    await m.remove('eden-test');
    assert.ok(!conf.emuManager.installed['eden-test']);
    assert.ok(!fs.existsSync(path.join(dir, 'eden-test')));
  } finally { srv.close(); }
});

test('Emulator-Verwaltung: eingebautes Eden legt die Switch-Konsole an', () => {
  const { EmuManager } = require('../src/main/emu-manager');
  const conf = { emulators: [], systems: [], emuManager: {} };
  const m = new EmuManager({ getConfig: () => conf, updateConfig: (fn) => fn(conf), fetch: () => {} });
  m.register(m.entry('eden'), '/opt/eden.AppImage', '-f -g "{rom}"');
  assert.strictEqual(conf.emulators[0].args, '-f -g "{rom}"');
  const sw = conf.systems.find((s) => s.id === 'switch');
  assert.ok(sw && sw.emulator === 'eden' && sw.extensions.includes('.xci'));
});

test('RomM: unterwegs automatisch die zweite Adresse (z.B. Tailscale) verwenden', async () => {
  const { RomM } = require('../src/main/romm');
  const fake = await require('./fake-romm').start();
  const conf = { romm: { enabled: true, url: 'http://127.0.0.1:9', remoteUrl: fake.url, token: 'rmm_test' } };
  const r = new RomM({ getConfig: () => conf, fetch: (u, o) => fetch(u, o), cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ags-romm2-')) });
  try {
    const t = await r.test();
    assert.strictEqual(t.version, '5.4.0');
    assert.strictEqual(r.base(), fake.url);
    // Ohne zweite Adresse: verständlicher Fehler
    conf.romm.remoteUrl = ''; r.useRemote = false; r.clearCache();
    await assert.rejects(() => r.test(), /RomM nicht erreichbar/);
  } finally { fake.close(); }
});

test('Tailscale: Zustand ohne installierte Tailscale-Kommandozeile', async () => {
  const { Tailscale, cli } = require('../src/main/tailscale');
  const st = await new Tailscale().status();
  if (!cli()) assert.strictEqual(st.state, 'not-installed');
  else assert.ok(['running', 'needs-login', 'stopped', 'no-daemon'].includes(st.state));
});

test('Tailscale: verbinden mit Anmelde-Link/QR, Status mit Geräten, trennen', { skip: process.platform === 'win32' }, async () => {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ags-ts-')), 'state');
  process.env.AGS_TAILSCALE_CLI = path.join(__dirname, 'fixtures', 'fake-tailscale.js');
  process.env.FAKE_TS_STATE_FILE = stateFile;
  try {
    const { Tailscale } = require('../src/main/tailscale');
    const ts = new Tailscale();
    assert.strictEqual((await ts.status()).state, 'needs-login');
    const login = new Promise((r) => ts.once('login', r));
    await ts.up({});
    const l = await login;
    assert.strictEqual(l.url, 'https://login.tailscale.com/a/abc123');
    assert.ok(l.qr.startsWith('data:image/png'));
    const st = await ts.status();
    assert.deepStrictEqual([st.state, st.ip, st.dns, st.peers[0].name, st.peers[0].online], ['running', '100.64.0.5', 'alegamestation.tail1234.ts.net', 'romm-server', true]);
    await ts.down();
    assert.strictEqual((await ts.status()).state, 'stopped');
  } finally { delete process.env.AGS_TAILSCALE_CLI; }
});

test('AleGamestation OS: System-Update zeigt Fortschritt (bootc --progress-fd) und erkennt „kein Update“', { skip: process.platform === 'win32' }, () => {
  const { parseBootcProgress } = require('../src/main/linux-os');
  const { spawnSync } = require('child_process');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-bootc-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-bootc'), path.join(bin, 'bootc'));
  fs.chmodSync(path.join(bin, 'bootc'), 0o755);
  const script = path.join(__dirname, '..', 'os', 'system_files', 'usr', 'libexec', 'alegamestation-os-update');
  const runScript = (mode) => spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_BOOTC_MODE: mode } });
  // Kein Update
  let r = runScript('current');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(parseBootcProgress(r.stdout.trim().split('\n').pop()), { done: true, update: false });
  assert.match(r.stderr, /System ist aktuell/);
  // Update mit Fortschritt
  r = runScript('update');
  assert.strictEqual(r.status, 0, r.stderr);
  const events = r.stdout.trim().split('\n').map(parseBootcProgress).filter(Boolean);
  assert.deepStrictEqual(events.map((e) => e.pct), [25, 50, undefined]);
  assert.match(events[0].text, /1,0 GB von 4,0 GB · Ebene 4 von 40/);
  assert.match(events[1].text, /Importiere: Layer 21 \(20\/40\)/);
  assert.deepStrictEqual(events[2], { done: true, update: true });
  assert.match(r.stderr, /aktiv nach dem Neustart/);
});
