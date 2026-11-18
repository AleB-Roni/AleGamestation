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
    // Beim Start: "ask" (fragen: Fernseher oder am PC), "tv" (immer Konsolenmodus), "pc" (immer am PC, nichts umstellen)
    startMode: 'ask',
    // Ohne Antwort nach so vielen Sekunden automatisch startAskDefault wählen (0 = warten)
    startAskSeconds: 10,
    startAskDefault: 'tv',
    // Vollbild auch im Einrichtungsmodus (Desktop-Verknüpfung ohne Fernseher)
    setupFullscreen: false,
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
    // Kurzes Logo-Intro beim Start und Animation beim Spielstart
    bootAnimation: true,
    launchAnimation: true,
    // Beim Start automatisch auf GitHub nach Updates suchen
    autoUpdate: true,
    // Gefundene Updates sofort im Hintergrund herunterladen (sonst erst nachfragen)
    autoDownloadUpdates: true,
    // Konsolen-Kacheln: Fotos der Konsolen (sonst Umriss-Zeichnungen)
    consolePhotos: true,
    // Taskleiste ausblenden: 'game' = während ein Spiel läuft, 'console' = im ganzen Konsolenmodus, 'off' = nie
    hideTaskbar: 'game',
    // Emulatoren automatisch im Vollbild starten (passendes Argument für bekannte Emulatoren wird ergänzt)
    emulatorFullscreen: true,
    // Debug-Modus: Protokoll mit Eingaben/Fehlern schreiben (Einstellungen → Info & Updates)
    debugMode: false,
    hideCursor: true,
    showClock: true,
    confirmPowerActions: true,
    // Farbakzent der Oberfläche
    accentColor: '#7c5cff',
    // Farbthema: midnight | aurora | ocean | sunset | synthwave | graphite
    theme: 'midnight',
    // Maus: Rechtsklick geht zurück (Seitentasten zurück/vor funktionieren immer)
    rightClickBack: true,
    // Spiele-Raster: Sortierung (name | recent | playtime | system) und Filter (all | favorites | played | unplayed)
    sortMode: 'name',
    filterMode: 'all',
    // Skalierung der Oberfläche (1 = normal, 1.25 = größer für weit entfernte Fernseher)
    uiScale: 1,
    // Spielname als Banner unten auf den Covern
    cardNames: true
  },

  display: {
    // Was beim Start des Konsolenmodus passieren soll:
    // "none" | "external" (nur TV / zweiter Bildschirm) | "internal" (nur PC-Monitor) | "clone" (duplizieren) | "extend" (erweitern)
    onStart: 'external',
    // "tvOnly" = nur der unten gewählte Fernseher (wird Hauptbildschirm, alle anderen aus)
    // Gewählter Fernseher: { key: '\\\\.\\DISPLAY2', name: 'LG TV' } – in den Einstellungen auswählen
    tv: null,
    // So lange auf den Fernseher warten, falls er beim Start noch aus ist
    tvWaitSeconds: 15,
    // Fernseher, der in Windows deaktiviert ist, beim Start einschalten (und beim Beenden wieder ausschalten)
    enableTv: true,
    // Monitor-Auswahl beim Start/Beenden: { mode: 'custom', monitors: { <Kennung>: 'off'|'on'|'primary' }, names: { <Kennung>: 'LG TV' } }
    // startPlan null = ältere Einstellung „onStart“; exitPlan null/„restore“ = vorherige Anordnung wiederherstellen
    startPlan: null,
    exitPlan: null,
    // Fernseher im Konsolenmodus zur Hauptanzeige machen (beim Beenden wird der Hauptmonitor wiederhergestellt)
    tvAsPrimary: false,
    // Tonausgabe im Konsolenmodus, z.B. { id, name: 'LG TV (NVIDIA High Definition Audio)' }; null = nicht ändern
    audioDevice: null,
    // Beim Beenden wieder auf das vorherige Gerät umstellen
    restoreAudio: true,
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
    // PS-/Xbox-Taste während eines Spiels: Schnellmenü (Spiel beenden mit Rückfrage) | "off"
    guideButton: 'quickMenu',
    // PS-/Xbox-Taste gedrückt halten: Konsolen-Overlay (Spiel beenden, Schnellstart, Spotify, Lautstärke)
    overlayEnabled: true,
    overlayHoldMs: 600,
    // Overlay-Modus: "pause" = Spiel wird angehalten (keine Eingaben, bleibt im Vollbild),
    // "focus" = Overlay holt den Fokus (exklusives Vollbild minimiert sich kurz), "over" = nur darüberlegen (Spiel läuft weiter)
    overlayMode: 'pause',
    // Auch das Schnellmenü (PS kurz drücken) hält das Spiel an
    quickMenuPause: true,
    // Maus- & Tastatursteuerung per Controller ein/aus (funktioniert überall in Windows)
    mouseModeCombo: 'BACK+Y',
    // Mausgeschwindigkeit (1 = normal)
    mouseSpeed: 1,
    // Maussteuerung: Maus mit dem linken Stick bewegen (aus = nur Touchpad)
    mouseStick: true,
    // Tastenkürzel während eines Spiels (Shift+Tab = Overlay, Alt+F4/Strg+Q = Spiel beenden) – für Spielen ohne Controller
    keyboardShortcuts: true,
    // Overlay-Taste (Electron-Schreibweise) bzw. 'off'; Spiel-beenden-Tasten, mehrere mit | getrennt, oder 'off'
    overlayKey: 'Shift+Tab',
    quitKey: 'Alt+F4|Control+Q',
    // Touchpad (DualSense/DualShock 4) als Maus: "outsideGames" | "mouseMode" (nur in der Maussteuerung) | "off"
    touchpadMouse: 'outsideGames',
    touchpadSpeed: 1,
    // Antippen = Klick
    touchpadTap: true
  },

  // AleClip: Clips (Instant Replay), Screenshots und Aufnahme aus dem Overlay
  aleclip: {
    enabled: true,
    // leer = automatisch suchen (%LOCALAPPDATA%\Programs\AleClip\AleClip.exe)
    exe: '',
    // Beim Start des Konsolenmodus minimiert mitstarten, falls es nicht läuft
    autoStart: true,
    // Auswahl im Overlay (Sekunden); begrenzt auf die Puffer-Länge in AleClip
    clipLengths: [15, 30, 60, 120, 300]
  },

  // Spotify im Overlay (eigene Spotify-App nötig; Anmeldedaten liegen separat in spotify.json)
  spotify: {
    clientId: ''
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
    // Einschalten über ein anderes Gerät, z.B. media_player.chromecast (weckt den TV per HDMI-CEC) oder script.tv_an; leer = Fernseher selbst
    powerOnEntity: '',
    // Ausschalten über ein anderes Gerät; leer = Fernseher selbst
    powerOffEntity: '',
    // So lange warten, bis der Fernseher eingeschaltet ist
    waitForTvSeconds: 20,
    // Nach dem Einschalten kurz warten, dann den Eingang wählen (und so lange erneut versuchen, bis er bleibt)
    sourceDelaySeconds: 3,
    sourceRetrySeconds: 20,
    // Beim Zurückkehren zum Desktop: Fernseher aus bzw. auf anderen Eingang schalten
    turnOffAtExit: false,
    sourceAtExit: '',
    turnOffAtShutdown: true,
    // Beim Beenden (zum Desktop) fragen: Fernseher ausschalten oder anlassen?
    askTvOffAtExit: true,
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

  // Emulator-Tab: Reihenfolge der Konsolen/Emulatoren (IDs) und ausgeblendete
  emulatorTab: { order: [], hidden: [] },

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
    screenscraper: { user: '', password: '', devid: '', devpassword: '' },
    // Optional: kostenloser API-Schlüssel von steamgriddb.com (Profil → Einstellungen → API) – Bilder für fast jedes PC-Spiel
    steamgriddbKey: ''
  },

  // Pro Spiel: { emulator: 'dolphin', hidden: true, name: 'Eigener Name', cover: 'C:\\bild.png' }
  gameOverrides: {},
  // Emulatoren herunterladen/aktualisieren (Einstellungen → Emulatoren → Laden & Updates)
  emuManager: {
    autoUpdate: true,   // installierte Emulatoren täglich aktualisieren
    dir: '',            // leer = Linux ~/Emulatoren, Windows C:\\Emulatoren
    installed: {},      // id -> { version, exe, file, at }
    sources: []         // eigene Quellen: { id, name, url, asset, exe, args, prerelease }
  },
  // Tailscale (Fernzugriff): Gerätename im Tailnet (leer = Rechnername)
  tailscale: { hostname: '' },
  // RomM-Server (Heimnetz): ROMs anzeigen, empfehlen, herunterladen
  romm: {
    enabled: false,
    url: '',          // z.B. http://192.168.1.20:8080
    remoteUrl: '',    // unterwegs, z.B. über Tailscale: http://romm-server:8080 oder http://100.x.y.z:8080
    token: '',        // Client-Token (rmm_…) – oder Benutzer + Passwort
    user: '',
    password: '',
    recommend: true,  // Reihe „Empfohlen von RomM“ auf der Startseite
    serverRow: true,  // auf der Konsolen-Seite: Spiele auf dem Server
    platformMap: {}   // Konsole -> [RomM-Plattform-IDs] | 'none' (leer = automatisch)
  },

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
// ---------- Linux (AleGamestation OS / Linux-Desktop): Emulatoren als Flatpak, ROMs unter ~/ROMs ----------
const RA_CORES = '{home}/.var/app/org.libretro.RetroArch/config/retroarch/cores';
const LINUX_EMULATORS = [
  { id: 'retroarch-snes', name: 'RetroArch (Snes9x)', exe: '/usr/bin/flatpak', args: `run org.libretro.RetroArch -f -L "${RA_CORES}/snes9x_libretro.so" "{rom}"` },
  { id: 'retroarch-nes', name: 'RetroArch (Mesen)', exe: '/usr/bin/flatpak', args: `run org.libretro.RetroArch -f -L "${RA_CORES}/mesen_libretro.so" "{rom}"` },
  { id: 'retroarch-gba', name: 'RetroArch (mGBA)', exe: '/usr/bin/flatpak', args: `run org.libretro.RetroArch -f -L "${RA_CORES}/mgba_libretro.so" "{rom}"` },
  { id: 'retroarch-n64', name: 'RetroArch (Mupen64Plus-Next)', exe: '/usr/bin/flatpak', args: `run org.libretro.RetroArch -f -L "${RA_CORES}/mupen64plus_next_libretro.so" "{rom}"` },
  { id: 'retroarch-md', name: 'RetroArch (Genesis Plus GX)', exe: '/usr/bin/flatpak', args: `run org.libretro.RetroArch -f -L "${RA_CORES}/genesis_plus_gx_libretro.so" "{rom}"` },
  { id: 'melonds', name: 'melonDS', exe: '/usr/bin/flatpak', args: 'run net.kuribo64.melonDS -f "{rom}"' },
  { id: 'dolphin', name: 'Dolphin', exe: '/usr/bin/flatpak', args: 'run org.DolphinEmu.dolphin-emu -b -e "{rom}"' },
  { id: 'duckstation', name: 'DuckStation', exe: '/usr/bin/flatpak', args: 'run org.duckstation.DuckStation -batch -fullscreen -- "{rom}"' },
  { id: 'pcsx2', name: 'PCSX2', exe: '/usr/bin/flatpak', args: 'run net.pcsx2.PCSX2 -batch -fullscreen -- "{rom}"' },
  { id: 'ppsspp', name: 'PPSSPP', exe: '/usr/bin/flatpak', args: 'run org.ppsspp.PPSSPP --fullscreen "{rom}"' }
];
function linuxRomDir(winDir) {
  const home = process.env.HOME || '/home/user';
  return path.join(home, 'ROMs', String(winDir).split('\\').pop());
}
if (process.platform === 'linux') {
  DEFAULT_CONFIG.emulators = LINUX_EMULATORS;
  DEFAULT_CONFIG.systems = DEFAULT_CONFIG.systems.map((x) => ({ ...x, romDirs: (x.romDirs || []).map(linuxRomDir) }));
}

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
