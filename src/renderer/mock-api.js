/* Nur für die Vorschau im normalen Browser (ohne Electron): simuliert die App-Schnittstelle mit Beispieldaten. */
(function () {
  if (window.api) return;
  const sys = (id, kind, name, short, color, emu, found = true) => ({ id, kind, name, short, color, emulatorId: emu, emulatorName: emu, emulatorFound: found, count: 0 });
  const systems = [
    sys('steam', 'store', 'Steam', 'Steam', '#1b2838'),
    sys('epic', 'store', 'Epic Games', 'Epic', '#2a2a2a'),
    sys('pc', 'store', 'Eigene Spiele', 'Eigene', '#0f7b6c'),
    sys('snes', 'emulator', 'Super Nintendo', 'SNES', '#7b5aa6', 'RetroArch (Snes9x)'),
    sys('n64', 'emulator', 'Nintendo 64', 'N64', '#009e4f', 'RetroArch (Mupen64Plus-Next)'),
    sys('gc', 'emulator', 'GameCube / Wii', 'GC/Wii', '#6a5acd', 'Dolphin'),
    sys('ps2', 'emulator', 'PlayStation 2', 'PS2', '#1d3fbb', 'PCSX2', false),
    sys('nes', 'emulator', 'Nintendo Entertainment System', 'NES', '#e4002b', 'RetroArch (Mesen)'),
    sys('gba', 'emulator', 'Game Boy Advance', 'GBA', '#4b2bb3', 'RetroArch (mGBA)'),
    sys('nds', 'emulator', 'Nintendo DS', 'NDS', '#8a8d91', 'melonDS'),
    sys('md', 'emulator', 'Sega Mega Drive', 'Mega Drive', '#1f4fa3', 'RetroArch (Genesis Plus GX)'),
    sys('ps1', 'emulator', 'PlayStation', 'PS1', '#a3a3a3', 'DuckStation'),
    sys('psp', 'emulator', 'PlayStation Portable', 'PSP', '#2b2b2b', 'PPSSPP'),
    Object.assign(sys('emu:yuzu', 'emulator', 'Eden', 'Eden', '#3b4260', 'Eden'), { standalone: true, emulatorId: 'yuzu' })
  ];
  const games = [];
  const add = (system, names, extra = {}) => names.forEach((n, i) => games.push({ id: `${system}-${i}`, type: systems.find((s) => s.id === system).kind === 'emulator' ? 'rom' : system === 'steam' ? 'steam' : 'pc', system, name: n, cover: '', source: extra.source, emulatorName: extra.emu, rom: extra.emu ? `C:\\ROMs\\${system}\\${n}.zip` : undefined }));
  add('steam', ['Stellar Drift', 'Neon Harbor', 'Hollow Peaks', 'Ironclad Tactics', 'Skyline Racers', 'Echoes of Ember', 'Pixel Forge', 'Tidebound'], { source: 'Steam' });
  add('epic', ['Frostline', 'Crimson Vault'], { source: 'Epic Games' });
  add('pc', ['Kodi', 'Retro Arcade Cabinet'], { source: 'Manuell hinzugefügt' });
  add('snes', ['Space Pilot', 'Dungeon Quest', 'Kart Rally', 'Island Adventure', 'Puzzle Tower'], { emu: 'RetroArch (Snes9x)' });
  add('n64', ['Sky Kingdom', 'Racer 64', 'Jungle Jam'], { emu: 'RetroArch (Mupen64Plus-Next)' });
  add('gc', ['Ocean Saga', 'Galaxy Hop'], { emu: 'Dolphin' });
  systems.forEach((s) => { s.count = games.filter((g) => g.system === s.id).length; });
  const emulators = ['RetroArch (Snes9x)', 'RetroArch (Mupen64Plus-Next)', 'Dolphin', 'PCSX2'].map((n, i) => ({ id: n, name: n, exe: '', found: i < 3 }));
  const library = { systems, games, emulators, steamFound: true };
  let cfg = null;
  const defaults = {
    general: { startFullscreen: true, targetDisplay: 'primary', autostartWithWindows: false, minimizeOnLaunch: true, refocusAfterGame: true, uiSounds: true, soundTheme: 'modern', soundVolume: 0.7, startupSound: true, autoUpdate: true, hideCursor: false, showClock: true, confirmPowerActions: true, accentColor: '#7c5cff', uiScale: 1 },
    display: { onStart: 'external', onExit: 'extend', restoreBeforeShutdown: true, switchDelayMs: 2500, customCommandsOnStart: [], customCommandsOnExit: [] },
    controller: { closeGameCombo: 'BACK+START', showLauncherCombo: 'BACK+LB+RB', comboHoldMs: 800, gracefulCloseMs: 1500, useAnalogStick: true, swapAB: false, glyphStyle: 'auto', playstationHid: true, guideButton: 'quickMenu', overlayEnabled: true, overlayHoldMs: 600, mouseModeCombo: 'BACK+Y', mouseSpeed: 1, touchpadMouse: 'outsideGames', touchpadSpeed: 1, touchpadTap: true },
    homeassistant: { enabled: true, url: 'http://homeassistant.local:8123', token: 'abc', tvEntity: '', source: '', turnOnAtStart: true, waitForTvSeconds: 20, turnOffAtExit: false, sourceAtExit: '', turnOffAtShutdown: true, startServices: [], exitServices: [] },
    performance: { enabled: true, highPerformancePlan: false, programs: [{ name: 'Wallpaper Engine', process: 'wallpaper64.exe;wallpaper32.exe', action: 'pause', pauseArgs: '-control pause', resumeArgs: '-control play', restore: true, enabled: true }] },
    steam: { enabled: true, path: '', launchViaBigPicture: false, showBigPictureTile: true },
    stores: { epic: true, gog: true },
    scraper: { source: 'auto', downloadSnaps: true, autoScrape: true, mediaDir: '', screenscraper: { user: '', password: '', devid: '', devpassword: '' } },
    emulators: emulators.map((e) => ({ id: e.id, name: e.name, exe: 'C:\\Emulatoren\\' + e.name + '.exe', args: '-f "{rom}"' })),
    systems: systems.filter((s) => s.kind === 'emulator').map((s) => ({ id: s.id, name: s.name, short: s.short, color: s.color, extensions: ['.zip'], romDirs: ['C:\\ROMs\\' + s.id], emulator: s.emulatorId, enabled: true })),
    pcGames: [], gameOverrides: {}, favorites: ['snes-1', 'steam-2'], recent: ['steam-0', 'snes-2', 'gc-0', 'steam-4'],
    playtime: { 'steam-0': 2.6 * 3600000, 'snes-2': 40 * 60000 }, lastPlayed: { 'steam-0': Date.now() - 3600000, 'snes-2': Date.now() - 86400000 * 2 }
  };
  cfg = JSON.parse(JSON.stringify(defaults));
  const noop = () => () => {};
  window.api = {
    getConfig: async () => cfg, getDefaults: async () => defaults, saveConfig: async (c) => (cfg = c), configPath: async () => 'config.json', openConfigFile: async () => {},
    getLibrary: async () => library, refreshLibrary: async () => library, detectEmulators: async () => ({ changes: [], config: cfg, library }),
    launch: async () => ({ running: false }), kill: async () => true, gameStatus: async () => ({ running: false }),
    power: async () => {}, setDisplayMode: async () => {}, displays: async () => [{ index: 0, label: 'TV', width: 3840, height: 2160 }], info: async () => ({}),
    updateState: async () => ({ status: 'latest', version: '1.0.0' }), checkUpdate: async () => null, installUpdate: async () => false, onUpdateState: noop,
    recommendedPrograms: async () => [{ name: 'OneDrive', process: 'OneDrive.exe', action: 'close', note: 'Synchronisation' }, { name: 'Microsoft Teams', process: 'ms-teams.exe', action: 'close', note: 'Viel RAM' }],
    runningPrograms: async () => [{ name: 'Google Chrome', process: 'chrome.exe', memMB: 1840 }, { name: 'Discord', process: 'Discord.exe', memMB: 520 }],
    scrape: async () => ({ total: 3, found: 2, missing: 1, finished: true }), cancelScrape: async () => true, mediaDir: async () => 'media',
    onScrapeProgress: noop, onLibraryChanged: noop,
    launchEmulator: async () => ({ running: false }), openRomDir: async () => 'C:\\ROMs',
    haTest: async () => ({ message: 'API running.', players: [{ id: 'media_player.lg_tv', name: 'LG OLED Wohnzimmer', state: 'off', sources: ['HDMI 1', 'HDMI 2', 'HDMI 3', 'Netflix', 'YouTube'] }], scripts: [] }),
    haTv: async () => ({ on: true, source: 'HDMI 2' }), toggleMouseMode: async () => true, onMouseMode: noop,
    overlayData: async () => ({ running: { id: 'snes-1', name: 'Dungeon Quest', system: 'snes', startedAt: Date.now() - 23 * 60000, cover: '' },
      recent: games.slice(0, 6).map((g) => ({ id: g.id, name: g.name, cover: g.cover, system: g.system })), systems, ps: true }),
    overlaySpotify: async () => ({ running: true, playing: true, artist: 'Daft Punk', title: 'Get Lucky' }),
    overlayAction: async () => true, onOverlayOpen: (cb) => { setTimeout(cb, 100); return () => {}; }, onOverlayClose: noop, onOverlayRefresh: noop,
    pickFile: async () => null, pickFolder: async () => null, pickImage: async () => null,
    onGameStatus: noop, onConfigChanged: noop, onToast: noop, onWindowFocus: noop, onGamepadConnection: noop, onPadState: noop, hidControllers: async () => 0
  };
})();
