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
