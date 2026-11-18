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
  // ---------- Anzeige: Monitor-Auswahl wie bei AleVista ----------
  const START_MODES = [
    { value: 'custom', label: 'Eigene Auswahl je Bildschirm' }, { value: 'none', label: 'Nichts ändern' },
    { value: 'extend', label: 'Windows: Erweitern' }, { value: 'external', label: 'Windows: Nur zweiter Bildschirm' },
    { value: 'internal', label: 'Windows: Nur PC-Bildschirm' }, { value: 'clone', label: 'Windows: Duplizieren' }
  ];
  const EXIT_MODES = [
    { value: 'restore', label: 'Vorherige Anordnung wiederherstellen' }, { value: 'custom', label: 'Eigene Auswahl je Bildschirm' },
    { value: 'none', label: 'Nichts ändern' }, { value: 'extend', label: 'Windows: Erweitern' }, { value: 'internal', label: 'Windows: Nur PC-Bildschirm' }
  ];
  const STATES = [{ value: 'off', label: 'Aus' }, { value: 'on', label: 'An' }, { value: 'primary', label: 'An · Hauptanzeige' }];

  /** Vorschlag für eine neue Auswahl: aktuelle Anordnung, ältere Einstellungen (nur TV / TV als Hauptanzeige) übernommen */
  function defaultPlan(which) {
    const d = C().display;
    const tvKey = d.tv && d.tv.key;
    const monitors = {}; const names = {};
    for (const m of S.displays) {
      names[m.key] = m.name;
      monitors[m.key] = m.active ? (m.primary ? 'primary' : 'on') : 'off';
    }
    if (which === 'start' && tvKey) {
      names[tvKey] = names[tvKey] || d.tv.name;
      if (d.onStart === 'tvOnly') { for (const k of Object.keys(monitors)) monitors[k] = 'off'; monitors[tvKey] = 'primary'; }
      else if (d.onStart === 'tvPrimary' || d.tvAsPrimary) { for (const k of Object.keys(monitors)) if (monitors[k] === 'primary') monitors[k] = 'on'; monitors[tvKey] = 'primary'; }
      else if (d.enableTv !== false && monitors[tvKey] === 'off') monitors[tvKey] = 'on';
    }
    if (which === 'exit' && tvKey && monitors[tvKey] === 'primary') {
      // nach dem Spielen wieder ein Monitor als Hauptanzeige
      monitors[tvKey] = 'on';
      const other = S.displays.find((m) => m.key !== tvKey && m.active);
      if (other) monitors[other.key] = 'primary';
    }
    return { monitors, names };
  }

  function planSummary(plan) {
    const m = (plan && plan.monitors) || {}; const n = (plan && plan.names) || {};
    const on = Object.keys(m).filter((k) => m[k] !== 'off');
    const prim = Object.keys(m).find((k) => m[k] === 'primary');
    return `${on.length} an${prim ? ' · Hauptanzeige: ' + (n[prim] || 'Bildschirm') : ''}`;
  }

  /** Alle bekannten Bildschirme (angeschlossen + aus dem Plan) mit Nummer */
  function monitorList(plan) {
    const list = S.displays.map((m, i) => ({ ...m, num: i + 1, connected: true }));
    for (const k of Object.keys((plan && plan.monitors) || {})) {
      if (!list.some((m) => m.key === k)) list.push({ key: k, name: (plan.names || {})[k] || 'Bildschirm', num: list.length + 1, connected: false, active: false, width: 0, height: 0 });
    }
    return list;
  }

  /** Grafische Vorschau: Rechtecke in echter Anordnung, abgeschaltete gestrichelt, Hauptanzeige mit Stern */
  function monitorPreview(plan, caption) {
    const list = monitorList(plan);
    if (!list.length) return `<div class="mon-preview empty">Keine Bildschirme gefunden – „Bildschirmliste aktualisieren“</div>`;
    const tvKey = C().display.tv && C().display.tv.key;
    // Position: aktive aus Windows, abgeschaltete rechts daneben
    const placed = []; let maxRight = 0; let minX = Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const m of list.filter((x) => x.active && x.width)) {
      placed.push({ m, x: m.x || 0, y: m.y || 0, w: m.width, h: m.height });
    }
    for (const p of placed) { maxRight = Math.max(maxRight, p.x + p.w); minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h); }
    if (!placed.length) { maxRight = 0; minX = 0; minY = 0; maxY = 1080; }
    let cursor = maxRight + 400;
    for (const m of list.filter((x) => !(x.active && x.width))) {
      const w = m.width || 1920; const h = m.height || 1080;
      placed.push({ m, x: cursor, y: minY, w, h, detached: true });
      cursor += w + 400; maxY = Math.max(maxY, minY + h);
    }
    const right = Math.max(...placed.map((p) => p.x + p.w));
    const W = right - minX; const H = maxY - minY;
    const state = (k) => (plan ? (plan.monitors || {})[k] || 'off' : null);
    const tiles = placed.map(({ m, x, y, w, h, detached }) => {
      const st = state(m.key) || (m.active ? (m.primary ? 'primary' : 'on') : 'off');
      const cls = ['mon', st === 'off' ? 'off' : '', st === 'primary' ? 'primary' : '', !m.connected ? 'missing' : '', detached ? 'detached' : ''].join(' ');
      const style = `left:${((x - minX) / W) * 100}%;top:${((y - minY) / H) * 100}%;width:${(w / W) * 100}%;height:${(h / H) * 100}%`;
      const badges = `${st === 'primary' ? '<span class="mb prim">★ Haupt</span>' : ''}${m.key === tvKey ? '<span class="mb tv">TV</span>' : ''}${st === 'off' ? '<span class="mb">aus</span>' : ''}${!m.connected ? '<span class="mb">nicht verbunden</span>' : ''}`;
      return `<div class="${cls}" style="${style}"><div class="mon-num">${m.num}</div><div class="mon-name">${esc(m.name)}</div>${m.width ? `<div class="mon-res">${m.width}×${m.height}</div>` : ''}<div class="mon-badges">${badges}</div></div>`;
    }).join('');
    return `<div class="mon-caption">${esc(caption || '')}</div><div class="mon-preview"><div class="mon-stage" style="aspect-ratio:${(W / H).toFixed(3)}">${tiles}</div></div>`;
  }

  /** Eine Auswahlzeile pro Bildschirm: Aus / An / An · Hauptanzeige */
  function monitorRows(key) {
    const plan = C().display[key];
    if (!plan) return [];
    plan.monitors = plan.monitors || {}; plan.names = plan.names || {};
    const tvKey = C().display.tv && C().display.tv.key;
    return monitorList(plan).map((m) => ({
      type: 'select', label: `${m.num}. ${m.name}${m.key === tvKey ? ' (Fernseher)' : ''}`, options: STATES,
      desc: !m.connected ? 'gerade nicht angeschlossen' : m.active ? `${m.width}×${m.height}${m.hz ? ' · ' + m.hz + ' Hz' : ''}${m.primary ? ' · jetzt Hauptanzeige' : ''}` : 'jetzt in Windows abgeschaltet',
      get: () => plan.monitors[m.key] || 'off',
      set: (v) => {
        if (v === 'primary') for (const k of Object.keys(plan.monitors)) if (plan.monitors[k] === 'primary') plan.monitors[k] = 'on';
        plan.monitors[m.key] = v;
        plan.names[m.key] = m.name;
      }
    }));
  }

  /** Sofort umschalten, 15 Sekunden „Beibehalten?“ – sonst automatisch zurück (wie AleVista) */
  async function testPlan(which) {
    const plan = which === 'exit' ? C().display.exitPlan : C().display.startPlan;
    const m = (plan && plan.monitors) || {};
    if (!Object.values(m).some((v) => v !== 'off')) return App.toast('Mindestens ein Bildschirm muss an sein', 'error', 4000);
    await App.save({ immediate: true });
    App.toast('Schalte die Bildschirme um …', 'info', 2500);
    const r = await api.applyDisplayPlan(which).catch((e) => ({ ok: false, error: String(e.message || e) }));
    if (!r || !r.ok) { App.toast((r && r.error) || 'Umschalten fehlgeschlagen', 'error', 6000); return; }
    let left = 15;
    let done = false;
    const finish = async (keep) => {
      if (done) return; done = true; clearInterval(timer);
      App.closeMenu();
      if (!keep) { await api.revertDisplays().catch(() => {}); App.toast('Zurückgesetzt', 'info'); } else App.toast('Beibehalten – „Alle Bildschirme wieder einschalten“ setzt zurück', 'ok', 5000);
      S.displays = await api.listDisplays().catch(() => S.displays); render();
    };
    App.menu({
      title: 'Bildschirme beibehalten?', text: `Automatisch zurück in <b id="planCountdown">${left}</b> Sekunden`,
      items: [
        { label: 'Beibehalten', icon: 'check', action: () => finish(true) },
        { label: 'Zurücksetzen', icon: 'undo', action: () => finish(false) }
      ]
    });
    const timer = setInterval(() => {
      left--;
      const el = document.getElementById('planCountdown');
      if (el) el.textContent = left;
      if (left <= 0) finish(false);
    }, 1000);
  }

  /** Zustand des Fernsehers: an/aus, verbunden, in Windows aktiv/deaktiviert */
  function tvStatusRows(planActive) {
    const t = S.tv;
    if (!C().display.tv) return [];
    const parts = [];
    if (t && t.power) parts.push(`Fernseher: ${t.power}${t.source ? ' · Eingang ' + t.source : ''}`);
    if (t) parts.push(`Windows: ${t.windows}`);
    const status = t ? (t.active ? 'ok' : t.connected ? 'off' : 'bad') : '';
    return [
      { type: 'item', label: 'Zustand', desc: t ? parts.join('  ·  ') : 'Wird ermittelt …', status, statusText: t ? (t.active ? 'bereit' : t.connected ? 'deaktiviert' : 'nicht verbunden') : '',
        action: async () => { S.tv = await api.tvStatus().catch(() => null); render(); App.toast('Zustand aktualisiert', 'info', 1200); } },
      ...(planActive ? [] : [{
        ...toggle('Fernseher als Hauptanzeige', () => C().display, 'tvAsPrimary', 'Im Konsolenmodus wird der TV zur Hauptanzeige – Spiele starten dort. Beim Beenden wird wieder dein Hauptmonitor zur Hauptanzeige'),
        get: () => !!C().display.tvAsPrimary || C().display.onStart === 'tvPrimary' || C().display.onStart === 'tvOnly',
        set: (v) => {
          C().display.tvAsPrimary = v;
          // „Fernseher als Hauptbildschirm“ als Startmodus passt nicht zu „aus“
          if (!v && C().display.onStart === 'tvPrimary') C().display.onStart = 'extend';
        }
      }, { ...toggle('Deaktivierten Fernseher automatisch einschalten', () => C().display, 'enableTv', 'Ist der TV angesteckt, aber in Windows abgeschaltet, wird er beim Start eingeschaltet und beim Beenden wieder abgeschaltet'), get: () => C().display.enableTv !== false }]),
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
        { ...select('Beim Start', () => C().general, 'startMode', [
          { value: 'ask', label: 'Fragen: Fernseher oder PC' }, { value: 'tv', label: 'Immer Fernseher' }, { value: 'pc', label: 'Immer am PC' }
        ], '„Am PC“: Fernseher, Bildschirme, Hauptbildschirm und Ton bleiben, wie sie sind – zum Spielen am Schreibtisch'), get: () => C().general.startMode || 'ask' },
        ...((C().general.startMode || 'ask') === 'ask' ? [
          { ...select('Ohne Antwort', () => C().general, 'startAskDefault', [{ value: 'tv', label: 'Fernseher' }, { value: 'pc', label: 'Am PC' }], 'Wird gewählt, wenn du beim Start nichts auswählst'), get: () => C().general.startAskDefault || 'tv' },
          { ...select('Automatisch nach', () => C().general, 'startAskSeconds', [5, 10, 15, 30, 0].map((v) => ({ value: v, label: v ? v + ' Sekunden' : 'Nie – warten' }))), get: () => C().general.startAskSeconds ?? 10 }
        ] : []),
        ...(App.pcMode ? [
          { type: 'info', label: 'Läuft am PC', desc: 'Fernseher, Bildschirme, Hauptbildschirm, Ton und Leistungsmodus bleiben unverändert.', get: () => '' },
          button('Auf den Fernseher wechseln', async () => {
            if (await App.confirm('Auf den Fernseher wechseln?', 'AleGamestation startet neu – mit Fernseher, Bildschirm- und Tonumschaltung.', 'Wechseln')) api.startConsoleMode();
          })
        ] : []),
        ...(App.setupMode ? [
          { type: 'info', label: 'Läuft im Einrichtungsmodus', desc: 'Fernseher, Home Assistant, Bildschirm- und Tonumschaltung sowie der Leistungsmodus bleiben aus. Änderungen werden ganz normal gespeichert.', get: () => '' },
          button('Jetzt in den Konsolenmodus wechseln', async () => {
            if (await App.confirm('Konsolenmodus starten?', 'AleGamestation startet neu – mit Fernseher, Bildschirm- und Tonumschaltung.', 'Starten')) api.startConsoleMode();
          })
        ] : []),
        button('Verknüpfung „Einrichten (ohne Fernseher)“ auf dem Desktop', async () => {
          try { const f = await api.createSetupShortcut(); App.toast(`Verknüpfung erstellt: ${f.split(/[\\/]/).pop().replace(/\.lnk$/, '')}`, 'ok', 6000); } catch (e) { App.toast(cleanErr(e), 'error', 6000); }
        }, { desc: 'Öffnet AleGamestation nur zum Einstellen: im Fenster auf dem PC-Monitor, ohne Fernseher, Bildschirm-/Tonumschaltung und Leistungsmodus – mit Debug-Protokoll' }),
        toggle('Vollbild', () => C().general, 'startFullscreen', 'Mit F11 jederzeit an- und ausschalten'),
        toggle('Vollbild im Einrichtungsmodus', () => C().general, 'setupFullscreen', 'Auch beim Start über „Einrichten (ohne Fernseher)“ im Vollbild – z.B. um direkt am PC zu spielen. F11 schaltet um'),
        select('Oberfläche anzeigen auf', () => C().general, 'targetDisplay', [{ value: 'primary', label: 'Hauptbildschirm' }, { value: 'tv', label: 'Fernseher (Einstellungen → Bild & Ton)' }].concat(S.displays.filter((d) => d.electronId != null && d.active !== false).map((d) => ({ value: 'id:' + d.electronId, label: displayLabel(d) }))), 'Bei „Nur Fernseher“ ist der TV automatisch der Hauptbildschirm'),
        group('Beim Spielen'),
        select('Taskleiste ausblenden', () => C().general, 'hideTaskbar', [
          { value: 'game', label: 'Während ein Spiel läuft' }, { value: 'console', label: 'Im ganzen Konsolenmodus' }, { value: 'off', label: 'Nie' }
        ], 'Für Emulatoren, bei denen im Vollbild die Taskleiste sichtbar bleibt (z.B. Switch). Wird danach immer wieder eingeblendet', { get: () => C().general.hideTaskbar || 'game' }),
        toggle('Oberfläche minimieren, während ein Spiel läuft', () => C().general, 'minimizeOnLaunch'),
        toggle('Nach Spielende zurück in die Oberfläche', () => C().general, 'refocusAfterGame'),
        group('Darstellung'),
        toggle('Konsolen als Foto zeigen', () => C().general, 'consolePhotos', 'Echte Konsolenfotos auf den Kacheln (sonst Umriss-Zeichnungen). Eigene Bilder: Einstellungen → Emulatoren → Konsolen & ROMs → Konsole → Logo', { get: () => C().general.consolePhotos !== false, rescan: true }),
        select('Farbthema', () => C().general, 'theme', [
          { value: 'midnight', label: 'Mitternacht' }, { value: 'aurora', label: 'Polarlicht' }, { value: 'ocean', label: 'Ozean' },
          { value: 'sunset', label: 'Sonnenuntergang' }, { value: 'synthwave', label: 'Synthwave' }, { value: 'graphite', label: 'Graphit' }
        ], 'Hintergrund und Lichtstimmung der Oberfläche', { get: () => C().general.theme || 'midnight' }),
        select('Akzentfarbe', () => C().general, 'accentColor', [
          { value: '#7c5cff', label: 'Violett' }, { value: '#22d3ee', label: 'Cyan' }, { value: '#3ddc84', label: 'Grün' },
          { value: '#ff4d6d', label: 'Rot' }, { value: '#ff9f1c', label: 'Orange' }, { value: '#3b82f6', label: 'Blau' }, { value: '#e5e5e5', label: 'Weiß' }
        ]),
        { ...toggle('Spielnamen auf den Covern', () => C().general, 'cardNames', 'Zeigt den Namen als Banner unten auf jedem Cover'), get: () => C().general.cardNames !== false },
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
      id: 'display', title: 'Bildschirme & Ton', rows: () => {
        const D = () => C().display;
        const startCustom = !!(D().startPlan && D().startPlan.mode === 'custom');
        const exitMode = (D().exitPlan && D().exitPlan.mode) || 'restore';
        return [
          group('Beim Start des Konsolenmodus', startCustom ? planSummary(D().startPlan) : 'Windows-Modus'),
          { type: 'preview', html: monitorPreview(startCustom ? D().startPlan : null, startCustom ? 'So wird es beim Start' : 'Aktuelle Anordnung') },
          {
            type: 'select', label: 'Bildschirme beim Start', options: START_MODES,
            desc: startCustom ? 'Pro Bildschirm wählen: Aus, An oder Hauptanzeige (Spiele starten auf der Hauptanzeige)' : 'Wie Win + P – oder „Eigene Auswahl“ für volle Kontrolle',
            get: () => (startCustom ? 'custom' : D().onStart === 'tvOnly' || D().onStart === 'tvPrimary' ? 'custom' : D().onStart || 'none'),
            set: (v) => {
              if (v === 'custom') D().startPlan = { mode: 'custom', ...defaultPlan('start') };
              else { D().startPlan = null; D().onStart = v; }
            }
          },
          ...(startCustom ? monitorRows('startPlan') : []),
          ...(startCustom ? [button('Jetzt testen', () => testPlan('start'), { desc: 'Schaltet sofort um – ohne Bestätigung geht es nach 15 Sekunden automatisch zurück' })] : []),
          group('Beim Beenden (zurück zum Desktop)', exitMode === 'custom' ? planSummary(D().exitPlan) : ''),
          ...(exitMode === 'custom' ? [{ type: 'preview', html: monitorPreview(D().exitPlan, 'So wird es nach dem Beenden') }] : []),
          {
            type: 'select', label: 'Bildschirme beim Beenden', options: EXIT_MODES,
            desc: exitMode === 'restore' ? 'Genau die Anordnung von vor dem Start – z.B. Fernseher wieder aus, Hauptmonitor wieder Hauptanzeige' : '',
            get: () => exitMode,
            set: (v) => { D().exitPlan = v === 'custom' ? { mode: 'custom', ...defaultPlan('exit') } : { mode: v }; }
          },
          ...(exitMode === 'custom' ? monitorRows('exitPlan') : []),
          ...(exitMode === 'custom' ? [button('Jetzt testen', () => testPlan('exit'), { desc: 'Ohne Bestätigung geht es nach 15 Sekunden automatisch zurück' })] : []),
          toggle('Vor Herunterfahren/Neustart wiederherstellen', D, 'restoreBeforeShutdown', 'Genau die Anordnung und der Hauptbildschirm von vor dem Konsolenmodus – damit Windows beim nächsten Start wieder auf deinem Hauptmonitor erscheint'),
          select('Wartezeit nach dem Umschalten', D, 'switchDelayMs', [1000, 1500, 2500, 4000, 6000].map((v) => ({ value: v, label: v / 1000 + ' s' }))),
          group('Fernseher', 'Für Home Assistant, Ton und „Oberfläche anzeigen auf: Fernseher“'),
          tvSelect(),
          ...tvStatusRows(startCustom),
          button('Bildschirme identifizieren', async () => { await api.identifyDisplays(); }, { desc: 'Zeigt 4 Sekunden lang Nummer und Name auf jedem Bildschirm' }),
          button('↻ Bildschirmliste aktualisieren', async () => { S.displays = await api.listDisplays().catch(() => []); render(); App.toast(`${S.displays.length} Bildschirm(e) gefunden`, 'info'); }),
          button('Alle Bildschirme wieder einschalten', async () => { await api.restoreDisplays(); App.toast('Bildschirme wiederhergestellt', 'ok'); S.displays = await api.listDisplays().catch(() => S.displays); render(); }),
          group('Ton', 'Auf welches Gerät der Ton im Konsolenmodus wechselt'),
          audioSelect(),
          toggle('Beim Beenden zurückstellen', D, 'restoreAudio', 'Danach wieder das vorherige Gerät (z.B. Kopfhörer am PC)', { get: () => D().restoreAudio !== false }),
          button('Jetzt auf dieses Gerät umstellen', async () => {
            const r = await api.applyAudio().catch((e) => ({ ok: false, error: String(e.message || e) }));
            App.toast(r && r.ok ? `Ton kommt jetzt aus: ${r.name}` : (r && r.error) || 'Umstellen fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
            S.audio = await api.listAudio().catch(() => []); render();
          }),
          group('Eigene Befehle', 'z.B. Programme oder Skripte beim Start ausführen'),
          listText('Befehle beim Start', D, 'customCommandsOnStart', 'Mehrere mit ; trennen'),
          listText('Befehle beim Beenden', D, 'customCommandsOnExit')
        ];
      }
    },
    {
      id: 'controller', title: 'Controller', rows: () => [
        group('Bluetooth', 'PS5-/PS4-Controller'),
        button('PS5-Controller verbinden …', () => App.btPair(), { desc: 'Entfernt nicht verbundene PS-Controller aus Windows und koppelt Controller im Kopplungsmodus (PS + Create gedrückt halten) – verbundene bleiben verbunden' }),
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
        group('Ohne Controller', 'Tastatur während eines Spiels'),
        { ...toggle('Tastenkürzel im Spiel', () => C().controller, 'keyboardShortcuts', 'Overlay und Spiel beenden per Tastatur – im Overlay: Pfeiltasten, Enter, Esc'), get: () => C().controller.keyboardShortcuts !== false },
        ...(C().controller.keyboardShortcuts !== false ? [
          { ...select('Overlay öffnen', () => C().controller, 'overlayKey', [
            { value: 'Shift+Tab', label: 'Shift+Tab' }, { value: 'Control+Shift+O', label: 'Strg+Shift+O' }, { value: 'Control+Alt+O', label: 'Strg+Alt+O' },
            { value: 'Alt+O', label: 'Alt+O' }, { value: 'F10', label: 'F10' }, { value: 'off', label: 'Aus' }
          ], 'Bei Steam-Spielen unter Windows gehört Shift+Tab dem Steam-Overlay – dort gilt dann Strg+Shift+O'), get: () => C().controller.overlayKey || 'Shift+Tab' },
          { ...select('Spiel beenden', () => C().controller, 'quitKey', [
            { value: 'Alt+F4|Control+Q', label: 'Alt+F4 oder Strg+Q' }, { value: 'Alt+F4', label: 'Alt+F4' }, { value: 'Control+Q', label: 'Strg+Q' },
            { value: 'Control+Shift+Q', label: 'Strg+Shift+Q' }, { value: 'off', label: 'Aus' }
          ], 'Beendet das laufende Spiel bzw. den Emulator sofort'), get: () => C().controller.quitKey || 'Alt+F4|Control+Q' }
        ] : []),
        group('Maus & Tastatur per Controller', 'z.B. für Launcher-Fenster, Logins, Browser'),
        select('Tastenkombination „Maussteuerung“', () => C().controller, 'mouseModeCombo', comboOptions(C().controller.mouseModeCombo), 'Ein-/Ausschalten – funktioniert überall in Windows'),
        button('Kombination „Maussteuerung“ aufnehmen …', () => recordCombo('mouseModeCombo')),
        { ...toggle('Maus mit dem Stick bewegen', () => C().controller, 'mouseStick', 'Aus: Die Maus bewegt sich nur über das PlayStation-Touchpad – der Stick bleibt frei'), get: () => C().controller.mouseStick !== false },
        select('Mausgeschwindigkeit', () => C().controller, 'mouseSpeed', [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: Math.round(v * 100) + ' %' }))),
        button('🖱 Maussteuerung jetzt einschalten', () => api.toggleMouseMode()),
        { type: 'info', label: 'Belegung', desc: `${C().controller.mouseStick === false ? 'Maus: Touchpad' : 'Linker Stick: Maus'} · Rechter Stick: Scrollen · ${Glyphs.label('A')}: Linksklick · ${Glyphs.label('B')}: Rechtsklick · ${Glyphs.label('X')}: Bildschirmtastatur (mit dem Controller tippen) · ${Glyphs.label('Y')}: Enter · Steuerkreuz: Pfeiltasten · ${Glyphs.label('LB')}: Alt+Tab · ${Glyphs.label('RB')}: Tab · ${Glyphs.label('LT')}: Rücktaste · ${Glyphs.label('RT')} halten: langsame Maus · ${Glyphs.label('START')}: Esc · ${Glyphs.label('LS')}: Mittelklick`, get: () => '' },
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
      id: 'systems', title: 'Konsolen & ROMs', rows: () => {
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
      id: 'emudl', title: 'Laden & Updates', rows: () => {
        if (!C().emuManager) C().emuManager = { autoUpdate: true, installed: {}, sources: [] };
        const M = () => C().emuManager;
        const list = S.emuList;
        const busy = S.emuBusy || {};
        const rows = [
          group('Emulatoren', App.os && App.os.os ? 'Flathub und Release-Seiten – per Knopfdruck' : 'Release-Seiten (GitHub, Forgejo …) – per Knopfdruck'),
          { ...toggle('Automatisch aktualisieren', M, 'autoUpdate', 'Installierte Emulatoren täglich auf neue Versionen prüfen und aktualisieren (nicht während eines Spiels)'), get: () => M().autoUpdate !== false },
          button('Nach Updates suchen', () => loadEmuList(true))
        ];
        if (!list) rows.push({ type: 'info', label: 'Lade Liste …', desc: 'Prüft installierte Versionen und die neuesten Releases', get: () => '' });
        else {
          const upd = list.filter((r) => r.installed && r.update);
          if (upd.length) rows.push(button(`Alle aktualisieren (${upd.length})`, async () => {
            App.toast('Aktualisiere Emulatoren …', 'info', 3000);
            try { const done = await api.emuMgrUpdateAll(); App.toast(done.length ? `✔ Aktualisiert: ${done.join(', ')}` : 'Nichts zu aktualisieren', 'ok', 6000); } catch (e) { App.toast(cleanErr(e), 'error', 8000); }
            loadEmuList(true);
          }));
          for (const r of list.filter((x) => !x.custom)) rows.push(emuRow(r, busy[r.id]));
          rows.push(group('Eigene Quellen', 'GitHub-, Forgejo- oder Codeberg-Repository bzw. Release-Seite'));
          for (const r of list.filter((x) => x.custom)) rows.push(emuRow(r, busy[r.id]));
        }
        rows.push(button('Eigene Quelle hinzufügen …', () => {
          const id = 'eigen-' + Date.now().toString(36);
          M().sources = [...(M().sources || []), { id, name: 'Neuer Emulator', url: '', asset: '', exe: '', args: '"{rom}"', prerelease: false }];
          openEmuSource(id);
        }));
        return rows;
      }
    },
    {
      id: 'remote', title: 'Fernzugriff', rows: () => {
        if (!C().tailscale) C().tailscale = { hostname: '' };
        const t = S.ts;
        const rows = [group('Tailscale', 'Sicherer Zugriff von unterwegs – auf diesen Rechner und deinen RomM-Server')];
        if (!t) rows.push({ type: 'info', label: 'Prüfe Tailscale …', desc: '', get: () => '' });
        else if (t.state === 'not-installed') {
          rows.push({ type: 'item', label: 'Tailscale ist nicht installiert', desc: App.os && App.os.os ? 'Sollte in AleGamestation OS enthalten sein – System aktualisieren' : 'Kostenlos von tailscale.com – danach hier verbinden', status: 'bad', statusText: 'fehlt', action: () => api.tailscaleDownload() });
          rows.push(button('Tailscale herunterladen', () => api.tailscaleDownload()));
        } else {
          const on = t.state === 'running';
          rows.push({ type: 'item', label: on ? `Verbunden als ${t.name || 'dieser Rechner'}` : t.state === 'no-daemon' ? 'Tailscale-Dienst läuft nicht' : 'Nicht verbunden',
            desc: on ? [t.ip, t.dns, t.user].filter(Boolean).join('  ·  ') : (t.error || 'Mit „Verbinden“ anmelden – per QR-Code mit dem Handy'),
            status: on ? 'ok' : 'off', statusText: on ? 'verbunden' : 'aus', action: () => refreshTs() });
          rows.push(on
            ? button('Trennen', async () => { try { await api.tailscaleDown(); App.toast('Tailscale getrennt', 'info'); } catch (e) { App.toast(cleanErr(e), 'error', 8000); } refreshTs(); })
            : button('Verbinden …', () => tailscaleConnect()));
          rows.push(text('Gerätename im Tailnet', () => C().tailscale, 'hostname', 'Leer = Rechnername – z.B. „alegamestation“. Gilt beim nächsten Verbinden'));
          if (on && t.peers && t.peers.length) {
            rows.push(group('Geräte im Tailnet', `${t.peers.filter((p) => p.online).length} online`));
            for (const p of t.peers.slice(0, 20)) {
              rows.push({ type: 'item', label: p.name, desc: [p.ip, p.dns, p.os].filter(Boolean).join('  ·  '), status: p.online ? 'ok' : 'off', statusText: p.online ? 'online' : 'offline',
                action: async () => {
                  if (!(await App.confirm(`${esc(p.name)} als RomM unterwegs?`, `Als „Adresse für unterwegs“ für RomM eintragen: http://${esc(p.dns || p.ip)}:8080 (Port bei Bedarf in den RomM-Einstellungen anpassen).`, 'Eintragen'))) return;
                  C().romm = C().romm || {};
                  C().romm.remoteUrl = `http://${p.dns || p.ip}:8080`;
                  await App.save({ immediate: true });
                  App.toast('Eingetragen – Einstellungen → RomM', 'ok', 5000);
                } });
            }
          }
          rows.push({ type: 'info', label: 'So nutzt du es', desc: 'Installiere Tailscale auch auf dem RomM-Server und deinem Handy/Laptop und melde dich mit demselben Konto an. Dann trägst du bei RomM die Tailscale-Adresse als „Adresse für unterwegs“ ein – AleGamestation nimmt sie automatisch, wenn das Heimnetz nicht erreichbar ist.', get: () => '' });
        }
        return rows;
      }
    },
    {
      id: 'romm', title: 'RomM', rows: () => {
        if (!C().romm) C().romm = { enabled: false, url: '', token: '', user: '', password: '', recommend: true, serverRow: true, platformMap: {} };
        const R = () => C().romm;
        const st = S.romm || {};
        const plats = S.rommPlatforms || [];
        const systems = C().systems.filter((x) => x.enabled !== false);
        const mapOpts = [{ value: 'auto', label: 'Automatisch' }, { value: 'none', label: 'Nicht verbinden' }]
          .concat(plats.map((p) => ({ value: 'p:' + p.id, label: `${p.name} (${p.rom_count})` })));
        const reload = async () => { S.rommPlatforms = await api.rommPlatforms().catch(() => []); render(); };
        return [
          group('Verbindung', st.version ? `RomM ${st.version}${st.user ? ' · ' + st.user : ''} · ${st.platforms} Plattformen · ${st.roms} Spiele` : 'Eigener ROM-Server im Heimnetz'),
          { ...toggle('RomM verwenden', R, 'enabled', 'Spiele vom Server auf den Konsolen-Seiten, Empfehlungen und Herunterladen'), rescan: false },
          text('Server-Adresse', R, 'url', 'z.B. http://192.168.1.20:8080 – so, wie du RomM im Browser öffnest'),
          text('Adresse für unterwegs (optional)', R, 'remoteUrl', 'z.B. über Tailscale: http://romm-server:8080 – wird automatisch genommen, wenn die Heimadresse nicht erreichbar ist'),
          text('Client-Token (empfohlen)', R, 'token', 'In RomM: Profil → Client-Tokens → neues Token mit „roms.read“ und „platforms.read“ (beginnt mit rmm_)', { secret: true }),
          text('Benutzername', R, 'user', 'Nur nötig ohne Client-Token'),
          text('Passwort', R, 'password', 'Nur nötig ohne Client-Token', { secret: true }),
          button('Verbindung testen', async () => {
            await App.save({ immediate: true });
            App.toast('Verbinde mit RomM …', 'info', 2000);
            try {
              S.romm = await api.rommTest();
              App.toast(`✔ RomM ${S.romm.version || ''} – ${S.romm.platforms} Plattformen, ${S.romm.roms} Spiele`, 'ok', 6000);
              await reload();
              App.rommRefresh && App.rommRefresh();
            } catch (e) { App.toast(cleanErr(e), 'error', 9000); }
          }),
          group('Anzeige'),
          { ...toggle('Empfehlungen auf der Startseite', R, 'recommend', 'Reihe „Empfohlen von RomM“ – Spiele, die du noch nicht hast'), get: () => R().recommend !== false },
          { ...toggle('Server-Spiele auf den Konsolen-Seiten', R, 'serverRow', 'Unter deinen Spielen: alles, was auf dem Server liegt – schon heruntergeladene sind markiert'), get: () => R().serverRow !== false },
          group('Konsolen-Zuordnung', plats.length ? 'Automatisch = über das Plattform-Kürzel' : '„Verbindung testen“ lädt die Plattformen'),
          ...(plats.length ? systems.map((sys) => ({
            type: 'select', label: sys.name, desc: `Downloads landen in ${(sys.romDirs || [])[0] || '(kein ROM-Ordner eingetragen)'}`, options: mapOpts,
            get: () => { const m = (R().platformMap || {})[sys.id]; return Array.isArray(m) && m.length ? 'p:' + m[0] : m === 'none' ? 'none' : 'auto'; },
            set: (v) => {
              R().platformMap = R().platformMap || {};
              if (v === 'auto') delete R().platformMap[sys.id];
              else if (v === 'none') R().platformMap[sys.id] = 'none';
              else R().platformMap[sys.id] = [Number(v.slice(2))];
            }
          })) : [])
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
          ...(hidden.length ? [group('Ausgeblendete Spiele', 'Update-/DLC-Dateien: Einstellungen → Emulatoren → Konsolen & ROMs → Konsole')] : []),
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

  // ---------- Emulatoren laden ----------
  async function loadEmuList(online = true) {
    if (online) S.emuList = S.emuList || null;
    try { S.emuList = await api.emuMgrList({ checkOnline: online }); } catch (e) { App.toast(cleanErr(e), 'error', 6000); S.emuList = S.emuList || []; }
    if (SECTIONS[S.section].id === 'emudl') render();
  }
  const fmtMB = (b) => (b ? (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB') : '');
  function emuRow(r, step) {
    const state = step ? step : r.installed ? (r.update ? `Update: ${r.latest || 'neu'}` : r.version ? r.version : 'installiert') : r.error ? 'nicht erreichbar' : 'nicht installiert';
    const desc = [r.console, r.installed ? `installiert${r.version ? ' ' + r.version : ''}` : r.latest ? `neueste: ${r.latest}${r.size ? ' · ' + fmtMB(r.size) : ''}` : '', r.kind === 'flatpak' ? 'Flathub' : r.source, r.error && !r.installed ? r.error : ''].filter(Boolean).join('  ·  ');
    return {
      type: 'item', label: r.name, desc, status: step ? 'off' : r.installed ? (r.update ? 'off' : 'ok') : r.error ? 'bad' : '', statusText: state,
      action: () => emuMenu(r)
    };
  }
  function emuMenu(r) {
    const doInstall = async () => {
      App.closeMenu();
      App.toast(`${r.installed ? 'Aktualisiere' : 'Installiere'} ${r.name} …`, 'info', 3000);
      try { await api.emuMgrInstall(r.id); App.toast(`✔ ${r.name} ${r.installed ? 'aktualisiert' : 'installiert'}`, 'ok', 5000); } catch (e) { App.toast(cleanErr(e), 'error', 9000); }
      loadEmuList(false);
    };
    const items = [];
    if (!r.installed) items.push({ label: 'Installieren', icon: 'download', hint: r.latest || '', action: doInstall });
    else {
      items.push({ label: r.update ? `Aktualisieren auf ${r.latest || 'neue Version'}` : 'Neu installieren / aktualisieren', icon: 'refresh', action: doInstall });
      items.push({ label: 'Entfernen', icon: 'trash', action: async () => {
        App.closeMenu();
        if (!(await App.confirm(`${r.name} entfernen?`, 'Die Programmdateien werden gelöscht. Spielstände und Einstellungen des Emulators bleiben normalerweise erhalten.', 'Entfernen'))) return;
        try { await api.emuMgrRemove(r.id); App.toast(`${r.name} entfernt`, 'info', 4000); } catch (e) { App.toast(cleanErr(e), 'error', 8000); }
        loadEmuList(false);
      } });
    }
    if (r.custom) items.push({ label: 'Quelle bearbeiten …', icon: 'settings', action: () => { App.closeMenu(); openEmuSource(r.id); } });
    App.menu({ title: r.name, text: [r.console, r.kind === 'flatpak' ? 'Quelle: Flathub' : `Quelle: ${esc(r.source || '')}`].filter(Boolean).join('<br>'), items });
  }
  function openEmuSource(id) {
    openDetail(() => {
      const list = C().emuManager.sources || [];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const o = () => C().emuManager.sources[i];
      const emuOpts = [{ value: o().id, label: 'Eigener Eintrag' }].concat(C().emulators.map((e) => ({ value: e.id, label: e.name })));
      return {
        title: o().name || 'Eigene Quelle',
        rows: [
          text('Name', o, 'name', 'z.B. Ryujinx'),
          text('Adresse', o, 'url', 'Repository oder Release-Seite, z.B. https://github.com/name/projekt oder https://git.eden-emu.dev/eden-emu/eden'),
          text('Dateifilter (optional)', o, 'asset', 'Welche Datei aus dem Release: Platzhalter * erlaubt, z.B. *linux*x86_64*.AppImage – leer = automatisch'),
          text('Startdatei (optional)', o, 'exe', 'Bei ZIP/Archiven: Name der .exe bzw. des Programms, z.B. Ryujinx.exe'),
          text('Start-Argumente', o, 'args', 'Platzhalter {rom} – z.B. -f "{rom}"'),
          { ...select('Als Emulator', o, 'emu', emuOpts, 'Vorhandenen Emulator-Eintrag aktualisieren oder neuen anlegen'), get: () => o().emu || o().id },
          toggle('Vorabversionen verwenden', o, 'prerelease', 'Auch „Pre-Release“-Versionen laden (manche Projekte veröffentlichen nur solche)'),
          button('Quelle prüfen', async () => {
            await App.save({ immediate: true });
            try { const r = await api.emuMgrTest({ url: o().url, asset: o().asset, prerelease: o().prerelease }); App.toast(`✔ ${r.version}: ${r.name}${r.size ? ' (' + fmtMB(r.size) + ')' : ''}`, 'ok', 8000); } catch (e) { App.toast(cleanErr(e), 'error', 9000); }
          }),
          button('Jetzt installieren', async () => {
            await App.save({ immediate: true });
            App.toast(`Installiere ${o().name} …`, 'info', 3000);
            try { await api.emuMgrInstall(o().id); App.toast(`✔ ${o().name} installiert`, 'ok', 5000); } catch (e) { App.toast(cleanErr(e), 'error', 9000); }
            loadEmuList(false);
          }),
          button('Quelle löschen', async () => {
            if (!(await App.confirm('Quelle löschen?', 'Die Quelle wird aus der Liste entfernt. Ein bereits installierter Emulator bleibt erhalten.', 'Löschen'))) return;
            C().emuManager.sources.splice(i, 1);
            await commit(false);
            closeDetail();
            loadEmuList(false);
          }, { danger: true })
        ]
      };
    });
  }

  // ---------- Tailscale ----------
  async function refreshTs() {
    try { S.ts = await api.tailscaleStatus(); } catch (e) { S.ts = { state: 'stopped', error: cleanErr(e) }; }
    if (App.view === 'settings' && SECTIONS[S.section].id === 'remote' && !S.detail) render();
  }
  async function tailscaleConnect() {
    App.toast('Verbinde mit Tailscale …', 'info', 3000);
    let shown = false;
    const offLogin = api.onTailscaleLogin((l) => {
      shown = true;
      App.menu({
        title: 'Bei Tailscale anmelden',
        text: `${l.qr ? `<div style="text-align:center"><img src="${esc(l.qr)}" alt="QR-Code" style="width:240px;height:240px;image-rendering:pixelated;background:#fff;padding:10px;border-radius:12px"></div>` : ''}
          QR-Code mit dem Handy scannen oder auf einem anderen Gerät öffnen:<br><b style="user-select:all">${esc(l.url)}</b><br><small>Die Seite schließt sich nach der Anmeldung von selbst.</small>`,
        items: [{ label: 'Abbrechen', icon: 'x', action: () => App.closeMenu() }]
      });
    });
    const offConn = api.onTailscaleConnected(() => { if (shown) App.closeMenu(); });
    try {
      await api.tailscaleUp();
      App.toast('✔ Mit Tailscale verbunden', 'ok', 5000);
    } catch (e) { App.toast(cleanErr(e), 'error', 9000); }
    if (shown && App.modalStack.length) App.closeMenu();
    if (offLogin) offLogin();
    if (offConn) offConn();
    refreshTs();
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
  // ---------- Kategorien (Kachel-Übersicht) ----------
  const CATEGORIES = [
    { id: 'system', title: 'System', icon: 'settings', desc: 'Start, Updates, Leistung', sections: ['general', 'performance', 'about'] },
    { id: 'display', title: 'Bild & Ton', icon: 'monitor', desc: 'Fernseher, Bildschirme, Tonausgabe', sections: ['display'] },
    { id: 'controller', title: 'Controller', icon: 'gamepad', desc: 'Tasten, Overlay, Maus & Tastatur', sections: ['controller'] },
    { id: 'emulation', title: 'Emulatoren', icon: 'grid', desc: 'Konsolen, Emulatoren, Downloads & Updates', sections: ['systems', 'emulators', 'emudl'] },
    { id: 'library', title: 'Bibliothek', icon: 'list', desc: 'Eigene Spiele, Steam & Stores, Cover, RomM', sections: ['games', 'stores', 'media', 'romm'] },
    { id: 'services', title: 'Verbindungen', icon: 'plug', desc: 'Home Assistant, Spotify, Clips, Fernzugriff', sections: ['ha', 'spotify', 'aleclip', 'remote'] }
  ];
  const secIndex = (id) => SECTIONS.findIndex((x) => x.id === id);
  const catOf = (secIdx) => CATEGORIES.find((c) => c.sections.includes((SECTIONS[secIdx] || {}).id)) || CATEGORIES[0];
  const catSections = (c) => c.sections.map(secIndex).filter((i) => i >= 0);

  /** Kurzer Zustand pro Kachel */
  function catStatus(c) {
    const cf = C();
    switch (c.id) {
      case 'system': return S.update && S.update.available ? `Update ${S.update.available} verfügbar` : `Version ${(S.update && S.update.version) || ''}`.trim();
      case 'display': return cf.display && cf.display.tv ? `Fernseher: ${cf.display.tv.name}` : 'Kein Fernseher gewählt';
      case 'controller': return cf.controller && cf.controller.playstationHid !== false ? 'PlayStation-Controller direkt' : 'Xbox / Steam Input';
      case 'emulation': {
        const sys = (cf.systems || []).filter((x) => x.enabled !== false).length;
        const upd = (S.emuList || []).filter((r) => r.installed && r.update).length;
        return `${sys} Konsolen · ${(cf.emulators || []).length} Emulatoren${upd ? ` · ${upd} Update${upd > 1 ? 's' : ''}` : ''}`;
      }
      case 'library': return [cf.romm && cf.romm.enabled ? 'RomM an' : '', `${(cf.pcGames || []).length} eigene Spiele`].filter(Boolean).join(' · ');
      case 'services': {
        const on = [cf.homeassistant && cf.homeassistant.enabled ? 'Home Assistant' : '', S.spotify && S.spotify.connected ? 'Spotify' : '', S.ts && S.ts.state === 'running' ? 'Tailscale' : ''].filter(Boolean);
        return on.length ? on.join(' · ') : 'Nichts verbunden';
      }
      default: return '';
    }
  }

  function renderTabs() {
    const t = $('#settingsTabs');
    const crumb = $('#settingsCrumb');
    t.innerHTML = '';
    if (S.overview) {
      t.classList.add('hidden');
      if (crumb) crumb.innerHTML = '';
      return;
    }
    const home = document.querySelector('#settingsTitle .st-home');
    if (home && !home.onclick) home.onclick = () => { if (!S.overview) openOverview(); };
    const cat = catOf(S.section);
    if (crumb) {
      crumb.innerHTML = `<span class="sc-sep">${Icons.svg('chevron')}</span><span class="sc-cat">${Icons.svg(cat.icon)}${esc(cat.title)}</span>`;
    }
    const secs = catSections(cat);
    t.classList.toggle('hidden', secs.length < 2);
    secs.forEach((i) => {
      const e = document.createElement('div');
      e.className = 'tab' + (i === S.section ? ' active' : '');
      e.textContent = SECTIONS[i].title;
      e.onclick = () => { S.section = i; S.focus = 0; S.detail = null; render(); };
      t.appendChild(e);
    });
  }

  function renderOverview(body) {
    body.classList.add('overview');
    const focusables = [];
    const grid = document.createElement('div');
    grid.className = 's-tiles';
    CATEGORIES.forEach((c, ci) => {
      const tile = document.createElement('div');
      tile.className = 's-tile';
      tile.style.setProperty('--d', `${ci * 35}ms`);
      tile.innerHTML = `<div class="st-icon">${Icons.svg(c.icon)}</div><div class="st-text"><b>${esc(c.title)}</b><small>${esc(c.desc)}</small></div>
        <div class="st-status">${esc(catStatus(c))}</div>
        <div class="st-subs">${catSections(c).map((i) => `<span>${esc(SECTIONS[i].title)}</span>`).join('')}</div>`;
      const idx = focusables.length;
      const r = { type: 'tile', el: tile, cat: c, action: () => openCategory(c) };
      tile.onclick = () => { S.focus = idx; updateFocus(true); openCategory(c); };
      tile.onmouseenter = () => { if (S.focus !== idx) { S.focus = idx; (S.focusables || []).forEach((x, i) => x.el.classList.toggle('focused', i === idx)); } };
      focusables.push(r);
      grid.appendChild(tile);
    });
    body.appendChild(grid);
    return focusables;
  }

  function openCategory(c) {
    Sounds.play('accept');
    const first = catSections(c)[0];
    S.overview = false;
    S.section = first;
    S.focus = 0;
    S.detail = null;
    S.overviewFocus = CATEGORIES.indexOf(c);
    render();
  }
  function openOverview() {
    S.overview = true;
    S.detail = null;
    S.focus = Math.max(0, S.overviewFocus || CATEGORIES.indexOf(catOf(S.section)));
    Sounds.play('back');
    render();
  }
  /** Kacheln: Spalten für die Steuerkreuz-Navigation */
  function tileCols() {
    const tiles = (S.focusables || []).map((x) => x.el);
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    const n = tiles.findIndex((t) => t.offsetTop !== top);
    return n < 0 ? tiles.length : n;
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
    const bodyEl = $('#settingsBody');
    bodyEl.classList.toggle('overview', !!S.overview);
    if (S.overview) {
      S.detail = null;
      S.lastPage = 'overview';
      bodyEl.classList.remove('detail');
      bodyEl.innerHTML = '';
      S.focusables = renderOverview(bodyEl);
      S.rows = S.focusables;
      S.focus = Math.min(S.focus, S.focusables.length - 1);
      updateFocus(true, true);
      App.renderHints();
      return;
    }
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
    // Zeilen in Karten gruppieren: jede Gruppe (Überschrift) beginnt eine neue Karte
    let card = null;
    const target = () => {
      if (!card) { card = document.createElement('div'); card.className = 's-card'; body.appendChild(card); }
      return card;
    };
    S.rows.forEach((r) => {
      if (r.type === 'crumb') {
        const c = document.createElement('div');
        c.className = 's-crumb';
        c.innerHTML = `<span>${esc(r.label)}</span><span class="sep">${Icons.svg('chevron')}</span><b>${esc(r.title)}</b>${r.extra ? `<small>${esc(r.extra)}</small>` : ''}`;
        body.appendChild(c);
        return;
      }
      if (r.type === 'preview') {
        const pv = document.createElement('div');
        pv.className = 's-preview';
        pv.innerHTML = r.html;
        body.appendChild(pv);
        return;
      }
      if (r.type === 'group') {
        card = null;
        const g = document.createElement('div');
        g.className = 's-group';
        g.innerHTML = `<span>${esc(r.label)}</span>${r.extra ? `<span>${esc(r.extra)}</span>` : ''}`;
        target().appendChild(g);
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
      // „Zurück“-Knopf der Detailseite und Info-Zeilen ohne Gruppe stehen frei
      if (r.type === 'button' && /^‹ Zurück/.test(r.label)) { card = null; body.appendChild(row); } else target().appendChild(row);
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
        const p = r.kind === 'folder' ? await api.pickFolder() : r.kind === 'image' ? await App.pickImage() : await api.pickFile();
        if (p) { r.set(p); await commit(!!r.rescan); }
      }
    }
  }

  window.SettingsView = {
    async open(sectionId) {
      if (sectionId) { S.section = Math.max(0, SECTIONS.findIndex((s) => s.id === sectionId)); S.focus = 0; S.detail = null; S.overview = false; } else { S.overview = true; S.detail = null; S.focus = S.overviewFocus || 0; }
      try { S.displays = await api.listDisplays(); } catch { S.displays = []; }
      try { S.audio = await api.listAudio(); } catch { S.audio = []; }
      S.tv = null;
      api.tvStatus().then((t) => { S.tv = t; if (SECTIONS[S.section].id === 'display' && !S.detail) render(); }).catch(() => {});
      try { S.spotify = await api.spotifyStatus(); } catch { S.spotify = {}; }
      try { S.aleclip = await api.aleclipStatus(); } catch { S.aleclip = {}; }
      if (api.emuMgrList && !S.emuList) loadEmuList(true);
      if (api.tailscaleStatus) refreshTs();
      if (api.onEmuMgrProgress && !S.emuProgressHooked) {
        S.emuProgressHooked = true;
        api.onEmuMgrProgress((p) => {
          S.emuBusy = S.emuBusy || {};
          if (p.step) S.emuBusy[p.id] = p.total ? `${p.step} ${Math.floor((p.received / p.total) * 100)} %` : p.step; else delete S.emuBusy[p.id];
          if (App.view === 'settings' && SECTIONS[S.section].id === 'emudl' && !S.detail) render();
        });
      }
      if (C().romm && C().romm.enabled && C().romm.url && !S.rommPlatforms) api.rommPlatforms().then((p) => { S.rommPlatforms = p; if (SECTIONS[S.section].id === 'romm') render(); }).catch(() => {});
      try { S.update = await api.updateState(); } catch { S.update = {}; }
      render();
    },
    handle(a) {
      if (S.overview) {
        const n = S.focusables.length; const cols = tileCols();
        const move = (to) => { if (to >= 0 && to < n && to !== S.focus) { S.focus = to; updateFocus(); Sounds.play('move'); } };
        switch (a) {
          case 'left': move(S.focus - 1); break;
          case 'right': move(S.focus + 1); break;
          case 'up': move(S.focus - cols); break;
          case 'down': move(Math.min(n - 1, S.focus + cols)); break;
          case 'accept': S.focusables[S.focus] && S.focusables[S.focus].action(); break;
          case 'back': case 'select': Sounds.play('back'); App.backToLibrary(); App.pushForward(() => App.openSettings()); break;
        }
        return;
      }
      const secs = catSections(catOf(S.section));
      const pos = secs.indexOf(S.section);
      switch (a) {
        case 'up': if (S.focus > 0) { S.focus--; updateFocus(); Sounds.play('move'); } break;
        case 'down': if (S.focus < S.focusables.length - 1) { S.focus++; updateFocus(); Sounds.play('move'); } break;
        // L1/R1: Unterseiten der Kategorie wechseln
        case 'lb': if (secs.length > 1) { S.detail = null; S.section = secs[(pos + secs.length - 1) % secs.length]; S.focus = 0; render(); Sounds.play('tab'); } break;
        case 'rb': if (secs.length > 1) { S.detail = null; S.section = secs[(pos + 1) % secs.length]; S.focus = 0; render(); Sounds.play('tab'); } break;
        case 'back': if (!closeDetail()) { const sec = SECTIONS[S.section].id; openOverview(); App.pushForward(() => App.openSettings(sec)); } else Sounds.play('back'); break;
        case 'select': Sounds.play('back'); S.detail = null; App.backToLibrary(); break;
        default: act(a);
      }
    },
    refreshUpdate,
    rerender: () => render(),
    hints(hint, glyph) {
      if (S.overview) return hint(glyph('A'), 'Öffnen') + hint(Glyphs.arrows(), 'Auswählen') + hint(glyph('LT') + glyph('RT'), 'Kategorie') + hint(glyph('B'), 'Zurück');
      const multi = catSections(catOf(S.section)).length > 1;
      return hint(glyph('A'), S.detail ? 'Ändern' : 'Öffnen / Ändern') + hint(Glyphs.arrows(), 'Wert') + (multi ? hint(glyph('LB') + glyph('RB'), 'Seite') : '') + hint(glyph('LT') + glyph('RT'), 'Kategorie') + hint(glyph('B'), S.detail ? 'Zurück' : 'Übersicht');
    }
  };
})();
