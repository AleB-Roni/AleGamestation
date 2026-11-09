/* Einstellungen: alle Optionen, per Controller navigierbar.
 * Zeilentypen: toggle, select, number, text, path, button, group */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = window.api;

  const DISPLAY_OPTS = [
    { value: 'none', label: 'Nichts ändern' },
    { value: 'external', label: 'Nur TV / zweiter Bildschirm' },
    { value: 'internal', label: 'Nur PC-Bildschirm' },
    { value: 'clone', label: 'Duplizieren' },
    { value: 'extend', label: 'Erweitern' }
  ];
  const COMBO_PRESETS = ['BACK+START', 'BACK+B', 'GUIDE', 'GUIDE+B', 'LB+RB+START', 'LS+RS', 'BACK+LB+RB', 'BACK+Y'];
  const KILL_OPTS = [
    { value: 'dir', label: 'Alle Prozesse aus dem Spielordner' },
    { value: 'tree', label: 'Nur gestarteter Prozess + Kinder' },
    { value: 'name', label: 'Nach Prozessname' }
  ];

  const S = { section: 0, focus: 0, rows: [], displays: [] };

  // Hilfsfunktionen zum Lesen/Schreiben verschachtelter Werte
  const C = () => App.cfg;
  function toggle(label, obj, key, desc, opts = {}) {
    return { type: 'toggle', label, desc, get: () => !!obj()[key], set: (v) => { obj()[key] = v; }, ...opts };
  }
  function select(label, obj, key, options, desc, opts = {}) {
    return { type: 'select', label, desc, options, get: () => obj()[key], set: (v) => { obj()[key] = v; }, ...opts };
  }
  function text(label, obj, key, desc, opts = {}) {
    return { type: 'text', label, desc, get: () => obj()[key] ?? '', set: (v) => { obj()[key] = v; }, ...opts };
  }
  function pathRow(label, obj, key, kind, desc, opts = {}) {
    return { type: 'path', kind, label, desc, get: () => obj()[key] ?? '', set: (v) => { obj()[key] = v; }, ...opts };
  }
  function listText(label, obj, key, desc, opts = {}) {
    return { type: 'text', label, desc, get: () => (obj()[key] || []).join(' ; '), set: (v) => { obj()[key] = v.split(';').map((x) => x.trim()).filter(Boolean); }, ...opts };
  }
  const group = (label, extra) => ({ type: 'group', label, extra });
  const button = (label, action, opts = {}) => ({ type: 'button', label, action, ...opts });

  const SECTIONS = [
    {
      id: 'general', title: 'Allgemein', rows: () => [
        group('Start'),
        toggle('Mit Windows starten', () => C().general, 'autostartWithWindows', 'Konsolenmodus startet automatisch nach der Anmeldung'),
        toggle('Vollbild', () => C().general, 'startFullscreen'),
        select('Oberfläche anzeigen auf', () => C().general, 'targetDisplay', [{ value: 'primary', label: 'Hauptbildschirm' }].concat(S.displays.map((d) => ({ value: String(d.index), label: `${d.label} (${d.width}×${d.height})` }))), 'Bei „Nur TV“ ist der TV automatisch der Hauptbildschirm'),
        group('Beim Spielen'),
        toggle('Oberfläche minimieren, während ein Spiel läuft', () => C().general, 'minimizeOnLaunch'),
        toggle('Nach Spielende zurück in die Oberfläche', () => C().general, 'refocusAfterGame'),
        group('Darstellung'),
        select('Akzentfarbe', () => C().general, 'accentColor', [
          { value: '#7c5cff', label: 'Violett' }, { value: '#22d3ee', label: 'Cyan' }, { value: '#3ddc84', label: 'Grün' },
          { value: '#ff4d6d', label: 'Rot' }, { value: '#ff9f1c', label: 'Orange' }, { value: '#3b82f6', label: 'Blau' }, { value: '#e5e5e5', label: 'Weiß' }
        ]),
        select('Größe der Oberfläche', () => C().general, 'uiScale', [0.85, 1, 1.15, 1.3, 1.5].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' })), 'Größer für weit entfernte Fernseher'),
        group('Sound'),
        {
          type: 'select', label: 'Menü-Sounds', desc: 'Modern = sanfte Konsolen-Klänge mit Hall',
          options: [{ value: 'modern', label: 'Modern' }, { value: 'retro', label: 'Retro (8-Bit)' }, { value: 'off', label: 'Aus' }],
          get: () => (C().general.uiSounds === false ? 'off' : C().general.soundTheme || 'modern'),
          set: (v) => { C().general.uiSounds = v !== 'off'; if (v !== 'off') C().general.soundTheme = v; },
          after: () => setTimeout(() => Sounds.play('accept'), 50)
        },
        select('Lautstärke', () => C().general, 'soundVolume', [0.2, 0.35, 0.5, 0.7, 0.85, 1].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' })), '', { after: () => setTimeout(() => Sounds.play('accept'), 50) }),
        toggle('Start-Klang', () => C().general, 'startupSound', 'Kurzer Klang beim Öffnen von AleGamestation'),
        toggle('Uhr anzeigen', () => C().general, 'showClock'),
        toggle('Mauszeiger ausblenden', () => C().general, 'hideCursor'),
        toggle('Herunterfahren usw. bestätigen', () => C().general, 'confirmPowerActions'),
        group('Konfiguration'),
        button('Konfigurationsdatei (JSON) öffnen', () => api.openConfigFile(), { desc: 'Für fortgeschrittene Einstellungen' })
      ]
    },
    {
      id: 'display', title: 'Anzeige', rows: () => [
        group('Bildschirm umschalten (wie Win + P)'),
        select('Beim Start des Konsolenmodus', () => C().display, 'onStart', DISPLAY_OPTS, 'z.B. PC-Monitor aus, nur noch TV'),
        select('Beim Beenden (zurück zum Desktop)', () => C().display, 'onExit', DISPLAY_OPTS),
        toggle('Vor Herunterfahren/Neustart wiederherstellen', () => C().display, 'restoreBeforeShutdown', 'Damit Windows beim nächsten Start wieder auf dem Monitor erscheint'),
        select('Wartezeit nach dem Umschalten', () => C().display, 'switchDelayMs', [1000, 1500, 2500, 4000, 6000].map((v) => ({ value: v, label: v / 1000 + ' s' }))),
        group('Eigene Befehle', 'z.B. Audio auf TV umstellen mit NirCmd'),
        listText('Befehle beim Start', () => C().display, 'customCommandsOnStart', 'Mehrere mit ; trennen. Beispiel: nircmd setdefaultsounddevice "TV"'),
        listText('Befehle beim Beenden', () => C().display, 'customCommandsOnExit'),
        group('Jetzt testen'),
        ...DISPLAY_OPTS.filter((o) => o.value !== 'none').map((o) => button('Test: ' + o.label, () => api.setDisplayMode(o.value)))
      ]
    },
    {
      id: 'controller', title: 'Controller', rows: () => [
        group('Spiel beenden'),
        select('Tastenkombination „Spiel beenden“', () => C().controller, 'closeGameCombo', comboOptions(C().controller.closeGameCombo), 'Funktioniert auch, während das Spiel im Vordergrund ist'),
        button('Kombination „Spiel beenden“ aufnehmen …', () => recordCombo('closeGameCombo')),
        select('Tastenkombination „Oberfläche zeigen“', () => C().controller, 'showLauncherCombo', comboOptions(C().controller.showLauncherCombo), 'Holt AleGamestation in den Vordergrund, ohne das Spiel zu beenden'),
        button('Kombination „Oberfläche zeigen“ aufnehmen …', () => recordCombo('showLauncherCombo')),
        select('Gedrückt halten für', () => C().controller, 'comboHoldMs', [0, 300, 500, 800, 1200, 2000].map((v) => ({ value: v, label: v ? v / 1000 + ' s' : 'sofort' }))),
        select('Spiel erst sanft schließen', () => C().controller, 'gracefulCloseMs', [0, 800, 1500, 3000].map((v) => ({ value: v, label: v ? `ja, ${v / 1000} s warten` : 'nein, sofort beenden' })), 'Gibt Emulatoren Zeit zum Speichern'),
        group('Controller-Typ', `Erkannt: ${Glyphs.detected().label}${Glyphs.detected().name ? ' – ' + Glyphs.detected().name : ''}`),
        select('Tastensymbole', () => C().controller, 'glyphStyle', [
          { value: 'auto', label: 'Automatisch erkennen' }, { value: 'playstation', label: 'PlayStation  ✕ ○ □ △' },
          { value: 'xbox', label: 'Xbox  A B X Y' }, { value: 'nintendo', label: 'Nintendo' }
        ], 'Welche Symbole in der Oberfläche angezeigt werden'),
        toggle('PlayStation-Controller direkt unterstützen', () => C().controller, 'playstationHid', 'DualSense / DualShock 4 per USB oder Bluetooth – Beenden-Kombination funktioniert ohne Steam Input oder DS4Windows'),
        group('Navigation'),
        toggle('Analog-Stick zur Navigation', () => C().controller, 'useAnalogStick'),
        toggle('A/B tauschen (Nintendo-Layout)', () => C().controller, 'swapAB')
      ]
    },
    {
      id: 'emulators', title: 'Emulatoren', rows: () => {
        const rows = [
          button('🔍 Installierte Emulatoren automatisch suchen', async () => {
            const r = await api.detectEmulators();
            App.cfg = r.config;
            App.library = r.library;
            App.toast(r.changes.length ? `Gefunden: ${r.changes.map((c) => c.name).join(', ')}` : 'Keine neuen Emulatoren gefunden', r.changes.length ? 'ok' : 'info', 5000);
            render();
          }),
          button('＋ Emulator hinzufügen', () => {
            C().emulators.push({ id: 'emu-' + Date.now(), name: 'Neuer Emulator', exe: '', args: '"{rom}"' });
            commit(true);
            S.focus = S.rows.length;
          })
        ];
        C().emulators.forEach((e, i) => {
          const found = (App.library.emulators || []).find((x) => x.id === e.id);
          const used = C().systems.filter((s) => s.emulator === e.id).map((s) => s.short || s.name);
          rows.push(group(e.name, `${found && found.found ? '✔ gefunden' : '✖ nicht gefunden'}${used.length ? ' · für ' + used.join(', ') : ''}`));
          const o = () => C().emulators[i];
          rows.push(text('Name', o, 'name'));
          rows.push(pathRow('Programm (.exe)', o, 'exe', 'file', '', { rescan: true }));
          rows.push(text('Start-Argumente', o, 'args', 'Platzhalter: {rom} {romName} {romDir} {emuDir}'));
          rows.push(button('Emulator löschen', async () => {
            if (await App.confirm('Emulator löschen?', esc(e.name), 'Löschen')) { C().emulators.splice(i, 1); commit(true); }
          }, { danger: true }));
        });
        return rows;
      }
    },
    {
      id: 'systems', title: 'Systeme & ROMs', rows: () => {
        const emuOpts = C().emulators.map((e) => ({ value: e.id, label: e.name }));
        const rows = [button('＋ System hinzufügen', () => {
          C().systems.push({ id: 'sys-' + Date.now(), name: 'Neues System', short: 'Neu', color: '#888888', extensions: ['.zip'], romDirs: [], emulator: (C().emulators[0] || {}).id, enabled: true });
          commit(true);
        })];
        C().systems.forEach((s, i) => {
          const o = () => C().systems[i];
          const count = (App.library.systems.find((x) => x.id === s.id) || { count: 0 }).count;
          rows.push(group(s.name, `${count} Spiele`));
          rows.push(toggle('Aktiv', o, 'enabled', '', { rescan: true }));
          rows.push(select('Standard-Emulator', o, 'emulator', emuOpts, 'Pro Spiel änderbar: Spiel auswählen → Y → „Starten mit“', { rescan: true }));
          rows.push(listText('ROM-Ordner', o, 'romDirs', 'Mehrere mit ; trennen (Unterordner werden mit durchsucht)', { rescan: true }));
          rows.push(button('Ordner hinzufügen …', async () => {
            const d = await api.pickFolder();
            if (d) { o().romDirs = [...(o().romDirs || []), d]; commit(true); }
          }));
          rows.push(listText('Dateiendungen', o, 'extensions', 'z.B. .sfc ; .smc ; .zip', { rescan: true }));
          rows.push(text('Name', o, 'name', '', { rescan: true }));
          rows.push(text('Kurzname', o, 'short', '', { rescan: true }));
          rows.push(button('System löschen', async () => {
            if (await App.confirm('System löschen?', esc(s.name), 'Löschen')) { C().systems.splice(i, 1); commit(true); }
          }, { danger: true }));
        });
        return rows;
      }
    },
    {
      id: 'games', title: 'Eigene Spiele', rows: () => {
        const rows = [button('＋ Spiel / Programm hinzufügen …', async () => {
          const exe = await api.pickFile();
          if (!exe) return;
          const name = exe.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, '');
          C().pcGames.push({ id: 'pc-' + Date.now(), name, exe, args: '', cwd: '', cover: '', killMode: 'dir', processName: '' });
          commit(true);
        }, { desc: 'Epic-, GOG- und andere Spiele, Kodi, Emulator-Frontends …' })];
        C().pcGames.forEach((g, i) => {
          const o = () => C().pcGames[i];
          rows.push(group(g.name || 'Spiel'));
          rows.push(text('Name', o, 'name', '', { rescan: true }));
          rows.push(pathRow('Programm', o, 'exe', 'file', '', { rescan: true }));
          rows.push(text('Argumente', o, 'args'));
          rows.push(pathRow('Cover-Bild', o, 'cover', 'image', 'Hochformat 600×900 sieht am besten aus', { rescan: true }));
          rows.push(select('Beenden per Controller', o, 'killMode', KILL_OPTS, 'Wenn sich das Spiel nicht beenden lässt: „Spielordner“ wählen', { rescan: true }));
          rows.push(text('Prozessname (bei „Nach Prozessname“)', o, 'processName', 'z.B. game-win64.exe'));
          rows.push(button('Entfernen', async () => {
            if (await App.confirm('Spiel entfernen?', esc(g.name), 'Entfernen')) { C().pcGames.splice(i, 1); commit(true); }
          }, { danger: true }));
        });
        return rows;
      }
    },
    {
      id: 'media', title: 'Cover', rows: () => {
        const SC = () => C().scraper;
        const SS = () => C().scraper.screenscraper;
        const roms = App.library.games.filter((g) => g.type === 'rom');
        const withCover = roms.filter((g) => g.cover).length;
        const ssReady = ['user', 'password', 'devid', 'devpassword'].every((k) => SS()[k]);
        return [
          group('Cover herunterladen', `${withCover} von ${roms.length} ROMs haben ein Cover`),
          button('⬇ Fehlende Cover jetzt herunterladen', () => App.scrape({})),
          button('⬇ Alle Cover neu herunterladen', async () => {
            if (await App.confirm('Alle Cover neu laden?', 'Vorhandene heruntergeladene Bilder werden ersetzt. Eigene Cover (über „Cover-Bild ändern“) bleiben erhalten.', 'Neu laden')) App.scrape({ force: true });
          }),
          button('✕ Laufenden Download abbrechen', () => api.cancelScrape()),
          select('Quelle', SC, 'source', [
            { value: 'auto', label: 'Automatisch (ScreenScraper, sonst libretro)' },
            { value: 'libretro', label: 'Nur libretro (ohne Konto)' },
            { value: 'screenscraper', label: 'Nur ScreenScraper' }
          ], ssReady ? '✔ ScreenScraper-Zugang eingetragen' : 'libretro funktioniert sofort – am besten mit ROMs im No-Intro/Redump-Namensformat'),
          toggle('Screenshots / Fanart als Hintergrund laden', SC, 'downloadSnaps', 'Wird hinter dem ausgewählten Spiel angezeigt'),
          toggle('Neue Spiele automatisch', SC, 'autoScrape', 'Beim Start fehlende Cover im Hintergrund laden'),
          pathRow('Speicherort', SC, 'mediaDir', 'folder', 'Leer = im AleGamestation-Datenordner', { rescan: true }),
          group('ScreenScraper.fr', 'optional – größte Datenbank, erkennt ROMs auch per Prüfsumme'),
          text('Benutzername', SS, 'user', 'Kostenloses Konto auf screenscraper.fr'),
          text('Passwort', SS, 'password', '', { secret: true }),
          text('Entwickler-ID (devid)', SS, 'devid', 'ScreenScraper verlangt zusätzlich einen Entwickler-Zugang – im ScreenScraper-Forum kostenlos beantragen'),
          text('Entwickler-Passwort', SS, 'devpassword', '', { secret: true })
        ];
      }
    },
    {
      id: 'performance', title: 'Leistung', rows: () => {
        const P = () => C().performance;
        const programs = P().programs || [];
        const rows = [
          group('Leistungsmodus', 'Beim Start des Konsolenmodus'),
          toggle('Hintergrundprogramme pausieren / beenden', P, 'enabled', 'Spart CPU, GPU und RAM für deine Spiele – beim Verlassen wird alles wiederhergestellt'),
          toggle('Energieplan „Höchstleistung“', P, 'highPerformancePlan', 'Während des Konsolenmodus, danach wird der vorherige Plan wiederhergestellt'),
          button('＋ Empfohlene Programme hinzufügen …', recommendedMenu),
          button('＋ Aus laufenden Programmen wählen …', runningMenu),
          button('＋ Programm (.exe) auswählen …', async () => {
            const exe = await api.pickFile({ filters: [{ name: 'Programme', extensions: ['exe'] }] });
            if (!exe) return;
            const file = exe.split(/[\\/]/).pop();
            programs.push({ name: file.replace(/\.exe$/i, ''), process: file, action: 'pause', restore: true, enabled: true });
            commit(false);
          })
        ];
        const ACTIONS = [
          { value: 'pause', label: 'Pausieren (einfrieren)' },
          { value: 'close', label: 'Schließen' },
          { value: 'kill', label: 'Sofort beenden' }
        ];
        programs.forEach((p, i) => {
          const o = () => P().programs[i];
          rows.push(group(p.name, p.process));
          rows.push(toggle('Aktiv', o, 'enabled'));
          rows.push(select('Aktion', o, 'action', ACTIONS, p.pauseArgs ? 'Wird über die programmeigene Pause-Funktion pausiert' : 'Pausieren: Programm bleibt offen, verbraucht aber keine CPU mehr'));
          rows.push(toggle('Beim Verlassen wiederherstellen', o, 'restore', 'Fortsetzen bzw. wieder starten'));
          rows.push(text('Prozessname(n)', o, 'process', 'z.B. wallpaper64.exe – mehrere mit ; trennen'));
          rows.push(button('Entfernen', () => { P().programs.splice(i, 1); commit(false); }, { danger: true }));
        });
        return rows;
      }
    },
    {
      id: 'stores', title: 'Steam & Stores', rows: () => {
        const hidden = App.library.games.filter((g) => g.hidden);
        return [
          group('Steam', App.library.steamFound ? '✔ Steam gefunden' : '✖ Steam nicht gefunden'),
          toggle('Steam-Spiele anzeigen', () => C().steam, 'enabled', 'Installierte Spiele werden automatisch erkannt', { rescan: true }),
          pathRow('Steam-Ordner', () => C().steam, 'path', 'folder', 'Leer lassen = automatisch suchen', { rescan: true }),
          toggle('Kachel „Steam Big Picture öffnen“', () => C().steam, 'showBigPictureTile', '', { rescan: true }),
          group('Weitere Stores'),
          toggle('Epic Games Launcher', () => C().stores, 'epic', 'Installierte Epic-Spiele automatisch erkennen', { rescan: true }),
          toggle('GOG', () => C().stores, 'gog', 'Installierte GOG-Spiele automatisch erkennen', { rescan: true }),
          group('Bibliothek', `${App.library.games.length} Spiele`),
          button('↻ Bibliothek jetzt neu einlesen', async () => { await App.refreshLibrary(); App.toast(`${App.library.games.length} Spiele gefunden`, 'ok'); render(); }),
          ...hidden.map((g) => button(`Wieder einblenden: ${g.name}`, async () => {
            delete (C().gameOverrides[g.id] || {}).hidden;
            await commit(true);
          })),
          button('Spielzeit-Statistik zurücksetzen', async () => {
            if (await App.confirm('Statistik zurücksetzen?', 'Spielzeiten und „Zuletzt gespielt“ werden gelöscht.', 'Zurücksetzen')) {
              C().playtime = {}; C().lastPlayed = {}; C().recent = []; commit(false);
            }
          }, { danger: true })
        ];
      }
    },
    {
      id: 'about', title: 'Info & Updates', rows: () => {
        const u = S.update || {};
        const status = {
          dev: 'Entwicklerversion – Updates nur in der installierten App',
          unsupported: 'Updates nicht verfügbar',
          idle: 'Noch nicht gesucht',
          checking: 'Suche nach Updates …',
          latest: '✔ Du hast die neueste Version',
          downloading: `⬇ Lade v${u.available || ''} herunter … ${u.progress || 0} %`,
          ready: `⬆ Version ${u.available} ist bereit zur Installation`,
          error: `✖ Fehler: ${u.error || ''}`
        }[u.status] || '';
        const rows = [
          group('AleGamestation', `Version ${u.version || ''}`),
          { type: 'info', label: 'Update-Status', desc: status, get: () => '' },
          toggle('Automatisch nach Updates suchen', () => C().general, 'autoUpdate', 'Beim Start auf GitHub prüfen und im Hintergrund herunterladen')
        ];
        if (u.status === 'ready') rows.push(button(`⬆ Jetzt auf v${u.available} aktualisieren und neu starten`, () => App.installUpdate()));
        rows.push(button('↻ Jetzt nach Updates suchen', async () => { await api.checkUpdate(); await refreshUpdate(); }));
        if (u.notes) rows.push(group('Neu in dieser Version'), { type: 'info', label: u.notes.split('\n')[0].slice(0, 120), desc: u.notes.split('\n').slice(1).join(' ').slice(0, 300), get: () => '' });
        return rows;
      }
    }
  ];

  async function recommendedMenu() {
    const list = await api.recommendedPrograms();
    const have = new Set((C().performance.programs || []).map((p) => p.process.toLowerCase()));
    const items = list.filter((r) => !have.has(r.process.toLowerCase())).map((r) => ({
      label: r.name, hint: r.note, icon: r.action === 'pause' ? '⏸' : '✕',
      action: () => { C().performance.programs.push({ ...r, enabled: true, note: undefined }); App.closeMenu(); commit(false); App.toast(`${r.name} hinzugefügt`, 'ok'); }
    }));
    if (!items.length) return App.toast('Alle Empfehlungen sind bereits hinzugefügt', 'info');
    App.menu({ title: 'Empfohlene Programme', text: 'Programme, die im Hintergrund oft Leistung kosten. Sie werden nur behandelt, wenn sie gerade laufen.', items });
  }

  async function runningMenu() {
    App.toast('Lese laufende Programme …', 'info', 1500);
    const list = await api.runningPrograms();
    const have = new Set((C().performance.programs || []).map((p) => p.process.toLowerCase()));
    const items = list.filter((r) => !have.has(r.process.toLowerCase())).map((r) => ({
      label: r.name, hint: `${r.memMB} MB`, icon: '▣',
      action: () => { C().performance.programs.push({ name: r.name, process: r.process, action: 'pause', restore: true, enabled: true }); App.closeMenu(); commit(false); App.toast(`${r.name} hinzugefügt`, 'ok'); }
    }));
    if (!items.length) return App.toast('Keine passenden laufenden Programme gefunden', 'info');
    App.menu({ title: 'Laufende Programme', text: 'Nach Arbeitsspeicher sortiert. Auswählen, um es beim Start des Konsolenmodus zu pausieren.', items });
  }

  async function refreshUpdate() {
    try { S.update = await api.updateState(); } catch { S.update = {}; }
    if (SECTIONS[S.section].id === 'about') render();
  }

  function comboOptions(current) {
    const list = COMBO_PRESETS.includes(current) ? COMBO_PRESETS : [current, ...COMBO_PRESETS];
    return list.map((c) => ({ value: c, label: Glyphs.comboLabel(c) }));
  }

  async function commit(rescan) {
    await App.save({ immediate: true, rescan });
    render();
  }

  // ---------- Kombination aufnehmen ----------
  function recordCombo(key) {
    App.recording = true;
    let best = [];
    let stableSince = 0;
    let lastSig = '';
    const HOLD = 1500;
    App.menu({ title: 'Kombination aufnehmen', text: 'Halte die gewünschten Tasten am Controller <b>1,5 Sekunden</b> gleichzeitig gedrückt.<br>Abbrechen mit Esc.', items: [] });
    const box = $('#modal');
    const live = document.createElement('div');
    live.className = 'combo-live';
    live.textContent = '…';
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.innerHTML = '<div></div>';
    box.appendChild(live);
    box.appendChild(bar);
    const stop = (save) => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
      setTimeout(() => { App.recording = false; }, 400);
      App.closeMenu();
      if (save && best.length) {
        C().controller[key] = best.join('+');
        App.toast(`Gespeichert: ${best.join(' + ')}`, 'ok');
        commit(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); stop(false); } };
    window.addEventListener('keydown', onKey, true);
    const timer = setInterval(() => {
      const now = Input.rawButtons();
      const order = ['GUIDE', 'BACK', 'START', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'A', 'B', 'X', 'Y', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
      now.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const sig = now.join('+');
      if (sig !== lastSig) { lastSig = sig; stableSince = performance.now(); }
      live.textContent = now.length ? now.join(' + ') : '…';
      const p = now.length ? Math.min(1, (performance.now() - stableSince) / HOLD) : 0;
      bar.firstChild.style.width = p * 100 + '%';
      if (p >= 1) { best = now; stop(true); }
    }, 40);
  }

  // ---------- Darstellung ----------
  function renderTabs() {
    const t = $('#settingsTabs');
    t.innerHTML = '';
    SECTIONS.forEach((s, i) => {
      const e = document.createElement('div');
      e.className = 'tab' + (i === S.section ? ' active' : '');
      e.textContent = s.title;
      e.onclick = () => { S.section = i; S.focus = 0; render(); };
      t.appendChild(e);
    });
  }

  function valueHtml(r) {
    const v = r.get ? r.get() : null;
    switch (r.type) {
      case 'toggle': return `<div class="toggle ${v ? 'on' : ''}"></div>`;
      case 'select': {
        const o = r.options.find((x) => String(x.value) === String(v)) || { label: v ?? '–' };
        return `<span class="select"><span class="arrow">◀</span>${esc(o.label)}<span class="arrow">▶</span></span>`;
      }
      case 'text': return `<input type="${r.secret ? 'password' : 'text'}" value="${esc(v)}" spellcheck="false" autocomplete="off">`;
      case 'path': return `<input type="text" value="${esc(v)}" spellcheck="false"><span class="mini-btn">Durchsuchen</span>`;
      default: return '';
    }
  }

  function render() {
    renderTabs();
    S.rows = SECTIONS[S.section].rows();
    const body = $('#settingsBody');
    body.innerHTML = '';
    const focusables = [];
    S.rows.forEach((r) => {
      if (r.type === 'group') {
        const g = document.createElement('div');
        g.className = 's-group';
        g.innerHTML = `<span>${esc(r.label)}</span>${r.extra ? `<span>${esc(r.extra)}</span>` : ''}`;
        body.appendChild(g);
        return;
      }
      const row = document.createElement('div');
      row.className = 's-row' + (r.type === 'button' ? ' button-row' : '') + (r.danger ? ' danger' : '');
      row.innerHTML = `<div class="s-label"><b>${esc(r.label)}</b>${r.desc ? `<small>${esc(r.desc)}</small>` : ''}</div><div class="s-value">${valueHtml(r)}</div>`;
      const idx = focusables.length;
      row.onclick = (e) => {
        S.focus = idx; updateFocus();
        if (e.target.tagName !== 'INPUT') act('accept');
      };
      const input = row.querySelector('input');
      if (input) {
        input.addEventListener('change', () => { r.set(input.value); commit(!!r.rescan); });
        input.addEventListener('focus', () => { S.focus = idx; updateFocus(true); });
      }
      r.el = row;
      focusables.push(r);
      body.appendChild(row);
    });
    S.focusables = focusables;
    S.focus = Math.min(S.focus, focusables.length - 1);
    updateFocus();
    App.renderHints();
  }

  function updateFocus(noScroll) {
    (S.focusables || []).forEach((r, i) => r.el.classList.toggle('focused', i === S.focus));
    const r = S.focusables && S.focusables[S.focus];
    if (r && !noScroll) r.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function act(a) {
    const r = S.focusables[S.focus];
    if (!r) return;
    if (a === 'left' || a === 'right') {
      if (r.type === 'select') {
        const i = r.options.findIndex((o) => String(o.value) === String(r.get()));
        const n = (i + (a === 'right' ? 1 : -1) + r.options.length) % r.options.length;
        r.set(r.options[n].value);
        Sounds.play('move');
        await commit(!!r.rescan);
        if (r.after) r.after();
      } else if (r.type === 'toggle') {
        r.set(a === 'right');
        Sounds.play('toggle');
        await commit(!!r.rescan);
      }
      return;
    }
    if (a === 'accept') {
      if (r.type === 'info') return;
      Sounds.play(r.type === 'toggle' ? 'toggle' : 'accept');
      if (r.type === 'toggle') { r.set(!r.get()); await commit(!!r.rescan); }
      else if (r.type === 'select') return act('right');
      else if (r.type === 'button') await r.action();
      else if (r.type === 'text') { const inp = r.el.querySelector('input'); inp.focus(); inp.select(); }
      else if (r.type === 'path') {
        const p = r.kind === 'folder' ? await api.pickFolder() : r.kind === 'image' ? await api.pickImage() : await api.pickFile();
        if (p) { r.set(p); await commit(!!r.rescan); }
      }
    }
  }

  window.SettingsView = {
    async open(sectionId) {
      if (sectionId) { S.section = Math.max(0, SECTIONS.findIndex((s) => s.id === sectionId)); S.focus = 0; }
      try { S.displays = await api.displays(); } catch { S.displays = []; }
      try { S.update = await api.updateState(); } catch { S.update = {}; }
      render();
    },
    handle(a) {
      switch (a) {
        case 'up': if (S.focus > 0) { S.focus--; updateFocus(); Sounds.play('move'); } break;
        case 'down': if (S.focus < S.focusables.length - 1) { S.focus++; updateFocus(); Sounds.play('move'); } break;
        case 'x': S.section = (S.section + SECTIONS.length - 1) % SECTIONS.length; S.focus = 0; render(); Sounds.play('tab'); break;
        case 'y': S.section = (S.section + 1) % SECTIONS.length; S.focus = 0; render(); Sounds.play('tab'); break;
        case 'back': case 'select': Sounds.play('back'); App.backToLibrary(); break;
        default: act(a);
      }
    },
    refreshUpdate,
    rerender: () => render(),
    hints(hint, glyph) {
      return hint(glyph('A'), 'Ändern') + hint('◀ ▶', 'Wert') + hint(glyph('X') + glyph('Y'), 'Bereich') + hint(glyph('B'), 'Zurück');
    }
  };
})();
