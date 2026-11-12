/* Einstellungen: alle Optionen, per Controller navigierbar.
 * Zeilentypen: toggle, select, number, text, path, button, group */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = window.api;

  const DISPLAY_OPTS = [
    { value: 'none', label: 'Nichts ändern' },
    { value: 'tvOnly', label: 'Nur Fernseher (ausgewählt)' },
    { value: 'tvPrimary', label: 'Fernseher als Hauptbildschirm (alle bleiben an)' },
    { value: 'external', label: 'Nur zweiter Bildschirm (Windows)' },
    { value: 'internal', label: 'Nur PC-Bildschirm' },
    { value: 'clone', label: 'Duplizieren' },
    { value: 'extend', label: 'Erweitern' }
  ];
  const COMBO_PRESETS = ['BACK+START', 'BACK+B', 'GUIDE', 'GUIDE+B', 'LB+RB+START', 'LS+RS', 'BACK+LB+RB', 'BACK+Y'];
  const KILL_OPTS = [
    { value: 'dir', label: 'Alle Prozesse aus dem Spielordner', short: 'Spielordner' },
    { value: 'tree', label: 'Nur gestarteter Prozess + Kinder', short: 'Prozess' },
    { value: 'name', label: 'Nach Prozessname', short: 'Prozessname' }
  ];

  const S = { section: 0, focus: 0, rows: [], displays: [] };

  function displayLabel(d) {
    const n = S.displays.indexOf(d);
    const info = d.active === false ? 'gerade aus' : `${d.width}×${d.height}${d.hz ? ' · ' + d.hz + ' Hz' : ''}${d.primary ? ' · Hauptbildschirm' : ''}`;
    return `${n >= 0 ? n + 1 + '. ' : ''}${d.name} – ${info}`;
  }
  /** Zustand des Fernsehers: an/aus, verbunden, in Windows aktiv/deaktiviert */
  function tvStatusRows() {
    const t = S.tv;
    if (!C().display.tv) return [];
    const parts = [];
    if (t && t.power) parts.push(`Fernseher: ${t.power}${t.source ? ' · Eingang ' + t.source : ''}`);
    if (t) parts.push(`Windows: ${t.windows}`);
    const status = t ? (t.active ? 'ok' : t.connected ? 'off' : 'bad') : '';
    return [
      { type: 'item', label: 'Zustand', desc: t ? parts.join('  ·  ') : 'Wird ermittelt …', status, statusText: t ? (t.active ? 'bereit' : t.connected ? 'deaktiviert' : 'nicht verbunden') : '',
        action: async () => { S.tv = await api.tvStatus().catch(() => null); render(); App.toast('Zustand aktualisiert', 'info', 1200); } },
      {
        ...toggle('Fernseher als Hauptanzeige', () => C().display, 'tvAsPrimary', 'Im Konsolenmodus wird der TV zur Hauptanzeige – Spiele starten dort. Beim Beenden wird wieder dein Hauptmonitor zur Hauptanzeige'),
        get: () => !!C().display.tvAsPrimary || C().display.onStart === 'tvPrimary' || C().display.onStart === 'tvOnly',
        set: (v) => {
          C().display.tvAsPrimary = v;
          // „Fernseher als Hauptbildschirm“ als Startmodus passt nicht zu „aus“
          if (!v && C().display.onStart === 'tvPrimary') C().display.onStart = 'extend';
        }
      },
      { ...toggle('Deaktivierten Fernseher automatisch einschalten', () => C().display, 'enableTv', 'Ist der TV angesteckt, aber in Windows abgeschaltet, wird er beim Start eingeschaltet und beim Beenden wieder abgeschaltet'), get: () => C().display.enableTv !== false },
      ...(t && t.connected && !t.active ? [button('Fernseher jetzt in Windows einschalten', async () => {
        const r = await api.activateTv().catch((e) => ({ ok: false, error: String(e.message || e) }));
        App.toast(r && r.ok ? 'Fernseher ist in Windows eingeschaltet' : (r && r.error) || 'Einschalten fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
        S.tv = await api.tvStatus().catch(() => null); render();
      })] : [])
    ];
  }

  /** Tonausgabe im Konsolenmodus; ein gespeichertes, gerade nicht verbundenes Gerät bleibt sichtbar */
  function audioSelect() {
    const cur = C().display.audioDevice;
    const list = S.audio || [];
    const label = (a) => `${a.name}${a.default ? ' · aktuell' : ''}${a.active ? '' : ' · nicht verbunden'}`;
    const opts = [{ value: '', label: 'Nicht ändern' }].concat(list.map((a) => ({ value: a.id, label: label(a) })));
    if (cur && !list.some((a) => a.id === cur.id)) opts.push({ value: cur.id, label: `${cur.name} (gerade nicht verfügbar)` });
    return {
      type: 'select', label: 'Tonausgabe im Konsolenmodus', options: opts,
      desc: list.length ? 'Wird beim Start umgestellt – auch wenn der Fernseher erst eingeschaltet wird' : 'Keine Wiedergabegeräte gefunden (nur unter Windows)',
      get: () => (C().display.audioDevice ? C().display.audioDevice.id : ''),
      set: (v) => {
        if (!v) { C().display.audioDevice = null; return; }
        const a = list.find((x) => x.id === v);
        if (a) C().display.audioDevice = { id: a.id, name: a.name, desc: a.desc };
      }
    };
  }

  /** Auswahl des Fernsehers; ein gespeicherter, gerade nicht aktiver TV bleibt sichtbar */
  function tvSelect() {
    const tv = C().display.tv;
    const opts = [{ value: '', label: 'Nicht festgelegt' }].concat(S.displays.map((d) => ({ value: d.key, label: displayLabel(d) })));
    if (tv && !S.displays.some((d) => d.key === tv.key)) opts.push({ value: tv.key, label: `${tv.name} (gerade nicht aktiv)` });
    return {
      type: 'select', label: 'Mein Fernseher', options: opts,
      desc: 'Wird für „Nur Fernseher“ und die Anzeige der Oberfläche verwendet',
      get: () => (C().display.tv ? C().display.tv.key : ''),
      set: (v) => {
        if (!v) { C().display.tv = null; return; }
        const d = S.displays.find((x) => x.key === v);
        C().display.tv = d ? { key: d.key, name: d.name } : C().display.tv;
        C().general.targetDisplay = 'tv';
        if (C().display.onStart === 'external') C().display.onStart = 'tvOnly';
      }
    };
  }

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
  /** Kompakte Listenzeile, die eine Detailseite öffnet. status: 'ok' | 'bad' | 'off' | '' */
  const item = (label, desc, opts = {}) => ({ type: 'item', label, desc, ...opts });

  /**
   * Detailseite öffnen. builder() liefert { title, rows } oder null (Eintrag existiert nicht mehr).
   * ○ / Esc führt zurück zur Übersicht.
   */
  function openDetail(builder) {
    // Verschachtelt möglich (z.B. Konsole → Emulator pro Spiel): Zurück führt zur vorherigen Detailseite
    S.detail = { builder, returnFocus: S.focus, parent: S.detail || null };
    S.focus = 1; // erstes Feld (0 = „Zurück zur Übersicht“)
    Sounds.play('open');
    render();
  }
  function closeDetail() {
    if (!S.detail) return false;
    // Für „Vor“ (Maus-Seitentaste): diese Detailseite wieder öffnen können
    const reopen = { builder: S.detail.builder, section: S.section };
    App.pushForward(() => { if (App.view !== 'settings') App.openSettings(SECTIONS[reopen.section].id); S.section = reopen.section; openDetail(reopen.builder); });
    S.focus = S.detail.returnFocus || 0;
    S.detail = S.detail.parent || null;
    render();
    return true;
  }
  const button = (label, action, opts = {}) => ({ type: 'button', label, action, ...opts });

  const SECTIONS = [
    {
      id: 'general', title: 'Allgemein', rows: () => [
        group('Start'),
        toggle('Mit Windows starten', () => C().general, 'autostartWithWindows', 'Konsolenmodus startet automatisch nach der Anmeldung'),
        ...(App.setupMode ? [
          { type: 'info', label: 'Läuft im Einrichtungsmodus', desc: 'Fernseher, Home Assistant, Bildschirm- und Tonumschaltung sowie der Leistungsmodus bleiben aus. Änderungen werden ganz normal gespeichert.', get: () => '' },
          button('Jetzt in den Konsolenmodus wechseln', async () => {
            if (await App.confirm('Konsolenmodus starten?', 'AleGamestation startet neu – mit Fernseher, Bildschirm- und Tonumschaltung.', 'Starten')) api.startConsoleMode();
          })
        ] : []),
        button('Verknüpfung „Einrichten (ohne Fernseher)“ auf dem Desktop', async () => {
          try { const f = await api.createSetupShortcut(); App.toast(`Verknüpfung erstellt: ${f.split(/[\\/]/).pop().replace(/\.lnk$/, '')}`, 'ok', 6000); } catch (e) { App.toast(cleanErr(e), 'error', 6000); }
        }, { desc: 'Öffnet AleGamestation nur zum Einstellen: im Fenster auf dem PC-Monitor, ohne Fernseher, Bildschirm-/Tonumschaltung und Leistungsmodus – mit Debug-Protokoll' }),
        toggle('Vollbild', () => C().general, 'startFullscreen'),
        select('Oberfläche anzeigen auf', () => C().general, 'targetDisplay', [{ value: 'primary', label: 'Hauptbildschirm' }, { value: 'tv', label: 'Fernseher (Einstellungen → Anzeige)' }].concat(S.displays.filter((d) => d.electronId != null && d.active !== false).map((d) => ({ value: 'id:' + d.electronId, label: displayLabel(d) }))), 'Bei „Nur Fernseher“ ist der TV automatisch der Hauptbildschirm'),
        group('Beim Spielen'),
        toggle('Oberfläche minimieren, während ein Spiel läuft', () => C().general, 'minimizeOnLaunch'),
        toggle('Nach Spielende zurück in die Oberfläche', () => C().general, 'refocusAfterGame'),
        group('Darstellung'),
        toggle('Konsolen als Foto zeigen', () => C().general, 'consolePhotos', 'Echte Konsolenfotos auf den Kacheln (sonst Umriss-Zeichnungen). Eigene Bilder: Einstellungen → Systeme & ROMs → Konsole → Logo', { get: () => C().general.consolePhotos !== false, rescan: true }),
        select('Farbthema', () => C().general, 'theme', [
          { value: 'midnight', label: 'Mitternacht' }, { value: 'aurora', label: 'Polarlicht' }, { value: 'ocean', label: 'Ozean' },
          { value: 'sunset', label: 'Sonnenuntergang' }, { value: 'synthwave', label: 'Synthwave' }, { value: 'graphite', label: 'Graphit' }
        ], 'Hintergrund und Lichtstimmung der Oberfläche', { get: () => C().general.theme || 'midnight' }),
        select('Akzentfarbe', () => C().general, 'accentColor', [
          { value: '#7c5cff', label: 'Violett' }, { value: '#22d3ee', label: 'Cyan' }, { value: '#3ddc84', label: 'Grün' },
          { value: '#ff4d6d', label: 'Rot' }, { value: '#ff9f1c', label: 'Orange' }, { value: '#3b82f6', label: 'Blau' }, { value: '#e5e5e5', label: 'Weiß' }
        ]),
        select('Größe der Oberfläche', () => C().general, 'uiScale', [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' })), 'Größer für weit entfernte Fernseher'),
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
        toggle('Boot-Animation', () => C().general, 'bootAnimation', 'Kurzes Logo-Intro beim Start'),
        toggle('Spielstart-Animation', () => C().general, 'launchAnimation', 'Cover zoomt heran, bevor das Spiel startet'),
        toggle('Uhr anzeigen', () => C().general, 'showClock'),
        toggle('Mauszeiger ausblenden', () => C().general, 'hideCursor'),
        toggle('Rechtsklick = Zurück', () => C().general, 'rightClickBack', 'Maus: Rechtsklick und die Seitentasten gehen zurück/vor, Mausrad scrollt', { get: () => C().general.rightClickBack !== false }),
        toggle('Herunterfahren usw. bestätigen', () => C().general, 'confirmPowerActions'),
        group('Konfiguration'),
        button('Konfigurationsdatei (JSON) öffnen', () => api.openConfigFile(), { desc: 'Für fortgeschrittene Einstellungen' })
      ]
    },
    {
      id: 'display', title: 'Anzeige', rows: () => [
        group('Fernseher', 'Welcher Bildschirm ist dein TV? „Identifizieren“ zeigt auf jedem Bildschirm eine Nummer'),
        tvSelect(),
        ...tvStatusRows(),
        button('Bildschirme identifizieren', async () => { await api.identifyDisplays(); }, { desc: 'Zeigt 4 Sekunden lang Nummer und Name auf jedem Bildschirm' }),
        button('↻ Bildschirmliste aktualisieren', async () => { S.displays = await api.listDisplays().catch(() => []); render(); App.toast(`${S.displays.length} Bildschirm(e) gefunden`, 'info'); }),
        button('Jetzt nur den Fernseher verwenden', async () => {
          App.toast('Schalte auf den Fernseher um …', 'info', 2500);
          const r = await api.tvOnly().catch((e) => ({ ok: false, error: String(e.message || e) }));
          App.toast(r && r.ok ? 'Nur noch der Fernseher ist aktiv' : (r && r.error) || 'Umschalten fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
        }),
        button('Jetzt Fernseher als Hauptbildschirm (Monitore bleiben an)', async () => {
          const r = await api.tvOnly('primary').catch((e) => ({ ok: false, error: String(e.message || e) }));
          App.toast(r && r.ok ? 'Fernseher ist jetzt der Hauptbildschirm – Spiele starten dort' : (r && r.error) || 'Umschalten fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
        }),
        button('Alle Bildschirme wieder einschalten', async () => { await api.restoreDisplays(); App.toast('Bildschirme wiederhergestellt', 'ok'); }),
        group('Ton', 'Auf welches Gerät der Ton im Konsolenmodus wechselt'),
        audioSelect(),
        toggle('Beim Beenden zurückstellen', () => C().display, 'restoreAudio', 'Danach wieder das vorherige Gerät (z.B. Kopfhörer am PC)', { get: () => C().display.restoreAudio !== false }),
        button('Jetzt auf dieses Gerät umstellen', async () => {
          const r = await api.applyAudio().catch((e) => ({ ok: false, error: String(e.message || e) }));
          App.toast(r && r.ok ? `Ton kommt jetzt aus: ${r.name}` : (r && r.error) || 'Umstellen fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
          S.audio = await api.listAudio().catch(() => []); render();
        }),
                group('Bildschirm umschalten (wie Win + P)'),
        select('Beim Start des Konsolenmodus', () => C().display, 'onStart', DISPLAY_OPTS, '„Nur Fernseher“ schaltet die Monitore ab, „als Hauptbildschirm“ lässt sie an – Spiele starten auf dem Hauptbildschirm'),
        select('Beim Beenden (zurück zum Desktop)', () => C().display, 'onExit', DISPLAY_OPTS.filter((o) => !['tvOnly', 'tvPrimary'].includes(o.value))),
        toggle('Vor Herunterfahren/Neustart wiederherstellen', () => C().display, 'restoreBeforeShutdown', 'Damit Windows beim nächsten Start wieder auf dem Monitor erscheint'),
        select('Wartezeit nach dem Umschalten', () => C().display, 'switchDelayMs', [1000, 1500, 2500, 4000, 6000].map((v) => ({ value: v, label: v / 1000 + ' s' }))),
        group('Eigene Befehle', 'z.B. Programme oder Skripte beim Start ausführen'),
        listText('Befehle beim Start', () => C().display, 'customCommandsOnStart', 'Mehrere mit ; trennen. Beispiel: nircmd setdefaultsounddevice "TV"'),
        listText('Befehle beim Beenden', () => C().display, 'customCommandsOnExit'),
        group('Jetzt testen'),
        ...DISPLAY_OPTS.filter((o) => !['none', 'tvOnly', 'tvPrimary'].includes(o.value)).map((o) => button('Test: ' + o.label, () => api.setDisplayMode(o.value)))
      ]
    },
    {
      id: 'controller', title: 'Controller', rows: () => [
        group('Spiel beenden'),
        select('Tastenkombination „Spiel beenden“', () => C().controller, 'closeGameCombo', comboOptions(C().controller.closeGameCombo), 'Funktioniert auch, während das Spiel im Vordergrund ist'),
        button('Kombination „Spiel beenden“ aufnehmen …', () => recordCombo('closeGameCombo')),
        toggle('Konsolen-Overlay (PS-/Xbox-Taste gedrückt halten)', () => C().controller, 'overlayEnabled', 'Erscheint über dem Spiel: beenden, Spiel wechseln, Musik auswählen, Lautstärke'),
        select('Overlay-Modus', () => C().controller, 'overlayMode', [
          { value: 'pause', label: 'Spiel anhalten (keine Eingaben)' },
          { value: 'over', label: 'Nur darüberlegen – Spiel läuft weiter' },
          { value: 'focus', label: 'Fokus holen' }
        ], '„Anhalten“: Das Spiel friert ein, solange das Overlay offen ist – bleibt im Vollbild und reagiert nicht auf den Controller. Für Online-Spiele „Nur darüberlegen“ wählen', { get: () => C().controller.overlayMode || 'pause' }),
        toggle('Schnellmenü hält das Spiel auch an', () => C().controller, 'quickMenuPause', 'PS-/Xbox-Taste kurz drücken', { get: () => C().controller.quickMenuPause !== false }),
        select('Gedrückt halten für', () => C().controller, 'overlayHoldMs', [400, 600, 800, 1000].map((v) => ({ value: v, label: (v / 1000).toString().replace('.', ',') + ' s' })), 'Bis das Overlay erscheint'),
        select('PS- / Xbox-Taste kurz drücken (im Spiel)', () => C().controller, 'guideButton', [
          { value: 'quickMenu', label: 'Schnellmenü (Beenden mit Rückfrage)' },
          { value: 'off', label: 'Nichts tun' }
        ], 'Blendet über dem Spiel ein: ✕ Beenden · △ Zur Oberfläche · ○ Weiterspielen'),
        select('Tastenkombination „Oberfläche zeigen“', () => C().controller, 'showLauncherCombo', comboOptions(C().controller.showLauncherCombo), 'Holt AleGamestation in den Vordergrund, ohne das Spiel zu beenden'),
        button('Kombination „Oberfläche zeigen“ aufnehmen …', () => recordCombo('showLauncherCombo')),
        select('Gedrückt halten für', () => C().controller, 'comboHoldMs', [0, 300, 500, 800, 1200, 2000].map((v) => ({ value: v, label: v ? v / 1000 + ' s' : 'sofort' }))),
        select('Spiel erst sanft schließen', () => C().controller, 'gracefulCloseMs', [0, 800, 1500, 3000].map((v) => ({ value: v, label: v ? `ja, ${v / 1000} s warten` : 'nein, sofort beenden' })), 'Gibt Emulatoren Zeit zum Speichern'),
        group('Controller-Typ', `Erkannt: ${Glyphs.detected().label}${Glyphs.detected().name ? ' – ' + Glyphs.detected().name : ''}`),
        (() => {
          const d = Input.debug();
          const lines = [
            d.hid ? `PlayStation direkt (HID): ${d.hid} verbunden${d.lastHid !== null ? ` · letzte Eingabe vor ${d.lastHid} s` : ' · noch keine Eingabe'}` : 'PlayStation direkt (HID): keiner',
            `Windows/Chromium: ${d.pads.length ? d.pads.join(', ') : 'keiner'}`
          ];
          return { type: 'button', label: 'Controller-Diagnose (aktualisieren)', desc: lines.join(' · '), action: () => { render(); App.toast(`Gedrückt: ${Input.debug().pressed.join(' + ') || 'nichts'}`, 'info', 1500); } };
        })(),
        select('Tastensymbole', () => C().controller, 'glyphStyle', [
          { value: 'auto', label: 'Automatisch erkennen' }, { value: 'playstation', label: 'PlayStation  ✕ ○ □ △' },
          { value: 'xbox', label: 'Xbox  A B X Y' }, { value: 'nintendo', label: 'Nintendo' }
        ], 'Welche Symbole in der Oberfläche angezeigt werden'),
        toggle('PlayStation-Controller direkt unterstützen', () => C().controller, 'playstationHid', 'DualSense / DualShock 4 per USB oder Bluetooth – Beenden-Kombination funktioniert ohne Steam Input oder DS4Windows'),
        group('Maus & Tastatur per Controller', 'z.B. für Launcher-Fenster, Logins, Browser'),
        select('Tastenkombination „Maussteuerung“', () => C().controller, 'mouseModeCombo', comboOptions(C().controller.mouseModeCombo), 'Ein-/Ausschalten – funktioniert überall in Windows'),
        button('Kombination „Maussteuerung“ aufnehmen …', () => recordCombo('mouseModeCombo')),
        select('Mausgeschwindigkeit', () => C().controller, 'mouseSpeed', [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' }))),
        button('🖱 Maussteuerung jetzt einschalten', () => api.toggleMouseMode()),
        { type: 'info', label: 'Belegung', desc: `Linker Stick: Maus · Rechter Stick: Scrollen · ${Glyphs.label('A')}: Linksklick · ${Glyphs.label('B')}: Rechtsklick · ${Glyphs.label('X')}: Bildschirmtastatur · ${Glyphs.label('Y')}: Enter · Steuerkreuz: Pfeiltasten · ${Glyphs.label('LB')}: Alt+Tab · ${Glyphs.label('RB')}: Tab · ${Glyphs.label('LT')}: Rücktaste · ${Glyphs.label('RT')} halten: langsame Maus · ${Glyphs.label('START')}: Esc · ${Glyphs.label('LS')}: Mittelklick`, get: () => '' },
        group('Touchpad als Maus', 'DualSense / DualShock 4'),
        select('Touchpad als Maus verwenden', () => C().controller, 'touchpadMouse', [
          { value: 'outsideGames', label: 'Immer außerhalb von Spielen' },
          { value: 'mouseMode', label: 'Nur in der Maussteuerung' },
          { value: 'off', label: 'Aus' }
        ], 'Während ein Spiel läuft, gehört das Touchpad dem Spiel'),
        select('Touchpad-Geschwindigkeit', () => C().controller, 'touchpadSpeed', [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' }))),
        toggle('Antippen = Klick', () => C().controller, 'touchpadTap', '1 Finger = Linksklick, 2 Finger = Rechtsklick'),
        { type: 'info', label: 'Bedienung', desc: '1 Finger: Maus bewegen · Touchpad drücken: Linksklick (gedrückt halten = ziehen) · mit 2 Fingern drücken: Rechtsklick · 2 Finger bewegen: scrollen', get: () => '' },
        group('Navigation'),
        toggle('Analog-Stick zur Navigation', () => C().controller, 'useAnalogStick'),
        toggle('A/B tauschen (Nintendo-Layout)', () => C().controller, 'swapAB')
      ]
    },
    {
      id: 'emulators', title: 'Emulatoren', rows: () => {
        const list = C().emulators;
        const rows = [
          button('＋ Konsole mit Emulator einrichten …', () => App.addSystemWizard(), { desc: 'Assistent: Konsole → Emulator → ROM-Ordner' }),
          button('＋ Nur Emulator hinzufügen …', async () => {
            const exe = await api.pickFile({ filters: [{ name: 'Programme', extensions: ['exe'] }] });
            if (!exe) return;
            const id = App.newEmulator(exe);
            await commit(true);
            openEmulator(id);
          }),
          button('🔍 Installierte Emulatoren automatisch suchen', async () => {
            const r = await api.detectEmulators();
            App.cfg = r.config;
            App.library = r.library;
            App.toast(r.changes.length ? `Gefunden: ${r.changes.map((c) => c.name).join(', ')}` : 'Keine neuen Emulatoren gefunden', r.changes.length ? 'ok' : 'info', 5000);
            render();
          }),
          toggle('Spiele im Vollbild starten', () => C().general, 'emulatorFullscreen', 'Ergänzt bei bekannten Emulatoren automatisch das Vollbild-Argument (z.B. Switch: Eden/Ryujinx, Dolphin, PCSX2, RetroArch …)', { get: () => C().general.emulatorFullscreen !== false }),
          group('Deine Emulatoren', `${list.length}`)
        ];
        for (const e of list) {
          const found = ((App.library.emulators || []).find((x) => x.id === e.id) || {}).found;
          const used = C().systems.filter((s) => s.emulator === e.id).map((s) => s.short || s.name);
          rows.push(item(e.name, `${used.length ? 'für ' + used.join(', ') : 'keiner Konsole zugeordnet'} · ${e.exe ? e.exe.split(/[\\/]/).pop() : 'kein Programm gewählt'}`,
            { status: found ? 'ok' : 'bad', statusText: found ? 'bereit' : 'fehlt', action: () => openEmulator(e.id) }));
        }
        return rows;
      }
    },
    {
      id: 'systems', title: 'Systeme & ROMs', rows: () => {
        const list = C().systems;
        const rows = [
          button('＋ Konsole hinzufügen …', () => App.addSystemWizard(), { desc: 'Assistent: Konsole → Emulator → ROM-Ordner' }),
          group('Deine Konsolen', `${list.filter((s) => s.enabled !== false).length} von ${list.length} aktiv`)
        ];
        for (const s of list) {
          const lib = App.library.systems.find((x) => x.id === s.id) || { count: 0 };
          const emu = C().emulators.find((e) => e.id === s.emulator);
          const found = ((App.library.emulators || []).find((x) => x.id === s.emulator) || {}).found;
          const dirs = (s.romDirs || []).length;
          const off = s.enabled === false;
          rows.push(item(s.name, `${emu ? emu.name : 'kein Emulator'} · ${dirs ? dirs + (dirs === 1 ? ' Ordner' : ' Ordner') : 'kein ROM-Ordner'} · ${(s.extensions || []).join(' ')}`, {
            status: off ? 'off' : found ? 'ok' : 'bad',
            statusText: off ? 'aus' : found ? `${lib.count} Spiele` : 'Emulator fehlt',
            action: () => openSystem(s.id)
          }));
        }
        // Emulator-Tab: ausgeblendete Konsolen/Emulatoren wieder einblenden
        const tab = C().emulatorTab || { order: [], hidden: [] };
        const hidden = (tab.hidden || []).map((id) => App.library.systems.find((x) => x.id === id)).filter(Boolean);
        rows.push(group('Emulator-Tab', 'Reihenfolge: Konsole auswählen → △ → „Position verschieben“'));
        if (!hidden.length) rows.push({ type: 'info', label: 'Keine Konsolen ausgeblendet', desc: 'Ausblenden: im Emulator-Tab Konsole auswählen → △ → „Im Emulator-Tab ausblenden“', get: () => '' });
        for (const h of hidden) {
          rows.push(button(`Wieder einblenden: ${h.name}`, async () => {
            tab.hidden = (tab.hidden || []).filter((id) => id !== h.id);
            C().emulatorTab = tab;
            await commit(false);
            App.toast(`${h.short || h.name} wird wieder angezeigt`, 'ok');
          }));
        }
        if ((tab.order || []).length) rows.push(button('Reihenfolge zurücksetzen', async () => { tab.order = []; C().emulatorTab = tab; await commit(false); }));
        return rows;
      }
    },
    {
      id: 'games', title: 'Eigene Spiele', rows: () => {
        const list = C().pcGames;
        const rows = [
          button('＋ Spiel / Programm hinzufügen …', async () => {
            const exe = await api.pickFile();
            if (!exe) return;
            const id = 'pc-' + Date.now();
            C().pcGames.push({ id, name: exe.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, ''), exe, args: '', cwd: '', cover: '', killMode: 'dir', processName: '' });
            await commit(true);
            api.scrape({ ids: [id] }).catch(() => {}); // Cover gleich im Hintergrund laden
            openGame(id);
          }, { desc: '.exe, Verknüpfung (.lnk), .url oder .bat – z.B. Epic-/GOG-Spiele, Kodi, Programme' }),
          group('Deine Spiele & Programme', `${list.length}`)
        ];
        for (const g of list) {
          rows.push(item(g.name || 'Spiel', `${g.exe ? g.exe.split(/[\\/]/).pop() : 'kein Programm'} · Beenden: ${(KILL_OPTS.find((k) => k.value === (g.killMode || 'dir')) || KILL_OPTS[0]).short}`,
            { status: g.cover ? 'ok' : '', statusText: g.cover ? 'mit Cover' : '', action: () => openGame(g.id) }));
        }
        return rows;
      }
    },
    {
      id: 'ha', title: 'Home Assistant', rows: () => {
        const H = () => C().homeassistant;
        const players = (S.ha && S.ha.players) || [];
        const cur = players.find((p) => p.id === H().tvEntity);
        const keep = (list, v, label) => (v && !list.some((o) => o.value === v) ? [{ value: v, label: label || v }, ...list] : list);
        const playerOpts = keep([{ value: '', label: '– bitte wählen –' }, ...players.map((p) => ({ value: p.id, label: `${p.name} (${p.state})` }))], H().tvEntity);
        const sourceOpts = keep([{ value: '', label: 'Nicht umschalten' }, ...((cur && cur.sources) || []).map((s) => ({ value: s, label: s }))], H().source);
        const devices = [...players.map((p) => ({ value: p.id, label: `${p.name} (${p.state})` })), ...((S.ha && S.ha.scripts) || []).map((x) => ({ value: x.id, label: `${x.name} (${x.id.split('.')[0]})` }))];
        const viaOpts = keep([{ value: '', label: 'den Fernseher selbst' }, ...devices], H().powerOnEntity);
        const offOpts = keep([{ value: '', label: 'den Fernseher selbst' }, ...devices], H().powerOffEntity);
        const exitOpts = keep([{ value: '', label: 'Nicht umschalten' }, ...((cur && cur.sources) || []).map((s) => ({ value: s, label: s }))], H().sourceAtExit);
        return [
          group('Verbindung', S.ha ? (S.ha.error ? 'Fehler: ' + S.ha.error : `verbunden · ${players.length} Geräte`) : 'Fernseher automatisch einschalten'),
          toggle('Home Assistant verwenden', H, 'enabled'),
          text('Adresse', H, 'url', 'z.B. http://homeassistant.local:8123 oder http://192.168.1.10:8123'),
          text('Zugangstoken', H, 'token', 'Home Assistant → Profil → Sicherheit → „Langlebiges Zugangstoken“ erstellen', { secret: true }),
          button('🔌 Verbindung testen & Geräte laden', haLoad),
          group('Fernseher'),
          select('Fernseher', H, 'tvEntity', playerOpts, players.length ? 'Mediaplayer aus Home Assistant' : 'Erst „Verbindung testen“ drücken'),
          select('HDMI-Eingang', H, 'source', sourceOpts, 'Auf diesen Eingang wird beim Start automatisch umgeschaltet'),
          toggle('Beim Start einschalten', H, 'turnOnAtStart'),
          select('Einschalten über', H, 'powerOnEntity', viaOpts, 'Z.B. Chromecast, wenn Home Assistant den TV im ausgeschalteten Zustand nicht findet: weckt ihn per HDMI-CEC. Danach wird der HDMI-Eingang oben am Fernseher gewählt', { get: () => H().powerOnEntity || '' }),
          select('Warten bis der Fernseher an ist', H, 'waitForTvSeconds', [5, 10, 15, 20, 30, 45, 60, 90].map((v) => ({ value: v, label: `bis zu ${v} s` }))),
          select('Eingang wählen nach', H, 'sourceDelaySeconds', [0, 2, 3, 5, 8, 12].map((v) => ({ value: v, label: v ? `${v} s Wartezeit` : 'sofort' })), 'Mehr Zeit, falls der Chromecast den TV erst auf seinen eigenen Eingang schaltet', { get: () => H().sourceDelaySeconds ?? 3 }),
          { ...toggle('Beim Beenden fragen: ausschalten oder anlassen?', H, 'askTvOffAtExit', 'Beim Zurückkehren zum Desktop und beim Schließen des Fensters'), get: () => H().askTvOffAtExit !== false },
          toggle('Beim Zurückkehren zum Desktop ausschalten', H, 'turnOffAtExit', 'Gilt, wenn nicht gefragt wird'),
          select('…oder auf diesen Eingang schalten', H, 'sourceAtExit', exitOpts, 'Wenn der Fernseher anbleiben soll'),
          toggle('Beim Herunterfahren ausschalten', H, 'turnOffAtShutdown'),
          select('Ausschalten über', H, 'powerOffEntity', offOpts, 'Falls der Fernseher sich über Home Assistant nicht direkt ausschalten lässt', { get: () => H().powerOffEntity || '' }),
          button('📺 Fernseher jetzt einschalten + Eingang wählen', async () => { App.toast('Schalte Fernseher ein …'); try { const r = await api.haTv(true); App.toast(`Fernseher ${r && r.on ? 'an' : 'angesteuert'}${r && r.source ? ' · ' + r.source : ''}`, 'ok'); } catch (e) { App.toast(cleanErr(e), 'error', 6000); } }),
          button('Fernseher jetzt ausschalten', async () => { try { await api.haTv(false); App.toast('Fernseher aus', 'ok'); } catch (e) { App.toast(cleanErr(e), 'error', 6000); } }),
          group('Weitere Aktionen', 'Szenen, Skripte, Licht …'),
          listText('Beim Start ausführen', H, 'startServices', 'z.B. scene.gaming ; script.licht_dimmen ; light.turn_off:light.decke'),
          listText('Beim Beenden ausführen', H, 'exitServices')
        ];
      }
    },
    {
      id: 'aleclip', title: 'Clips', rows: () => {
        if (!C().aleclip) C().aleclip = { enabled: true, exe: '', autoStart: true, clipLengths: [15, 30, 60, 120, 300] };
        const A = () => C().aleclip;
        const st = S.aleclip || {};
        const fmtT = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
        const state = st.disabled ? 'aus' : st.offline ? (st.installed || st.exe ? 'installiert, läuft nicht' : 'nicht gefunden')
          : st.ok ? `verbunden · v${st.version || ''} · Instant Replay ${st.replay ? `an (${fmtT(st.replaySeconds || 0)})` : 'aus'}` : '';
        return [
          group('AleClip', state),
          { type: 'info', label: 'Clips wie bei der PlayStation', desc: 'Im Overlay (PS halten) die letzten Sekunden/Minuten als Clip speichern, Screenshot machen oder eine Aufnahme starten. Der Clip endet beim Öffnen des Overlays – das Menü ist nicht zu sehen. Die maximale Länge stellst du in AleClip ein (Instant Replay → Puffer-Länge).', get: () => '' },
          toggle('Clips im Overlay anzeigen', A, 'enabled', '', { get: () => A().enabled !== false }),
          pathRow('AleClip.exe', A, 'exe', 'file', st.exe && !A().exe ? `Automatisch gefunden: ${st.exe}` : 'Leer lassen = automatisch suchen'),
          toggle('AleClip beim Start mitstarten', A, 'autoStart', 'Startet AleClip minimiert im Hintergrund, falls es noch nicht läuft', { get: () => A().autoStart !== false }),
          listText('Clip-Längen im Overlay (Sekunden)', A, 'clipLengths', 'z.B. 15 ; 30 ; 60 ; 120 ; 300 – längere als der Puffer in AleClip werden ausgeblendet', {
            get: () => (A().clipLengths || []).join(' ; '),
            set: (v) => { A().clipLengths = v.split(';').map((x) => parseInt(x, 10)).filter((x) => x >= 5).slice(0, 8); }
          }),
          button('Verbindung prüfen', async () => {
            S.aleclip = await api.aleclipStatus().catch(() => ({}));
            render();
            App.toast(S.aleclip.ok ? `AleClip verbunden – Instant Replay ${S.aleclip.replay ? 'an' : 'aus'}` : S.aleclip.offline ? 'AleClip läuft nicht' : 'AleClip nicht erreichbar', S.aleclip.ok ? 'ok' : 'error', 5000);
          }),
          ...(st.offline && (st.installed || st.exe) ? [button('AleClip jetzt starten', async () => {
            App.toast('Starte AleClip …', 'info', 2500);
            try { await api.aleclipStart(); App.toast('AleClip läuft', 'ok'); } catch (e) { App.toast(cleanErr(e), 'error', 6000); }
            S.aleclip = await api.aleclipStatus().catch(() => ({})); render();
          })] : [])
        ];
      }
    },
    {
      id: 'spotify', title: 'Spotify', rows: () => {
        const st = S.spotify || {};
        if (!C().spotify) C().spotify = { clientId: '' };
        const has = !!String(C().spotify.clientId || '').trim();
        return [
          group('Verbindung', st.connected ? `verbunden als ${st.user || 'Spotify-Konto'}${st.product && st.product !== 'premium' ? ' · kein Premium' : ''}` : 'Musik im Overlay auswählen'),
          { type: 'button', label: 'So geht’s (einmalig, ca. 2 Minuten)', desc: `1. „Spotify-Entwicklerseite öffnen“ → mit deinem Spotify-Konto anmelden → „Create app“. 2. Redirect URI genau so eintragen: ${(st.redirect || 'http://127.0.0.1:43821/callback')} und „Web API“ anhaken. 3. Die „Client ID“ der App unten eintragen und „Mit Spotify verbinden“ wählen. Abspielen/Überspringen per App braucht Spotify Premium.`, action: () => {} },
          button('Spotify-Entwicklerseite öffnen', () => api.spotifyDashboard()),
          text('Client ID', () => C().spotify, 'clientId', 'Aus deiner Spotify-App (developer.spotify.com)'),
          ...(has ? [button(st.connected ? 'Neu verbinden' : 'Mit Spotify verbinden', async () => {
            App.toast('Browser öffnet sich – bei Spotify anmelden und zustimmen …', 'info', 6000);
            try {
              const r = await api.spotifyConnect();
              App.toast(`✔ Verbunden als ${r.user}${r.product !== 'premium' ? ' – Hinweis: Steuern geht nur mit Premium' : ''}`, 'ok', 6000);
            } catch (e) { App.toast(cleanErr(e), 'error', 8000); }
            S.spotify = await api.spotifyStatus().catch(() => ({})); render();
          })] : []),
          ...(st.connected ? [
            button('Verbindung testen', async () => {
              try { const n = await api.spotifyTest(); App.toast(n.title ? `▶ ${n.title} – ${n.artist}${n.device ? ' · ' + n.device : ''}` : 'Verbunden – gerade läuft nichts', 'ok', 5000); } catch (e) { App.toast(cleanErr(e), 'error', 7000); }
            }),
            button('Verbindung trennen', async () => { await api.spotifyDisconnect(); S.spotify = await api.spotifyStatus(); render(); }, { danger: true })
          ] : []),
          group('Ohne Verbindung', 'funktioniert immer'),
          { type: 'button', label: 'Medientasten', desc: 'Auch ohne Verbindung steuert das Overlay Spotify per Medientasten (Abspielen/Pause, Weiter, Zurück) – nur die Playlist-Auswahl braucht die Verbindung', action: () => {} }
        ];
      }
    },
    {
      id: 'media', title: 'Cover', rows: () => {
        const SC = () => C().scraper;
        const SS = () => C().scraper.screenscraper;
        const roms = App.library.games.filter((g) => ['rom', 'steam', 'epic', 'pc'].includes(g.type));
        const withCover = roms.filter((g) => g.cover).length;
        const ssReady = ['user', 'password', 'devid', 'devpassword'].every((k) => SS()[k]);
        return [
          group('Cover herunterladen', `${withCover} von ${roms.length} Spielen haben ein Cover`),
          button('⬇ Fehlende Cover jetzt herunterladen', () => App.scrape({})),
          button('⬇ Alle Cover neu herunterladen', async () => {
            if (await App.confirm('Alle Cover neu laden?', 'Vorhandene heruntergeladene Bilder werden ersetzt. Eigene Cover (über „Cover-Bild ändern“) bleiben erhalten.', 'Neu laden')) App.scrape({ force: true });
          }),
          button('✕ Laufenden Download abbrechen', () => api.cancelScrape()),
          select('Quelle', SC, 'source', [
            { value: 'auto', label: 'Automatisch (ScreenScraper, sonst libretro)' },
            { value: 'libretro', label: 'Nur libretro (ohne Konto)' },
            { value: 'screenscraper', label: 'Nur ScreenScraper' }
          ], ssReady ? 'ScreenScraper-Zugang eingetragen' : 'Für ROMs: libretro funktioniert sofort – am besten mit ROMs im No-Intro/Redump-Namensformat'),
          toggle('Screenshots / Fanart als Hintergrund laden', SC, 'downloadSnaps', 'Wird hinter dem ausgewählten Spiel angezeigt'),
          toggle('Neue Spiele automatisch', SC, 'autoScrape', 'Beim Start fehlende Cover im Hintergrund laden'),
          pathRow('Speicherort', SC, 'mediaDir', 'folder', 'Leer = im AleGamestation-Datenordner', { rescan: true }),
          group('PC-Spiele (Steam, Epic, GOG, eigene)', 'Steam-Bilder ohne Konto, andere Spiele über die Steam-Suche'),
          text('SteamGridDB-API-Schlüssel (optional)', SC, 'steamgriddbKey', 'Kostenlos auf steamgriddb.com → Profil → Einstellungen → API. Findet Bilder für fast jedes PC-Spiel, auch ohne Steam-Version', { secret: true }),
          group('ScreenScraper.fr (ROMs)', 'optional – größte Datenbank, erkennt ROMs auch per Prüfsumme'),
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
          group('Leistungsmodus', 'beim Start des Konsolenmodus'),
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
        rows.push(group('Programme', `${programs.filter((p) => p.enabled !== false).length} von ${programs.length} aktiv`));
        programs.forEach((p, i) => {
          const act = ACTIONS.find((a) => a.value === p.action) || ACTIONS[0];
          rows.push(item(p.name, `${act.label}${p.restore !== false ? ', danach wiederherstellen' : ''} · ${p.process}`, {
            status: p.enabled === false ? 'off' : 'ok', statusText: p.enabled === false ? 'aus' : 'aktiv',
            action: () => openDetail(() => {
              const idx = P().programs.indexOf(p);
              if (idx < 0) return null;
              const o = () => P().programs[idx];
              return {
                title: p.name,
                rows: [
                  toggle('Aktiv', o, 'enabled'),
                  select('Aktion', o, 'action', ACTIONS, p.pauseArgs ? 'Wird über die programmeigene Pause-Funktion pausiert' : 'Pausieren: Programm bleibt offen, verbraucht aber keine CPU mehr'),
                  toggle('Beim Verlassen wiederherstellen', o, 'restore', 'Fortsetzen bzw. wieder starten'),
                  text('Prozessname(n)', o, 'process', 'z.B. wallpaper64.exe – mehrere mit ; trennen'),
                  button('Entfernen', async () => { P().programs.splice(idx, 1); await commit(false); closeDetail(); }, { danger: true })
                ]
              };
            })
          }));
        });
        return rows;
      }
    },
    {
      id: 'stores', title: 'Steam & Stores', rows: () => {
        const hidden = App.library.games.filter((g) => g.hidden && g.hiddenBy === 'manual');
        return [
          group('Steam', App.library.steamFound ? 'Steam gefunden' : 'Steam nicht gefunden'),
          toggle('Steam-Spiele anzeigen', () => C().steam, 'enabled', 'Installierte Spiele werden automatisch erkannt', { rescan: true }),
          pathRow('Steam-Ordner', () => C().steam, 'path', 'folder', 'Leer lassen = automatisch suchen', { rescan: true }),
          toggle('Kachel „Steam Big Picture öffnen“', () => C().steam, 'showBigPictureTile', '', { rescan: true }),
          group('Weitere Stores'),
          toggle('Epic Games Launcher', () => C().stores, 'epic', 'Installierte Epic-Spiele automatisch erkennen', { rescan: true }),
          toggle('GOG', () => C().stores, 'gog', 'Installierte GOG-Spiele automatisch erkennen', { rescan: true }),
          group('Bibliothek', `${App.library.games.length} Spiele`),
          button('↻ Bibliothek jetzt neu einlesen', async () => { await App.refreshLibrary(); App.toast(`${App.library.games.length} Spiele gefunden`, 'ok'); render(); }),
          ...(hidden.length ? [group('Ausgeblendete Spiele', 'Update-/DLC-Dateien: Einstellungen → Systeme & ROMs → Konsole')] : []),
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
          available: `Version ${u.available} ist verfügbar`,
          latest: 'Du hast die neueste Version',
          downloading: `Lade v${u.available || ''} herunter … ${u.progress || 0} %`,
          ready: `Version ${u.available} ist bereit zur Installation`,
          error: `Fehler: ${u.error || ''}`
        }[u.status] || '';
        const debugRows = [
          group('Fehlersuche', 'Debug-Modus'),
          toggle('Debug-Modus', () => C().general, 'debugMode', 'Schreibt Eingaben, Fehler, Bildschirm- und Controller-Infos in ein Protokoll. Oben erscheint „DEBUG“'),
          button('Debug-Bericht erstellen', () => App.debugReport(), { desc: 'Speichert Protokoll, Systeminfos und Einstellungen (ohne Passwörter/Tokens) als Textdatei auf dem Desktop – zum Weitergeben an Claude' }),
          button('Protokoll-Ordner öffnen', () => api.debugOpenFolder())
        ];
        const rows = [
          group('AleGamestation', `Version ${u.version || ''}`),
          { type: 'info', label: 'Update-Status', desc: status, get: () => '' },
          button('⟳ Nach Updates suchen …', () => App.updateDialog(true), { desc: 'Fragt GitHub nach der neuesten Version und zeigt die Änderungen' }),
          toggle('Automatisch nach Updates suchen', () => C().general, 'autoUpdate', 'Beim Start und alle 6 Stunden auf GitHub prüfen'),
          toggle('Updates automatisch herunterladen', () => C().general, 'autoDownloadUpdates', 'Aus = erst nachfragen. Installiert wird immer erst, wenn du es bestätigst oder die App beendest')
        ];
        if (u.status === 'ready') rows.push(button(`⬆ Jetzt auf v${u.available} aktualisieren und neu starten`, () => App.installUpdate()));
        if (u.notes && u.available) rows.push(group(`Neu in Version ${u.available}`), ...u.notes.split('\n').filter((l) => l.trim()).slice(0, 12).map((l) => ({ type: 'info', label: l.replace(/^\s*[-*•]\s*/, '• '), get: () => '' })));
        return rows.concat(debugRows);
      }
    }
  ];

  /** Vollbild-Infos zum Emulator: erkannt? welches Argument? empfohlene Start-Argumente übernehmen */
  function fullscreenRows(o) {
    const e = o();
    const p = App.emuProfile(e.exe);
    const globalOn = C().general.emulatorFullscreen !== false;
    const already = p && p.has && new RegExp(p.has, p.hasFlags || '').test(e.args || '');
    let desc;
    if (!p) desc = 'Unbekannter Emulator – das Vollbild-Argument bitte selbst in die Start-Argumente eintragen (oder im Emulator „im Vollbild starten“ einschalten)';
    else if (!p.fullscreen) desc = `Erkannt: ${p.name}. ${p.note}`;
    else if (already) desc = `Erkannt: ${p.name} – Vollbild steht bereits in den Start-Argumenten`;
    else desc = `Erkannt: ${p.name} – beim Start wird „${p.fullscreen.join(' ')}“ automatisch ergänzt`;
    const rows = [
      { ...toggle('Im Vollbild starten', o, 'fullscreen', desc), get: () => o().fullscreen !== false && globalOn, disabled: !globalOn }
    ];
    if (p && p.args && !/CORE_libretro/.test(p.args) && (e.args || '').trim() !== p.args) {
      rows.push(button(`Empfohlene Start-Argumente übernehmen: ${p.args}`, async () => { o().args = p.args; await commit(false); App.toast('Start-Argumente übernommen', 'ok'); }));
    }
    return rows;
  }

  function openEmulator(id) {
    openDetail(() => {
      const i = C().emulators.findIndex((e) => e.id === id);
      if (i < 0) return null;
      const o = () => C().emulators[i];
      const e = o();
      const used = C().systems.filter((s) => s.emulator === id).map((s) => s.name);
      return {
        title: e.name,
        rows: [
          text('Name', o, 'name', '', { rescan: true }),
          pathRow('Programm (.exe)', o, 'exe', 'file', '', { rescan: true }),
          text('Start-Argumente', o, 'args', 'Platzhalter: {rom} {romName} {romDir} {emuDir} – z.B. -f "{rom}" für Vollbild'),
          ...fullscreenRows(o),
          { type: 'info', label: 'Verwendet von', desc: used.length ? used.join(', ') : 'Keiner Konsole – über „Konsole hinzufügen“ zuordnen', get: () => '' },
          button('Emulator löschen', async () => {
            if (!(await App.confirm('Emulator löschen?', esc(e.name), 'Löschen'))) return;
            C().emulators.splice(i, 1);
            await commit(true);
            closeDetail();
          }, { danger: true })
        ]
      };
    });
  }

  function openSystem(id) {
    openDetail(() => {
      const i = C().systems.findIndex((s) => s.id === id);
      if (i < 0) return null;
      const o = () => C().systems[i];
      const s = o();
      const emuOpts = C().emulators.map((e) => ({ value: e.id, label: e.name }));
      const count = (App.library.systems.find((x) => x.id === id) || { count: 0 }).count;
      return {
        title: s.name,
        extra: `${count} Spiele`,
        rows: [
          group('Spiele'),
          toggle('Aktiv', o, 'enabled', 'Ausgeschaltete Konsolen werden nicht angezeigt', { rescan: true }),
          ...emulatorRows(id, o, count),
          listText('ROM-Ordner', o, 'romDirs', 'Mehrere mit ; trennen – Unterordner werden mit durchsucht', { rescan: true }),
          button('＋ ROM-Ordner hinzufügen …', async () => {
            const d = await api.pickFolder();
            if (d) { o().romDirs = [...(o().romDirs || []), d]; await commit(true); }
          }),
          listText('Dateiendungen', o, 'extensions', 'z.B. .sfc ; .smc ; .zip', { rescan: true }),
          ...hideRows(id, o),
          group('Aussehen'),
          text('Name', o, 'name', '', { rescan: true }),
          text('Kurzname', o, 'short', 'Auf der Kachel', { rescan: true }),
          pathRow('Logo', o, 'logo', 'image', 'Oben rechts auf der Kachel – leer = eingebaute Abbildung', { rescan: true }),
          pathRow('Hintergrundbild', o, 'tileImage', 'image', 'Füllt die ganze Kachel, z.B. ein Foto der Konsole', { rescan: true }),
          group('Aktionen'),
          button('⬇ Fehlende Cover für diese Konsole laden', () => App.scrape({ system: id })),
          button('Konsole löschen', async () => {
            if (!(await App.confirm('Konsole löschen?', `${esc(s.name)} wird entfernt. Deine ROM-Dateien bleiben erhalten.`, 'Löschen'))) return;
            C().systems.splice(i, 1);
            await commit(true);
            closeDetail();
          }, { danger: true })
        ]
      };
    });
  }

  /** ROMs ausblenden: Update-/DLC-Dateien, eigene Regeln und Liste der ausgeblendeten Dateien */
  function hideRows(id, o) {
    const hidden = App.library.games.filter((g) => g.system === id && g.hidden);
    const why = { update: 'Update/DLC', rule: 'Regel', manual: 'manuell' };
    const unhide = async (g) => {
      const ov = (C().gameOverrides[g.id] = C().gameOverrides[g.id] || {});
      if (g.hiddenBy === 'manual') delete ov.hidden; else ov.hidden = false; // Regel für diese Datei aufheben
      if (!Object.keys(ov).length) delete C().gameOverrides[g.id];
      await commit(true);
      App.toast(`„${g.name}“ wird wieder angezeigt`, 'ok');
    };
    const shown = hidden.slice(0, 40);
    return [
      group('Dateien ausblenden', hidden.length ? `${hidden.length} ausgeblendet` : ''),
      { ...toggle('Update-, DLC- und Patch-Dateien ausblenden', o, 'hideUpdates', 'z.B. Switch-Updates [v65536], „(Update)“, „[DLC]“ oder Ordner „Updates“/„DLC“', { rescan: true }), get: () => o().hideUpdates !== false },
      listText('Eigene Regeln', o, 'hidePatterns', 'Teil des Datei- oder Ordnernamens, * als Platzhalter, mehrere mit ; trennen – z.B. Demo ; (Beta) ; Bonus', { rescan: true }),
      ...shown.map((g) => button(`Einblenden: ${g.name}`, () => unhide(g), { desc: `${why[g.hiddenBy] || 'ausgeblendet'} · ${g.rom ? g.rom.split(/[\\/]/).slice(-2).join('/') : ''}` })),
      ...(hidden.length > shown.length ? [{ type: 'group', label: `… und ${hidden.length - shown.length} weitere` }] : [])
    ];
  }

  /** Emulatoren einer Konsole: Standard für alle Spiele, weitere Emulatoren, Emulator pro Spiel */
  function consoleEmus(s) {
    const ids = [s.emulator, ...(s.emulators || [])].filter((x, i, a) => x && a.indexOf(x) === i);
    return ids.map((eid) => C().emulators.find((e) => e.id === eid)).filter(Boolean);
  }
  function emuLabel(e) {
    const info = (App.library.emulators || []).find((x) => x.id === e.id);
    return e.name + (info && !info.found ? ' (Programm fehlt)' : '');
  }
  function emulatorRows(id, o, count) {
    const s = o();
    const mine = consoleEmus(s);
    const others = C().emulators.filter((e) => !mine.includes(e));
    const games = App.library.games.filter((g) => g.system === id);
    const custom = games.filter((g) => (C().gameOverrides[g.id] || {}).emulator).length;
    return [
      group('Emulatoren', mine.length > 1 ? `${mine.length} für diese Konsole` : ''),
      select('Standard-Emulator (alle Spiele)', o, 'emulator', [...mine, ...others].map((e) => ({ value: e.id, label: emuLabel(e) + (mine.includes(e) ? '' : ' · andere Konsole') })), 'Gilt für jedes Spiel ohne eigene Wahl', {
        rescan: true,
        set: (v) => { o().emulator = v; o().emulators = [...new Set([...(o().emulators || []), v])]; }
      }),
      ...mine.filter((e) => e.id !== s.emulator).map((e) => button(`Entfernen: ${e.name}`, async () => {
        o().emulators = (o().emulators || []).filter((x) => x !== e.id);
        // Spiele dieser Konsole, die ihn nutzen, wieder auf den Standard stellen
        for (const g of App.library.games.filter((x) => x.system === id)) {
          const ov = C().gameOverrides[g.id];
          if (ov && ov.emulator === e.id) { delete ov.emulator; if (!Object.keys(ov).length) delete C().gameOverrides[g.id]; }
        }
        await commit(true);
      }, { desc: 'Weiterer Emulator dieser Konsole – Spiele, die ihn nutzen, starten danach mit dem Standard' })),
      button('＋ Weiteren Emulator für diese Konsole …', () => addConsoleEmulator(o), { desc: 'Z.B. einen zweiten Switch-Emulator für bestimmte Spiele' }),
      item('Emulator pro Spiel', count ? `${custom ? custom + ' Spiele mit eigenem Emulator' : 'Alle Spiele nutzen den Standard'}` : 'Noch keine Spiele gefunden', {
        status: custom ? 'ok' : '', statusText: custom ? `${custom} eigene` : '', action: () => openGameEmulators(id)
      })
    ];
  }
  /** Weiteren Emulator hinzufügen: vorhandenen wählen oder neue .exe einrichten */
  function addConsoleEmulator(o) {
    const s = o();
    const have = new Set([s.emulator, ...(s.emulators || [])]);
    const add = async (eid) => {
      App.closeMenu();
      o().emulators = [...new Set([...(o().emulators || []), eid])];
      await commit(true);
      const e = C().emulators.find((x) => x.id === eid);
      App.toast(`${e ? e.name : 'Emulator'} hinzugefügt – jetzt unter „Emulator pro Spiel“ zuordnen`, 'ok', 5000);
    };
    const items = C().emulators.filter((e) => !have.has(e.id)).map((e) => ({ label: emuLabel(e), icon: 'gamepad', action: () => add(e.id) }));
    items.unshift({ label: 'Neuen Emulator auswählen (.exe) …', icon: 'plus', hint: 'Name & Start-Argumente werden erkannt', action: async () => {
      const exe = await api.pickFile({ filters: [{ name: 'Programme', extensions: ['exe'] }] });
      if (!exe) return;
      const eid = App.newEmulator(exe);
      await add(eid);
    } });
    App.menu({ title: `${s.short || s.name}: Emulator hinzufügen`, text: 'Welcher Emulator soll zusätzlich für diese Konsole bereitstehen?', items });
  }
  /** Unterseite: Emulator für jedes Spiel der Konsole */
  function openGameEmulators(id) {
    openDetail(() => {
      const s = C().systems.find((x) => x.id === id);
      if (!s) return null;
      const mine = consoleEmus(s);
      const others = C().emulators.filter((e) => !mine.includes(e));
      const def = C().emulators.find((e) => e.id === s.emulator);
      const games = App.library.games.filter((g) => g.system === id).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const opts = [{ value: '', label: `Standard (${def ? def.name : '–'})` }]
        .concat(mine.filter((e) => e.id !== s.emulator).map((e) => ({ value: e.id, label: emuLabel(e) })))
        .concat(others.map((e) => ({ value: e.id, label: emuLabel(e) + ' · andere Konsole' })));
      const custom = games.filter((g) => (C().gameOverrides[g.id] || {}).emulator);
      const rows = [
        group('Emulator pro Spiel', `${games.length} Spiele`),
        { type: 'info', label: 'So geht’s', desc: '◀ ▶ wählt den Emulator für das Spiel. „Standard“ = der Standard-Emulator der Konsole. Weitere Emulatoren: eine Seite zurück → „Weiteren Emulator für diese Konsole“.', get: () => '' }
      ];
      if (custom.length) rows.push(button('Alle auf Standard zurücksetzen', async () => {
        for (const g of custom) { const ov = C().gameOverrides[g.id]; delete ov.emulator; if (!Object.keys(ov).length) delete C().gameOverrides[g.id]; }
        await commit(true);
      }));
      for (const g of games) {
        rows.push({
          type: 'select', label: g.name, options: opts, rescan: true,
          desc: g.rom ? g.rom.split(/[\\/]/).pop() : '',
          get: () => ((C().gameOverrides[g.id] || {}).emulator || ''),
          set: (v) => {
            const ov = (C().gameOverrides[g.id] = C().gameOverrides[g.id] || {});
            if (v) ov.emulator = v; else delete ov.emulator;
            if (!Object.keys(ov).length) delete C().gameOverrides[g.id];
          }
        });
      }
      if (!games.length) rows.push({ type: 'info', label: 'Noch keine Spiele', desc: 'ROM-Ordner festlegen und die Bibliothek neu einlesen', get: () => '' });
      return { title: `${s.short || s.name}: Emulator pro Spiel`, extra: `${custom.length} eigene`, rows };
    });
  }

  function openGame(id) {
    openDetail(() => {
      const i = C().pcGames.findIndex((g) => g.id === id);
      if (i < 0) return null;
      const o = () => C().pcGames[i];
      const g = o();
      const rows = [
        text('Name', o, 'name', '', { rescan: true }),
        pathRow('Programm', o, 'exe', 'file', '.exe, .lnk, .url oder .bat', { rescan: true }),
        text('Argumente', o, 'args', 'Optional'),
        pathRow('Cover-Bild', o, 'cover', 'image', 'Hochformat 600×900 sieht am besten aus', { rescan: true }),
        select('Beenden per Controller', o, 'killMode', KILL_OPTS, 'Lässt sich das Spiel nicht beenden: „Alle Prozesse aus dem Spielordner“ wählen', { rescan: true })
      ];
      if (g.killMode === 'name') rows.push(text('Prozessname', o, 'processName', 'z.B. game-win64.exe'));
      rows.push(button('Entfernen', async () => {
        if (!(await App.confirm('Spiel entfernen?', `${esc(g.name)} wird aus AleGamestation entfernt (die Dateien bleiben erhalten).`, 'Entfernen'))) return;
        C().pcGames.splice(i, 1);
        await commit(true);
        closeDetail();
      }, { danger: true }));
      return { title: g.name || 'Spiel', rows };
    });
  }

  function cleanErr(e) {
    return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function haLoad() {
    App.toast('Verbinde mit Home Assistant …', 'info', 1500);
    try {
      S.ha = await api.haTest();
      App.toast(`✔ Verbunden – ${S.ha.players.length} Mediaplayer gefunden`, 'ok');
      // Einzigen Fernseher automatisch auswählen
      const H = C().homeassistant;
      if (!H.tvEntity && S.ha.players.length === 1) { H.tvEntity = S.ha.players[0].id; await commit(false); }
    } catch (e) {
      S.ha = { error: cleanErr(e), players: [] };
      App.toast(S.ha.error, 'error', 7000);
    }
    render();
  }

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
      label: r.name, hint: `${r.memMB} MB`, icon: 'app',
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
      e.onclick = () => { S.section = i; S.focus = 0; S.detail = null; render(); };
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
      case 'item': return `${r.statusText ? `<span class="item-status ${r.status || ''}">${esc(r.statusText)}</span>` : ''}<span class="chev">${Icons.svg('chevron')}</span>`;
      default: return '';
    }
  }

  function render() {
    renderTabs();
    let detail = null;
    if (S.detail) {
      detail = S.detail.builder();
      if (!detail) S.detail = null; // Eintrag wurde gelöscht
    }
    const section = SECTIONS[S.section];
    S.rows = detail
      ? [{ type: 'crumb', label: section.title, title: detail.title, extra: detail.extra }, button(S.detail.parent ? '‹ Zurück' : '‹ Zurück zur Übersicht', () => closeDetail()), ...detail.rows]
      : section.rows();
    const body = $('#settingsBody');
    // Beim Neuaufbau derselben Seite die Scroll-Position behalten (kein Springen)
    const pageKey = `${S.section}|${detail ? detail.title : ''}`;
    const keepTop = S.lastPage === pageKey ? body.scrollTop : null;
    S.lastPage = pageKey;
    body.classList.toggle('detail', !!detail);
    body.innerHTML = '';
    const focusables = [];
    S.rows.forEach((r) => {
      if (r.type === 'crumb') {
        const c = document.createElement('div');
        c.className = 's-crumb';
        c.innerHTML = `<span>${esc(r.label)}</span><span class="sep">${Icons.svg('chevron')}</span><b>${esc(r.title)}</b>${r.extra ? `<small>${esc(r.extra)}</small>` : ''}`;
        body.appendChild(c);
        return;
      }
      if (r.type === 'group') {
        const g = document.createElement('div');
        g.className = 's-group';
        g.innerHTML = `<span>${esc(r.label)}</span>${r.extra ? `<span>${esc(r.extra)}</span>` : ''}`;
        body.appendChild(g);
        return;
      }
      const row = document.createElement('div');
      row.className = 's-row' + (r.type === 'button' ? ' button-row' : '') + (r.type === 'item' ? ' item-row' : '') + (r.danger ? ' danger' : '');
      // Führendes Zeichen ("＋ …", "🔍 …") als einheitliches Icon darstellen
      const lab = Icons.fromLabel(r.label);
      const icon = r.icon || lab.icon;
      row.innerHTML = `<div class="s-label"><b>${icon ? Icons.svg(icon) : ''}${esc(icon && !r.icon ? lab.text : r.label)}</b>${r.desc ? `<small>${esc(r.desc)}</small>` : ''}</div><div class="s-value">${valueHtml(r)}</div>`;
      const idx = focusables.length;
      row.onclick = (e) => {
        S.focus = idx; updateFocus(true);
        if (e.target.tagName === 'INPUT') return;
        // Maus: ◀ / ▶ einzeln anklickbar
        const arrow = e.target.closest && e.target.closest('.arrow');
        if (arrow && r.type === 'select') return act(arrow.textContent.includes('◀') ? 'left' : 'right');
        act('accept');
      };
      // Nur markieren, nicht scrollen (sonst springt die Liste beim Mausrad)
      row.onmouseenter = () => { if (S.focus !== idx) { S.focus = idx; (S.focusables || []).forEach((x, i) => x.el.classList.toggle('focused', i === idx)); } };
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
    if (keepTop !== null) body.scrollTop = keepTop;
    updateFocus(keepTop !== null, keepTop === null);
    App.renderHints();
  }

  /** @param {boolean} noScroll  @param {boolean} instant ohne Animation (neue Seite) */
  function updateFocus(noScroll, instant) {
    (S.focusables || []).forEach((r, i) => r.el.classList.toggle('focused', i === S.focus));
    const r = S.focusables && S.focusables[S.focus];
    if (!r) return;
    // Nur scrollen, wenn die Zeile aus dem sichtbaren Bereich wandert
    if (!noScroll) r.el.scrollIntoView({ block: 'nearest', behavior: instant ? 'auto' : 'smooth' });
    else if (noScroll && !instant) r.el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  async function act(a) {
    const r = S.focusables[S.focus];
    if (!r) return;
    if (a === 'left' || a === 'right') {
      if (r.type === 'select') {
        if (!r.options.length) return;
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
      else if (r.type === 'button' || r.type === 'item') await r.action();
      else if (r.type === 'text') { const inp = r.el.querySelector('input'); inp.focus(); inp.select(); }
      else if (r.type === 'path') {
        const p = r.kind === 'folder' ? await api.pickFolder() : r.kind === 'image' ? await api.pickImage() : await api.pickFile();
        if (p) { r.set(p); await commit(!!r.rescan); }
      }
    }
  }

  window.SettingsView = {
    async open(sectionId) {
      if (sectionId) { S.section = Math.max(0, SECTIONS.findIndex((s) => s.id === sectionId)); S.focus = 0; S.detail = null; }
      try { S.displays = await api.listDisplays(); } catch { S.displays = []; }
      try { S.audio = await api.listAudio(); } catch { S.audio = []; }
      S.tv = null;
      api.tvStatus().then((t) => { S.tv = t; if (SECTIONS[S.section].id === 'display' && !S.detail) render(); }).catch(() => {});
      try { S.spotify = await api.spotifyStatus(); } catch { S.spotify = {}; }
      try { S.aleclip = await api.aleclipStatus(); } catch { S.aleclip = {}; }
      try { S.update = await api.updateState(); } catch { S.update = {}; }
      render();
    },
    handle(a) {
      switch (a) {
        case 'up': if (S.focus > 0) { S.focus--; updateFocus(); Sounds.play('move'); } break;
        case 'down': if (S.focus < S.focusables.length - 1) { S.focus++; updateFocus(); Sounds.play('move'); } break;
        // L1/R1: Bereiche der Einstellungen wechseln
        case 'lb': S.detail = null; S.section = (S.section + SECTIONS.length - 1) % SECTIONS.length; S.focus = 0; render(); Sounds.play('tab'); break;
        case 'rb': S.detail = null; S.section = (S.section + 1) % SECTIONS.length; S.focus = 0; render(); Sounds.play('tab'); break;
        case 'back': Sounds.play('back'); if (!closeDetail()) { const sec = SECTIONS[S.section].id; App.backToLibrary(); App.pushForward(() => App.openSettings(sec)); } break;
        case 'select': Sounds.play('back'); S.detail = null; App.backToLibrary(); break;
        default: act(a);
      }
    },
    refreshUpdate,
    rerender: () => render(),
    hints(hint, glyph) {
      return hint(glyph('A'), S.detail ? 'Ändern' : 'Öffnen / Ändern') + hint(Glyphs.arrows(), 'Wert') + hint(glyph('LB') + glyph('RB'), 'Bereich') + hint(glyph('LT') + glyph('RT'), 'Kategorie') + hint(glyph('B'), S.detail ? 'Übersicht' : 'Zurück');
    }
  };
})();
