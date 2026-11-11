'use strict';
/**
 * Bekannte Emulatoren: Name, Vollbild-Argument und empfohlene Start-Argumente.
 * Erkennung über den Dateinamen der .exe. Wird verwendet, um Spiele automatisch im Vollbild zu starten
 * und beim Hinzufügen eines Emulators sinnvolle Start-Argumente vorzuschlagen.
 *
 * fullscreen: Argumente, die vorne eingefügt werden (null = Emulator hat keins → im Emulator selbst einstellen)
 * has: woran man erkennt, dass Vollbild schon in den Start-Argumenten steht
 */
const PROFILES = [
  // Nintendo Switch (yuzu und Nachfolger: Eden, Citron, Sudachi, Suyu, Torzu)
  { id: 'eden', match: /^eden/i, name: 'Eden (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'citron', match: /^citron/i, name: 'Citron (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'sudachi', match: /^sudachi/i, name: 'Sudachi (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'suyu', match: /^suyu/i, name: 'Suyu (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'torzu', match: /^torzu/i, name: 'Torzu (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'yuzu', match: /^yuzu/i, name: 'yuzu (Switch)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'ryujinx', match: /^(ryujinx|ryubing)/i, name: 'Ryujinx (Switch)', fullscreen: ['--fullscreen'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '--fullscreen "{rom}"' },
  // Nintendo
  { id: 'cemu', match: /^cemu/i, name: 'Cemu (Wii U)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -g "{rom}"' },
  { id: 'dolphin', match: /^dolphin/i, name: 'Dolphin (GameCube/Wii)', fullscreen: ['-C', 'Dolphin.Display.Fullscreen=True'], has: /Display\.Fullscreen/i, args: '-b -C Dolphin.Display.Fullscreen=True -e "{rom}"' },
  { id: 'azahar', match: /^(azahar|lime3ds|citra)/i, name: 'Azahar / Citra (3DS)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f "{rom}"' },
  { id: 'melonds', match: /^melonds/i, name: 'melonDS (DS)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f "{rom}"' },
  { id: 'mgba', match: /^mgba/i, name: 'mGBA (GBA)', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f "{rom}"' },
  { id: 'snes9x', match: /^snes9x/i, name: 'Snes9x (SNES)', fullscreen: ['-fullscreen'], has: /(^|\s)-fullscreen(\s|$)/i, args: '-fullscreen "{rom}"' },
  { id: 'mesen', match: /^mesen/i, name: 'Mesen (NES/SNES)', fullscreen: ['--fullscreen'], has: /(^|\s)--?fullscreen(\s|$)/i, args: '--fullscreen "{rom}"' },
  // Sony
  { id: 'duckstation', match: /^duckstation/i, name: 'DuckStation (PS1)', fullscreen: ['-fullscreen'], has: /(^|\s)-fullscreen(\s|$)/i, args: '-batch -fullscreen -- "{rom}"' },
  { id: 'pcsx2', match: /^pcsx2/i, name: 'PCSX2 (PS2)', fullscreen: ['-fullscreen'], has: /(^|\s)-fullscreen(\s|$)/i, args: '-batch -fullscreen -- "{rom}"' },
  { id: 'rpcs3', match: /^rpcs3/i, name: 'RPCS3 (PS3)', fullscreen: ['--fullscreen'], has: /(^|\s)--fullscreen(\s|$)/i, args: '--no-gui --fullscreen "{rom}"' },
  { id: 'ppsspp', match: /^ppsspp/i, name: 'PPSSPP (PSP)', fullscreen: ['--fullscreen'], has: /(^|\s)--fullscreen(\s|$)/i, args: '--fullscreen "{rom}"' },
  { id: 'vita3k', match: /^vita3k/i, name: 'Vita3K (PS Vita)', fullscreen: ['-F'], has: /(^|\s)(-F|--fullscreen)(\s|$)/, args: '-F -r "{rom}"' },
  // Microsoft
  { id: 'xemu', match: /^xemu/i, name: 'xemu (Xbox)', fullscreen: ['-full-screen'], has: /(^|\s)-full-screen(\s|$)/i, args: '-full-screen -dvd_path "{rom}"' },
  { id: 'xenia', match: /^xenia/i, name: 'Xenia (Xbox 360)', fullscreen: ['--fullscreen=true'], has: /--fullscreen/i, args: '--fullscreen=true "{rom}"' },
  // Mehrsystem
  { id: 'retroarch', match: /^retroarch/i, name: 'RetroArch', fullscreen: ['-f'], has: /(^|\s)(-f|--fullscreen)(\s|$)/i, args: '-f -L cores\\CORE_libretro.dll "{rom}"' },
  // Ohne Vollbild-Argument: im Emulator selbst einstellen
  { id: 'flycast', match: /^flycast/i, name: 'Flycast (Dreamcast)', fullscreen: null, note: 'In Flycast unter Einstellungen → Video „Vollbild“ einschalten', args: '"{rom}"' },
  { id: 'mame', match: /^mame/i, name: 'MAME (Arcade)', fullscreen: null, note: 'MAME startet von sich aus im Vollbild', args: '"{rom}"' },
  { id: 'project64', match: /^project64/i, name: 'Project64 (N64)', fullscreen: null, note: 'In Project64 unter Optionen „Beim Start in den Vollbildmodus wechseln“ einschalten', args: '"{rom}"' }
];

/** Profil zu einer Emulator-.exe (oder null) */
function profileFor(exe) {
  const base = String(exe || '').split(/[\\/]/).pop();
  return PROFILES.find((p) => p.match.test(base)) || null;
}

/**
 * Vollbild-Argumente vorne einfügen, falls nötig.
 * @returns {{ args: string[], added: string[] }}
 */
function withFullscreen(exe, argsString, args) {
  const p = profileFor(exe);
  if (!p || !p.fullscreen || p.has.test(String(argsString || ''))) return { args, added: [] };
  return { args: [...p.fullscreen, ...args], added: p.fullscreen };
}

module.exports = { PROFILES, profileFor, withFullscreen };
