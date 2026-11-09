'use strict';
/**
 * Konfiguration: wird als JSON in %APPDATA%/AleGamestation/config.json gespeichert.
 * Alles, was hier steht, kann in der App (Einstellungen) oder direkt in der Datei geändert werden.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  version: 1,

  general: {
    language: 'de',
    startFullscreen: true,
    // Bildschirm, auf dem die Oberfläche erscheint: "primary" oder Index (0, 1, 2 ...)
    targetDisplay: 'primary',
    autostartWithWindows: false,
    // Oberfläche minimieren, während ein Spiel läuft (hilft, dass Spiele sauber im Vordergrund sind)
    minimizeOnLaunch: true,
    // Nach Spielende das Launcher-Fenster wieder in den Vordergrund holen
    refocusAfterGame: true,
    uiSounds: true,
    // Sound-Thema: "modern" (sanfte Konsolen-Klänge), "retro" (8-Bit), "off"
    soundTheme: 'modern',
    soundVolume: 0.7,
    // Start-Klang beim Öffnen
    startupSound: true,
    // Beim Start automatisch auf GitHub nach Updates suchen
    autoUpdate: true,
    hideCursor: true,
    showClock: true,
    confirmPowerActions: true,
    // Farbakzent der Oberfläche
    accentColor: '#7c5cff',
    // Skalierung der Oberfläche (1 = normal, 1.25 = größer für weit entfernte Fernseher)
    uiScale: 1
  },

  display: {
    // Was beim Start des Konsolenmodus passieren soll:
    // "none" | "external" (nur TV / zweiter Bildschirm) | "internal" (nur PC-Monitor) | "clone" (duplizieren) | "extend" (erweitern)
    onStart: 'external',
    // Was beim Beenden (zurück zum Desktop) passieren soll
    onExit: 'extend',
    // Vor dem Herunterfahren / Neustart die Anzeige wiederherstellen (onExit-Modus)
    restoreBeforeShutdown: true,
    // Wartezeit nach dem Umschalten, bis Windows die Bildschirme neu angeordnet hat
    switchDelayMs: 2500,
    // Eigene Befehle (optional), z.B. für NirCmd / MultiMonitorTool / Audioausgang auf TV umstellen
    customCommandsOnStart: [],
    customCommandsOnExit: []
  },

  controller: {
    // Tastenkombination zum Beenden des laufenden Spiels / Emulators
    // Mögliche Tasten: A B X Y LB RB LT RT BACK START GUIDE LS RS UP DOWN LEFT RIGHT
    closeGameCombo: 'BACK+START',
    // Kombination, um den Launcher in den Vordergrund zu holen (ohne Spiel zu beenden)
    showLauncherCombo: 'BACK+LB+RB',
    // Wie lange die Kombination gehalten werden muss (ms) – verhindert versehentliches Beenden
    comboHoldMs: 800,
    // Vor dem harten Beenden erst sanft schließen versuchen (WM_CLOSE), dann nach X ms hart beenden
    gracefulCloseMs: 1500,
    // Analog-Stick zur Navigation verwenden
    useAnalogStick: true,
    // Tasten tauschen (Nintendo-Layout: A/B vertauscht)
    swapAB: false,
    // Tastensymbole in der Oberfläche: "auto" (erkennt den Controller) | "xbox" | "playstation" | "nintendo"
    glyphStyle: 'auto',
    // PlayStation-Controller (DualSense/DualShock 4) direkt auslesen – Beenden-Kombination ohne Steam Input/DS4Windows
    playstationHid: true,
    // Maus- & Tastatursteuerung per Controller ein/aus (funktioniert überall in Windows)
    mouseModeCombo: 'BACK+Y',
    // Mausgeschwindigkeit (1 = normal)
    mouseSpeed: 1
  },

  // Home Assistant: Fernseher einschalten und HDMI-Eingang wählen
  homeassistant: {
    enabled: false,
    url: 'http://homeassistant.local:8123',
    // Langlebiges Zugangstoken (HA → Profil → Sicherheit → Token erstellen)
    token: '',
    // z.B. media_player.wohnzimmer_tv
    tvEntity: '',
    // Eingang, z.B. "HDMI 2" (Liste kommt aus Home Assistant)
    source: '',
    turnOnAtStart: true,
    // So lange warten, bis der Fernseher eingeschaltet ist
    waitForTvSeconds: 20,
    // Beim Zurückkehren zum Desktop: Fernseher aus bzw. auf anderen Eingang schalten
    turnOffAtExit: false,
    sourceAtExit: '',
    turnOffAtShutdown: true,
    // Weitere Dienste, z.B. "script.gaming_licht", "scene.kino" oder "light.turn_off:light.wohnzimmer"
    startServices: [],
    exitServices: []
  },

  // Leistungsmodus: Programme beim Start pausieren/schließen und beim Beenden wiederherstellen
  // action: "pause" (einfrieren bzw. pauseArgs) | "close" (sanft schließen) | "kill" (sofort beenden)
  performance: {
    enabled: true,
    // Energieplan "Höchstleistung" im Konsolenmodus, danach vorherigen Plan wiederherstellen
    highPerformancePlan: false,
    programs: [
      { name: 'Wallpaper Engine', process: 'wallpaper64.exe;wallpaper32.exe', action: 'pause', pauseArgs: '-control pause', resumeArgs: '-control play', restore: true, enabled: true }
    ]
  },

  steam: {
    enabled: true,
    // leer = automatisch suchen
    path: '',
    // Spiele über Steam Big Picture starten? false = direkt über steam://rungameid
    launchViaBigPicture: false,
    // Zusätzlich eine Kachel "Steam Big Picture öffnen" anzeigen
    showBigPictureTile: true
  },

  // Emulatoren. args: Platzhalter {rom} {romName} {romDir} {emuDir} – jedes Argument einzeln, Leerzeichen in Pfaden sind kein Problem.
  emulators: [
    { id: 'retroarch-snes', name: 'RetroArch (Snes9x)', exe: 'C:\\RetroArch-Win64\\retroarch.exe', args: '-f -L cores\\snes9x_libretro.dll "{rom}"' },
    { id: 'retroarch-nes', name: 'RetroArch (Mesen)', exe: 'C:\\RetroArch-Win64\\retroarch.exe', args: '-f -L cores\\mesen_libretro.dll "{rom}"' },
    { id: 'retroarch-gba', name: 'RetroArch (mGBA)', exe: 'C:\\RetroArch-Win64\\retroarch.exe', args: '-f -L cores\\mgba_libretro.dll "{rom}"' },
    { id: 'retroarch-n64', name: 'RetroArch (Mupen64Plus-Next)', exe: 'C:\\RetroArch-Win64\\retroarch.exe', args: '-f -L cores\\mupen64plus_next_libretro.dll "{rom}"' },
    { id: 'retroarch-md', name: 'RetroArch (Genesis Plus GX)', exe: 'C:\\RetroArch-Win64\\retroarch.exe', args: '-f -L cores\\genesis_plus_gx_libretro.dll "{rom}"' },
    { id: 'melonds', name: 'melonDS', exe: 'C:\\Emulatoren\\melonDS\\melonDS.exe', args: '-f "{rom}"' },
    { id: 'dolphin', name: 'Dolphin', exe: 'C:\\Program Files\\Dolphin\\Dolphin.exe', args: '-b -e "{rom}"' },
    { id: 'duckstation', name: 'DuckStation', exe: 'C:\\Emulatoren\\DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe', args: '-batch -fullscreen -- "{rom}"' },
    { id: 'pcsx2', name: 'PCSX2', exe: 'C:\\Program Files\\PCSX2\\pcsx2-qt.exe', args: '-batch -fullscreen -- "{rom}"' },
    { id: 'ppsspp', name: 'PPSSPP', exe: 'C:\\Program Files\\PPSSPP\\PPSSPPWindows64.exe', args: '--fullscreen "{rom}"' }
  ],

  // Systeme: welche Ordner mit welchen Dateiendungen von welchem Emulator gestartet werden.
  systems: [
    { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', color: '#e4002b', extensions: ['.nes', '.zip'], romDirs: ['C:\\ROMs\\nes'], emulator: 'retroarch-nes', enabled: true },
    { id: 'snes', name: 'Super Nintendo', short: 'SNES', color: '#7b5aa6', extensions: ['.sfc', '.smc', '.zip'], romDirs: ['C:\\ROMs\\snes'], emulator: 'retroarch-snes', enabled: true },
    { id: 'n64', name: 'Nintendo 64', short: 'N64', color: '#009e4f', extensions: ['.z64', '.n64', '.v64', '.zip'], romDirs: ['C:\\ROMs\\n64'], emulator: 'retroarch-n64', enabled: true },
    { id: 'gba', name: 'Game Boy Advance', short: 'GBA', color: '#4b2bb3', extensions: ['.gba', '.gb', '.gbc', '.zip'], romDirs: ['C:\\ROMs\\gba'], emulator: 'retroarch-gba', enabled: true },
    { id: 'nds', name: 'Nintendo DS', short: 'NDS', color: '#8a8d91', extensions: ['.nds'], romDirs: ['C:\\ROMs\\nds'], emulator: 'melonds', enabled: true },
    { id: 'gc', name: 'GameCube / Wii', short: 'GC/Wii', color: '#6a5acd', extensions: ['.iso', '.gcm', '.rvz', '.wbfs', '.ciso'], romDirs: ['C:\\ROMs\\gamecube', 'C:\\ROMs\\wii'], emulator: 'dolphin', enabled: true },
    { id: 'md', name: 'Sega Mega Drive', short: 'Mega Drive', color: '#1f4fa3', extensions: ['.md', '.gen', '.bin', '.zip'], romDirs: ['C:\\ROMs\\megadrive'], emulator: 'retroarch-md', enabled: true },
    { id: 'ps1', name: 'PlayStation', short: 'PS1', color: '#a3a3a3', extensions: ['.cue', '.chd', '.pbp', '.m3u'], romDirs: ['C:\\ROMs\\psx'], emulator: 'duckstation', enabled: true },
    { id: 'ps2', name: 'PlayStation 2', short: 'PS2', color: '#1d3fbb', extensions: ['.iso', '.chd', '.cso'], romDirs: ['C:\\ROMs\\ps2'], emulator: 'pcsx2', enabled: true },
    { id: 'psp', name: 'PlayStation Portable', short: 'PSP', color: '#2b2b2b', extensions: ['.iso', '.cso', '.pbp'], romDirs: ['C:\\ROMs\\psp'], emulator: 'ppsspp', enabled: true }
  ],

  // Manuell hinzugefügte PC-Spiele / Programme (z.B. Epic, GOG, Emulator-Oberflächen, Kodi ...)
  // killMode: "tree" (Prozess + Kinder) | "dir" (alle Prozesse aus dem Spielordner) | "name" (Prozessname aus processName)
  pcGames: [
    // { id: 'pc-1', name: 'Mein Spiel', exe: 'D:\\Games\\MeinSpiel\\game.exe', args: '', cwd: '', cover: '', killMode: 'dir', processName: '' }
  ],

  // Weitere Stores automatisch erkennen
  stores: {
    epic: true,
    gog: true
  },

  // Cover-Download für ROMs
  scraper: {
    // "auto" = ScreenScraper (wenn Zugangsdaten eingetragen), sonst libretro | "libretro" | "screenscraper"
    source: 'auto',
    // Zusätzlich Screenshots/Fanart als Hintergrundbild laden
    downloadSnaps: true,
    // Nach dem Einlesen fehlende Cover automatisch im Hintergrund laden
    autoScrape: true,
    // Speicherort der Bilder (leer = %APPDATA%\\AleGamestation\\media)
    mediaDir: '',
    // Kostenloses Konto auf screenscraper.fr; devid/devpassword = Entwickler-Zugang (im ScreenScraper-Forum beantragen)
    screenscraper: { user: '', password: '', devid: '', devpassword: '' }
  },

  // Pro Spiel: { emulator: 'dolphin', hidden: true, name: 'Eigener Name', cover: 'C:\\bild.png' }
  gameOverrides: {},

  // Wird von der App verwaltet
  favorites: [],
  recent: [],
  playtime: {},
  lastPlayed: {}
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Tiefes Zusammenführen: fehlende Schlüssel werden aus den Defaults ergänzt, Arrays werden übernommen. */
function mergeDefaults(defaults, user) {
  if (!isObject(user)) return structuredClone(defaults);
  const out = {};
  for (const key of Object.keys(defaults)) {
    if (isObject(defaults[key])) out[key] = mergeDefaults(defaults[key], user[key]);
    else out[key] = key in user ? user[key] : structuredClone(defaults[key]);
  }
  for (const key of Object.keys(user)) if (!(key in out)) out[key] = user[key];
  return out;
}

class ConfigStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.data = null;
  }

  load() {
    let user = null;
    try {
      user = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Kaputte Datei sichern statt sie stillschweigend zu überschreiben
        try { fs.copyFileSync(this.file, this.file + '.broken-' + Date.now()); } catch (_) { /* ignore */ }
      }
    }
    this.data = mergeDefaults(DEFAULT_CONFIG, user);
    if (!user) this.save();
    return this.data;
  }

  save(newData) {
    if (newData) this.data = mergeDefaults(DEFAULT_CONFIG, newData);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    return this.data;
  }

  get() {
    return this.data || this.load();
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, mergeDefaults };
