/* AleGamestation – Oberfläche */
(function () {
  const api = window.api;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const glyph = (k) => Glyphs.html(k);

  const App = {
    cfg: null,
    library: { systems: [], games: [], emulators: [] },
    tabs: [],
    tabIndex: 0,
    view: 'home',
    sections: [],
    focus: { s: 0, i: 0 },
    emuSystemIndex: 0,
    running: null,
    modalStack: []
  };
  window.App = App;

  // ---------------- Hilfen ----------------
  function fmtPlaytime(ms) {
    if (!ms) return '';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} Min. gespielt`;
    return `${(min / 60).toFixed(1).replace('.', ',')} Std. gespielt`;
  }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days === 0) return 'Heute gespielt';
    if (days === 1) return 'Gestern gespielt';
    if (days < 7) return `Vor ${days} Tagen gespielt`;
    return `Zuletzt ${d.toLocaleDateString('de-DE')}`;
  }
  function systemOf(id) {
    return App.library.systems.find((s) => s.id === id) || { id, name: id, short: id, color: '#444' };
  }
  function visibleGames() {
    return App.library.games.filter((g) => !g.hidden);
  }
  function isFav(id) {
    return (App.cfg.favorites || []).includes(id);
  }
  function gameById(id) {
    return App.library.games.find((g) => g.id === id);
  }

  /** Bekanntes Emulator-Profil zu einer .exe (Name, empfohlene Start-Argumente, Vollbild) */
  App.emuProfiles = [];
  App.emuProfile = function (exe) {
    const base = String(exe || '').split(/[\\/]/).pop();
    return App.emuProfiles.find((p) => new RegExp(p.match, 'i').test(base)) || null;
  };
  /** Neuen Emulator-Eintrag aus einer .exe erstellen – mit passendem Namen und Start-Argumenten */
  App.newEmulator = function (exe) {
    const p = App.emuProfile(exe);
    const id = 'emu-' + Date.now();
    const name = p ? p.name : exe.split(/[\\/]/).pop().replace(/\.exe$/i, '');
    const args = p && !/CORE_libretro/.test(p.args) ? p.args : '"{rom}"';
    App.cfg.emulators.push({ id, name, exe, args });
    return id;
  };

  /** Debug-Modus: Eintrag ins Protokoll (nur wenn eingeschaltet) */
  App.debug = false;
  App.log = function (source, message, data, level = 'info') {
    if (!App.debug || !api.debugLog) return;
    api.debugLog({ level, source, message, data }).catch(() => {});
  };
  function debugContext() {
    const tab = App.tabs && App.tabs[App.tabIndex];
    const sec = App.sections && App.sections[App.focus.s];
    const item = sec && sec.items && sec.items[App.focus.i];
    return {
      view: App.view, tab: tab && tab.id, modal: App.modalStack.length, bereich: sec && sec.title, pos: `${App.focus.s}/${App.focus.i}`,
      auswahl: item && (item.kind === 'game' ? item.game.name : item.kind === 'system' ? item.system.name : item.kind || '')
    };
  }
  async function refreshDebug() {
    let st = { enabled: false };
    try { st = await api.debugState(); } catch { /* ältere Version */ }
    App.debug = !!st.enabled;
    const b = $('#debugBadge');
    b.classList.toggle('hidden', !App.debug);
    b.classList.toggle('bad', !!st.errors);
    b.textContent = st.errors ? `DEBUG · ${st.errors} Fehler` : 'DEBUG';
  }
  App.debugReport = async function () {
    App.toast('Erstelle Debug-Bericht …', 'info', 2000);
    try {
      const file = await api.debugReport();
      App.toast(`Bericht auf dem Desktop gespeichert: ${file.split(/[\\/]/).pop()}`, 'ok', 8000);
    } catch (e) { App.toast(String(e.message || e), 'error', 6000); }
  };

  App.toast = function (text, type = 'info', ms = 3200) {
    if (type === 'error') App.log('meldung', text, debugContext(), 'error');
    const { icon, text: rest } = Icons.fromLabel(text);
    const ico = icon || (type === 'ok' ? 'check' : type === 'error' ? 'warning' : '');
    const t = el('div', 'toast ' + type, (ico ? Icons.svg(ico) : '') + `<span>${esc(icon ? rest : text)}</span>`);
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), ms);
  };

  let saveTimer = null;
  App.save = function (opts = {}) {
    clearTimeout(saveTimer);
    return new Promise((resolve) => {
      saveTimer = setTimeout(async () => {
        App.cfg = await api.saveConfig(App.cfg);
        applyConfig();
        if (opts.rescan) await App.refreshLibrary();
        resolve();
      }, opts.immediate ? 0 : 250);
    });
  };

  App.refreshLibrary = async function () {
    App.library = await api.refreshLibrary();
    buildTabs();
    if (App.view === 'home') renderHome();
  };

  function applyConfig() {
    ConsoleIcons.usePhotos(App.cfg.general.consolePhotos);
    const g = App.cfg.general;
    document.documentElement.style.setProperty('--accent', g.accentColor || '#7c5cff');
    document.documentElement.dataset.theme = g.theme || 'midnight';
    Input.configure({ rightClickBack: g.rightClickBack !== false });
    document.documentElement.style.setProperty('--scale', g.uiScale || 1);
    Sounds.setTheme(g.uiSounds === false ? 'off' : g.soundTheme || 'modern');
    Sounds.setVolume(g.soundVolume ?? 0.7);
    Input.configure({ swapAB: App.cfg.controller.swapAB, analog: App.cfg.controller.useAnalogStick });
    Glyphs.configure({ style: App.cfg.controller.glyphStyle || 'auto', swapAB: App.cfg.controller.swapAB });
    refreshGlyphs();
    $('#clock').classList.toggle('hidden', !g.showClock);
  }

  // ---------------- Tabs ----------------
  function buildTabs() {
    const L = App.library;
    const tabs = [{ id: 'home', label: 'Start' }];
    for (const s of L.systems.filter((x) => x.kind === 'store')) tabs.push({ id: 'store:' + s.id, label: s.short, system: s.id });
    if (!tabs.some((t) => t.system === 'pc')) tabs.push({ id: 'store:pc', label: 'Eigene', system: 'pc' });
    tabs.push({ id: 'emulators', label: 'Emulatoren' }); // immer da – auch ohne eingerichtete Konsolen
    tabs.push({ id: 'all', label: 'Alle Spiele' });
    tabs.push({ id: 'settings', label: 'Einstellungen', icon: 'settings' });
    const prev = App.tabs[App.tabIndex] && App.tabs[App.tabIndex].id;
    App.tabs = tabs;
    const idx = tabs.findIndex((t) => t.id === prev);
    App.tabIndex = idx >= 0 ? idx : 0;
    renderTabs();
  }

  function renderTabs() {
    const list = $('#tabList');
    list.innerHTML = '';
    App.tabs.forEach((t, i) => {
      const e = el('div', 'tab' + (i === App.tabIndex ? ' active' : ''), (t.icon ? Icons.svg(t.icon) + ' ' : '') + esc(t.label));
      e.onclick = () => switchTab(i);
      list.appendChild(e);
    });
    const active = list.children[App.tabIndex];
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function switchTab(i) {
    if (!App._navigatingForward) App.forwardStack = [];
    App.tabIndex = (i + App.tabs.length) % App.tabs.length;
    renderTabs();
    const tab = App.tabs[App.tabIndex];
    if (tab.id === 'settings') {
      showView('settings');
      SettingsView.open();
    } else {
      showView('home');
      App.focus = { s: 0, i: 0 };
      renderHome();
    }
    Sounds.play('tab');
  }

  function showView(v) {
    App.view = v;
    document.querySelectorAll('.view').forEach((x) => x.classList.toggle('active', x.id === v));
    renderHints();
    if (App.updateNavBack) App.updateNavBack();
  }

  // ---------------- Bibliothek: Abschnitte ----------------
  /** Abschnitt: { title, layout: 'strip'|'grid'|'systems', items: [ {kind:'game'|'action'|'system', ...} ] } */
  // ---------- Sortieren & Filtern (Raster-Ansichten) ----------
  const SORTS = [
    { value: 'name', label: 'A–Z' }, { value: 'recent', label: 'Zuletzt gespielt' },
    { value: 'playtime', label: 'Meiste Spielzeit' }, { value: 'system', label: 'Nach Konsole' }
  ];
  const FILTERS = [
    { value: 'all', label: 'Alle Spiele' }, { value: 'favorites', label: 'Nur Favoriten' },
    { value: 'played', label: 'Schon gespielt' }, { value: 'unplayed', label: 'Noch nicht gespielt' }
  ];
  const sortMode = () => App.cfg.general.sortMode || 'name';
  const filterMode = () => App.cfg.general.filterMode || 'all';
  function arrange(list) {
    const pt = App.cfg.playtime || {};
    const lp = App.cfg.lastPlayed || {};
    const favs = new Set(App.cfg.favorites || []);
    const f = filterMode();
    let out = list.filter((g) => (f === 'favorites' ? favs.has(g.id) : f === 'played' ? (pt[g.id] || lp[g.id]) : f === 'unplayed' ? !(pt[g.id] || lp[g.id]) : true));
    const byName = (a, b) => a.name.localeCompare(b.name, 'de');
    const m = sortMode();
    if (m === 'recent') out = out.sort((a, b) => (lp[b.id] || 0) - (lp[a.id] || 0) || byName(a, b));
    else if (m === 'playtime') out = out.sort((a, b) => (pt[b.id] || 0) - (pt[a.id] || 0) || byName(a, b));
    else if (m === 'system') out = out.sort((a, b) => systemOf(a.system).name.localeCompare(systemOf(b.system).name, 'de') || byName(a, b));
    else out = out.sort(byName);
    return out;
  }
  function arrangeLabel() {
    const s = SORTS.find((x) => x.value === sortMode());
    const f = FILTERS.find((x) => x.value === filterMode());
    return `  ·  ${s ? s.label : ''}${filterMode() !== 'all' && f ? ' · ' + f.label : ''}`;
  }
  /** Menü „Sortieren & Filtern“ (gilt für Steam/Epic/GOG/Eigene, Alle Spiele und die Spiele einer Konsole) */
  function arrangeMenu() {
    const apply = async () => { const keep = App.focus.s; await App.save({ immediate: true }); renderHome(); setFocus(Math.min(keep, App.sections.length - 1), 0, true); };
    App.menu({
      title: 'Sortieren & Filtern',
      text: 'Gilt für alle Spiele-Raster und wird gemerkt.',
      items: [
        { type: 'select', label: 'Sortieren', icon: 'list', options: SORTS, value: sortMode(), onChange: (v) => { App.cfg.general.sortMode = v; apply(); } },
        { type: 'select', label: 'Anzeigen', icon: 'eye', options: FILTERS, value: filterMode(), onChange: (v) => { App.cfg.general.filterMode = v; apply(); } },
        { label: 'Fertig', icon: 'check', action: () => App.closeMenu() }
      ]
    });
  }
  App.arrangeMenu = arrangeMenu;

  function buildSections() {
    const tab = App.tabs[App.tabIndex];
    const games = visibleGames();
    const gi = (g) => ({ kind: 'game', game: g });
    const secs = [];

    if (tab.id === 'home') {
      const recent = (App.cfg.recent || []).map(gameById).filter((g) => g && !g.hidden).slice(0, 15);
      const favs = (App.cfg.favorites || []).map(gameById).filter((g) => g && !g.hidden);
      if (recent.length) secs.push({ title: 'Zuletzt gespielt', layout: 'strip', wide: true, items: recent.map(gi) });
      if (favs.length) secs.push({ title: 'Favoriten', layout: 'strip', items: favs.map(gi) });
      for (const s of App.library.systems) {
        const list = games.filter((g) => g.system === s.id);
        if (!list.length) continue;
        const title = s.kind === 'emulator' ? `${s.name}  ·  ${s.emulatorName}` : s.name;
        secs.push({ title, layout: 'strip', items: list.slice(0, 30).map(gi), more: list.length > 30 ? list.length : 0 });
      }
    } else if (tab.id.startsWith('store:')) {
      const items = arrange(games.filter((g) => g.system === tab.system)).map(gi);
      if (tab.system === 'steam' && App.cfg.steam.showBigPictureTile) items.unshift({ kind: 'action', id: 'bigpicture', title: 'Steam Big Picture', sub: 'öffnen', icon: 'play' });
      if (tab.system === 'pc') items.unshift({ kind: 'action', id: 'addGame', title: 'Spiel hinzufügen', sub: '.exe / Verknüpfung', icon: 'plus' });
      secs.push({ title: systemOf(tab.system).name + arrangeLabel(), layout: 'grid', items, letterJump: sortMode() === 'name', emptyText: filterMode() !== 'all' ? 'Keine Spiele für diesen Filter – ☰ Menü → Sortieren & Filtern' : '' });
    } else if (tab.id === 'emulators') {
      const systems = emuTabSystems();
      const open = App.emuOpen && App.library.systems.find((x) => x.id === App.emuOpen);
      if (!open) {
        App.emuOpen = null;
        // Übersicht: alle Konsolen nebeneinander im Raster
        const sysItems = systems.map((x) => ({ kind: 'system', system: x }));
        sysItems.push({ kind: 'action', id: 'addSystem', title: 'Konsole hinzufügen', sub: 'Emulator + ROM-Ordner', icon: 'plus' });
        secs.push({ title: `Konsolen & Emulatoren  ·  ${systems.length}`, layout: 'grid', cls: 'sysgrid', items: sysItems });
      } else if (open.standalone) {
        secs.push({ title: `${open.name} – noch keiner Konsole zugeordnet`, layout: 'grid', console: open,
          items: [{ kind: 'action', id: 'sysMenu', title: open.short, sub: 'Als Konsole einrichten / starten', icon: 'settings' }],
          emptyText: '' });
      } else {
        // Spieleseite einer Konsole
        const list = arrange(games.filter((g) => g.system === open.id)).map(gi);
        list.unshift({ kind: 'action', id: 'sysMenu', title: open.short, sub: 'Emulator starten, Ordner, Bilder …', icon: 'settings' });
        secs.push({
          title: `${open.name}  ·  ${list.length - 1} Spiele${arrangeLabel()}`, layout: 'grid', console: open, items: list, letterJump: sortMode() === 'name',
          emptyText: ''
        });
        if (list.length === 1) secs[0].note = open.emulatorFound ? `Keine ROMs gefunden. Über „${open.short}“ den ROM-Ordner öffnen oder hinzufügen.` : `Emulator „${open.emulatorName}“ wurde nicht gefunden – Pfad in Einstellungen → Emulatoren eintragen.`;
      }
    } else if (tab.id === 'all') {
      const list = arrange(games);
      secs.push({ title: `Alle Spiele (${list.length})${arrangeLabel()}`, layout: 'grid', items: list.map(gi), letterJump: sortMode() === 'name' });
    }
    return secs;
  }

  /** Konsolen/Emulatoren im Emulator-Tab: eigene Reihenfolge, ausgeblendete weggelassen */
  function emuTab() {
    if (!App.cfg.emulatorTab) App.cfg.emulatorTab = { order: [], hidden: [] };
    return App.cfg.emulatorTab;
  }
  function emuTabSystems(includeHidden = false) {
    const t = emuTab();
    const all = App.library.systems.filter((s) => s.kind === 'emulator');
    const pos = (id) => { const i = (t.order || []).indexOf(id); return i < 0 ? 1e6 + all.findIndex((x) => x.id === id) : i; };
    return all.filter((s) => includeHidden || !(t.hidden || []).includes(s.id)).sort((a, b) => pos(a.id) - pos(b.id));
  }
  App.emuTabSystems = emuTabSystems;

  /** Verschiebe-Modus: Konsole mit ◀ ▶ an eine andere Stelle schieben */
  function startMoveSystem(s) {
    App.closeMenu();
    App.moveSystem = s.id;
    App.emuOpen = null;
    renderHome();
    setFocus(0, Math.max(0, emuTabSystems().findIndex((x) => x.id === s.id)), true);
    App.toast(`${s.short}: mit ◀ ▶ verschieben, bestätigen zum Ablegen`, 'info', 4000);
  }
  async function moveSystemStep(dir) {
    const list = emuTabSystems(true).map((x) => x.id);
    const visible = emuTabSystems().map((x) => x.id);
    const from = visible.indexOf(App.moveSystem);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= visible.length) return false;
    // In der vollständigen Liste (inkl. ausgeblendeter) mit dem sichtbaren Nachbarn tauschen
    const a = list.indexOf(visible[from]); const b = list.indexOf(visible[to]);
    [list[a], list[b]] = [list[b], list[a]];
    emuTab().order = list;
    renderHome();
    setFocus(0, to, true);
    return true;
  }
  async function endMoveSystem() {
    App.moveSystem = null;
    renderHome();
    await App.save({ immediate: true });
    App.toast('Reihenfolge gespeichert', 'ok', 1500);
  }
  async function hideSystem(s) {
    App.closeMenu();
    const t = emuTab();
    t.hidden = [...new Set([...(t.hidden || []), s.id])];
    App.emuOpen = null;
    await App.save({ immediate: true });
    renderHome();
    App.toast(`${s.short} ausgeblendet – wieder einblenden unter Einstellungen → Systeme & ROMs`, 'info', 5000);
  }

  function cardHtml(item, wide) {
    if (item.kind === 'action') {
      return `<div class="placeholder action"><div class="ph-icon">${Icons.svg(item.icon) || esc(item.icon)}</div><div><div class="ph-name">${esc(item.title)}</div><div class="ph-sys">${esc(item.sub)}</div></div></div>`;
    }
    if (item.kind === 'system') {
      const s = item.system;
      // Eigenes Logo > eingebaute Abbildung; bei eigenem Hintergrundbild ohne Logo keine Abbildung
      const icon = s.logo ? `<img src="${esc(s.logo)}" alt="">` : s.tileImage ? '' : ConsoleIcons.forSystem(s.id, s.name);
      const bg = s.tileImage ? ` has-image" style="--c:${esc(s.color)};--img:url('${esc(s.tileImage).replace(/'/g, '%27')}')` : `" style="--c:${esc(s.color)}`;
      return `<div class="sys-tile${bg}">
        ${icon ? `<div class="sys-icon">${icon}</div>` : ''}
        <div class="sys-short">${esc(s.short)}</div>
        <div class="sys-name">${esc(s.name)}</div>
        <div class="sys-emu"><span class="dot ${s.emulatorFound ? 'ok' : 'bad'}"></span>${esc(s.emulatorName)}</div>
        <div class="sys-count">${s.count} Spiele</div>
      </div>`;
    }
    const g = item.game;
    const sys = systemOf(g.system);
    const img = wide && g.hero ? g.hero : g.cover;
    const inner = img
      ? `<div class="card-blur" style="background-image:url('${esc(img).replace(/'/g, '%27')}')"></div><img src="${esc(img)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'placeholder',innerHTML:this.dataset.ph}))" data-ph="${esc(`<div class='ph-sys'>${esc(sys.short)}</div><div class='ph-name'>${esc(g.name)}</div>`)}">`
      : `<div class="placeholder" style="--c:${esc(sys.color)}"><div class="ph-sys">${esc(sys.short)}</div><div class="ph-name">${esc(g.name)}</div></div>`;
    const badge = g.type === 'rom' && img ? `<span class="badge">${esc(sys.short)}</span>` : '';
    return inner + badge + (isFav(g.id) ? `<span class="fav-star">${Icons.svg('star', 'filled')}</span>` : '');
  }

  function renderHome() {
    App.sections = buildSections();
    const wrap = $('#grid');
    // Scroll-Positionen merken, damit der Neuaufbau nicht an den Anfang springt
    const keepTop = wrap.scrollTop;
    const keepLeft = [...wrap.children].map((sec) => { const r = sec.querySelector('.shelf-items'); return r ? r.scrollLeft : 0; });
    const sameTab = App._lastRenderedTab === App.tabIndex;
    App._lastRenderedTab = App.tabIndex;
    wrap.innerHTML = '';
    const totalItems = App.sections.reduce((n, s) => n + s.items.length, 0);
    $('#empty').classList.toggle('hidden', totalItems > 0 || App.tabs[App.tabIndex].id !== 'home');
    // Fokus begrenzen
    if (App.focus.s >= App.sections.length) App.focus = { s: Math.max(0, App.sections.length - 1), i: 0 };
    App.sections.forEach((sec, si) => {
      const secEl = el('section', 'shelf ' + sec.layout + (sec.cls ? ' ' + sec.cls : ''));
      if (sec.console) secEl.appendChild(consoleBanner(sec.console));
      secEl.appendChild(el('h3', 'shelf-title', esc(sec.title) + (sec.more ? ` <small>+${sec.more - 30} weitere</small>` : '')));
      if (sec.note) secEl.appendChild(el('div', 'shelf-empty', esc(sec.note)));
      const row = el('div', 'shelf-items' + (sec.wide ? ' wide' : ''));
      sec.items.forEach((item, ii) => {
        const card = el('div', 'card ' + (item.kind === 'system' ? 'system-card' : item.kind === 'action' ? 'action-card' : ''));
        if (item.kind === 'system' && item.system.id === App.moveSystem) card.classList.add('moving');
        card.innerHTML = cardHtml(item, sec.wide);
        card.onclick = () => { setFocus(si, ii); activate(); };
        card.onmouseenter = () => setFocus(si, ii, true);
        row.appendChild(card);
      });
      if (!sec.items.length && sec.emptyText) row.appendChild(el('div', 'shelf-empty', esc(sec.emptyText)));
      secEl.appendChild(row);
      wrap.appendChild(secEl);
    });
    if (sameTab) {
      wrap.scrollTop = keepTop;
      [...wrap.children].forEach((sec, i) => { const r = sec.querySelector('.shelf-items'); if (r && keepLeft[i]) r.scrollLeft = keepLeft[i]; });
    }
    updateFocus(!sameTab);
  }

  /** Kopf der Spieleseite einer Konsole: Foto, Name, Emulator, Anzahl, Zurück-Hinweis */
  function consoleBanner(c) {
    const icon = c.logo ? `<img src="${esc(c.logo)}" alt="">` : ConsoleIcons.forSystem(c.id, c.name);
    return el('div', 'console-banner', `<div class="cb-art" style="--c:${esc(c.color)}">${icon}</div>
      <div class="cb-text"><div class="cb-crumb">Emulatoren › <b>${esc(c.short)}</b></div><h2>${esc(c.name)}</h2>
      <div class="cb-meta"><span class="dot ${c.emulatorFound ? 'ok' : 'bad'}"></span>${esc(c.emulatorName)} · ${c.count} Spiele</div></div>
      <div class="cb-back">${glyph('B')} Alle Konsolen</div>`);
  }
  function openConsole(sys) {
    if (!App._navigatingForward) App.forwardStack = [];
    App.emuReturn = App.focus.i;
    App.emuOpen = sys.id;
    App.focus = { s: 0, i: 0 };
    Sounds.play('accept');
    renderHome();
    // Erstes Spiel auswählen (Platz 0 ist die Konsolen-Kachel)
    const sec = App.sections[0];
    if (sec && sec.items.length > 1) setFocus(0, 1, true);
    $('#grid').scrollTop = 0;
  }
  function closeConsole() {
    const was = App.library.systems.find((x) => x.id === App.emuOpen);
    if (was) App.pushForward(() => openConsole(was));
    App.emuOpen = null;
    renderHome();
    setFocus(0, Math.min(App.emuReturn || 0, App.sections[0].items.length - 1), true);
    Sounds.play('back');
  }

  function focusedItem() {
    const sec = App.sections[App.focus.s];
    return sec && sec.items[App.focus.i];
  }

  function setFocus(s, i, silent) {
    App.focus = { s, i };
    updateFocus(silent);
  }

  /**
   * Ansicht folgt der Auswahl: nur so weit scrollen, dass die Karte mit etwas Abstand sichtbar ist.
   * Eigene Berechnung statt scrollIntoView – das wurde durch andere Scroll-Änderungen abgebrochen und blieb stehen.
   */
  function followSelection(card, secEl, silent) {
    const behavior = silent ? 'auto' : 'smooth';
    const grid = $('#grid');
    const g = grid.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const marginTop = 56; const marginBottom = 72;
    let top = grid.scrollTop;
    const secTop = secEl ? secEl.getBoundingClientRect().top : c.top;
    // Oberste Zeile des ersten Bereichs: ganz nach oben (Überschrift sichtbar). In großen Rastern (Steam, Alle Spiele)
    // liegen alle Spiele im ersten Bereich – dort sonst normal mitscrollen.
    if (App.focus.s === 0 && c.top - secTop < c.height * 0.9) top += secTop - g.top - 6;
    else if (c.top < g.top + marginTop) top += c.top - g.top - marginTop;
    else if (c.bottom > g.bottom - marginBottom) top += c.bottom - g.bottom + marginBottom;
    top = Math.max(0, Math.round(top));
    if (Math.abs(top - grid.scrollTop) > 1) grid.scrollTo({ top, behavior });
    // Waagerechte Reihen (Konsolen, Zuletzt gespielt …): innerhalb der Reihe mitscrollen
    const row = card.parentElement;
    if (row && row.scrollWidth > row.clientWidth + 2) {
      const r = row.getBoundingClientRect();
      const side = Math.min(160, r.width * 0.15);
      let left = row.scrollLeft;
      if (c.left < r.left + side) left += c.left - r.left - side;
      else if (c.right > r.right - side) left += c.right - r.right + side;
      left = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, Math.round(left)));
      if (Math.abs(left - row.scrollLeft) > 1) row.scrollTo({ left, behavior });
    }
  }

  function updateFocus(silent) {
    document.querySelectorAll('#grid .card.selected').forEach((c) => c.classList.remove('selected'));
    const secEl = $('#grid').children[App.focus.s];
    const card = secEl && secEl.querySelector('.shelf-items').children[App.focus.i];
    if (card && card.classList.contains('card')) {
      card.classList.add('selected');
      followSelection(card, secEl, silent);
    }
    updateHero();
    renderHints();
  }

  function updateHero() {
    const item = focusedItem();
    const meta = $('#heroMeta');
    meta.innerHTML = '';
    const chip = (t, cls = '') => meta.appendChild(el('span', 'chip ' + cls, t));
    let bg = '';
    if (!item) {
      $('#heroTitle').textContent = App.library.games.length ? '' : 'Willkommen';
      $('#heroSystem').innerHTML = '';
    } else if (item.kind === 'game') {
      const g = item.game;
      const sys = systemOf(g.system);
      $('#heroSystem').innerHTML = `<span class="dot" style="background:${esc(sys.color)};color:${esc(sys.color)}"></span>${esc(sys.name)}`;
      $('#heroTitle').textContent = g.name;
      if (g.type === 'rom') chip(`${Icons.svg('gamepad')} Emulator: <b>${esc(g.emulatorName)}</b>${g.emulatorOverride ? ' (eigene Wahl)' : ''}`, 'emu');
      else chip(esc(g.source || sys.name));
      if (isFav(g.id)) chip(`${Icons.svg('star', 'filled')} Favorit`, 'fav');
      const pt = fmtPlaytime((App.cfg.playtime || {})[g.id]);
      if (pt) chip(`${Icons.svg('clock')} ${pt}`);
      const lp = fmtDate((App.cfg.lastPlayed || {})[g.id]);
      if (lp) chip(lp);
      bg = g.hero || g.cover;
    } else if (item.kind === 'system') {
      const s = item.system;
      $('#heroSystem').innerHTML = `<span class="dot" style="background:${esc(s.color)};color:${esc(s.color)}"></span>Emulator`;
      $('#heroTitle').textContent = s.name;
      chip(`${Icons.svg('gamepad')} ${esc(s.emulatorName)}`, 'emu');
      chip(s.emulatorFound ? `${Icons.svg('check')} Emulator gefunden` : `${Icons.svg('warning')} Emulator nicht gefunden`, s.emulatorFound ? 'ok' : 'bad');
      chip(`${s.count} Spiele`);
    } else {
      $('#heroSystem').innerHTML = '';
      $('#heroTitle').textContent = item.title;
    }
    $('#bgImage').style.backgroundImage = bg ? `url("${bg.replace(/"/g, '%22')}")` : 'none';
  }

  // ---------- Navigation im Raster ----------
  function cardsOf(si) {
    const secEl = $('#grid').children[si];
    return secEl ? [...secEl.querySelector('.shelf-items').children].filter((c) => c.classList.contains('card')) : [];
  }

  function columns(si) {
    const cards = cardsOf(si);
    if (cards.length < 2) return 1;
    const top = cards[0].offsetTop;
    const n = cards.findIndex((c) => c.offsetTop !== top);
    return n === -1 ? cards.length : n;
  }

  function moveVertical(dir) {
    const { s, i } = App.focus;
    const sec = App.sections[s];
    if (!sec) return;
    if (sec.layout === 'grid') {
      const cols = columns(s);
      const ni = i + dir * cols;
      if (ni >= 0 && ni < sec.items.length) return setFocus(s, ni);
      if (dir > 0 && Math.floor(i / cols) < Math.floor((sec.items.length - 1) / cols)) return setFocus(s, sec.items.length - 1);
    }
    let ns = s + dir;
    while (ns >= 0 && ns < App.sections.length && !App.sections[ns].items.length) ns += dir;
    if (ns < 0 || ns >= App.sections.length) return false;
    const target = App.sections[ns];
    let ti = 0;
    if (target.layout === 'systems') ti = App.emuSystemIndex;
    else if (target.layout === 'grid' && dir < 0) {
      const cols = columns(ns);
      ti = Math.floor((target.items.length - 1) / cols) * cols + Math.min(i, cols - 1);
      ti = Math.min(ti, target.items.length - 1);
    } else ti = Math.min(sec.layout === 'grid' ? i % columns(s) : i, target.items.length - 1);
    setFocus(ns, Math.max(0, ti));
    return true;
  }

  function moveHorizontal(dir) {
    const { s, i } = App.focus;
    const sec = App.sections[s];
    if (!sec) return false;
    const ni = i + dir;
    if (ni < 0 || ni >= sec.items.length) return false;
    if (sec.layout === 'grid') {
      const cols = columns(s);
      if (Math.floor(ni / cols) !== Math.floor(i / cols)) return false;
    }
    if (sec.layout === 'systems') {
      App.emuSystemIndex = ni;
      App.focus = { s, i: ni };
      renderHome();
      return true;
    }
    setFocus(s, ni);
    return true;
  }

  function letterJump(dir) {
    const sec = App.sections[App.focus.s];
    if (!sec || sec.layout === 'systems') return;
    const letter = (it) => (it.kind === 'game' ? it.game.name[0] || '' : '').toUpperCase();
    const cur = letter(sec.items[App.focus.i]);
    let i = App.focus.i;
    if (dir > 0) { while (i < sec.items.length - 1 && letter(sec.items[i]) === cur) i++; }
    else {
      while (i > 0 && letter(sec.items[i - 1]) === cur) i--;
      if (i === App.focus.i && i > 0) { const prev = letter(sec.items[i - 1]); while (i > 0 && letter(sec.items[i - 1]) === prev) i--; }
    }
    setFocus(App.focus.s, i);
    App.toast(letter(sec.items[i]) || '#', 'info', 700);
  }

  // ---------- Aktionen ----------
  /** Spielstart-Animation: Cover zoomt heran, Hintergrund, Ladebalken (ca. 1,6 s) */
  function playLaunchAnimation(game) {
    if (App.cfg.general.launchAnimation === false) return Promise.resolve();
    const el = $('#launchAnim');
    const sys = systemOf(game.system || '');
    $('#laTitle').textContent = game.name;
    $('#laBg').style.backgroundImage = game.hero || game.cover ? `url("${String(game.hero || game.cover).replace(/"/g, '%22')}")` : 'none';
    $('#laCard').innerHTML = game.cover
      ? `<img src="${esc(game.cover)}" alt="">`
      : `<div class="placeholder" style="--c:${esc(sys.color || '#444')}"><div class="ph-sys">${esc(sys.short || '')}</div><div class="ph-name">${esc(game.name)}</div></div>`;
    el.classList.remove('hidden', 'out');
    void el.offsetWidth; // Animation neu starten
    el.classList.add('play');
    App.launchAnimating = true;
    return new Promise((resolve) => setTimeout(resolve, 1600));
  }
  function endLaunchAnimation() {
    const el = $('#launchAnim');
    App.launchAnimating = false;
    el.classList.add('out');
    setTimeout(() => el.classList.add('hidden'), 400);
    if (App.pendingRunning) { const st = App.pendingRunning; App.pendingRunning = null; showRunning(st); }
  }

  async function launch(game) {
    if (App.running) return App.toast('Es läuft bereits ein Spiel.', 'error');
    if (App.launchAnimating) return;
    Sounds.play('launch');
    const anim = playLaunchAnimation(game);
    try {
      const st = await api.launch(game.id);
      await anim;
      if (st && st.running) App.pendingRunning = st;
      else App.toast(`${game.name} wird geöffnet …`);
    } catch (err) {
      await anim;
      Sounds.play('error');
      App.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    }
    endLaunchAnimation();
  }

  async function addGameFlow() {
    const exe = await api.pickFile();
    if (!exe) return;
    const name = exe.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, '');
    const id = 'pc-' + Date.now();
    App.cfg.pcGames.push({ id, name, exe, args: '', cwd: '', cover: '', killMode: 'dir', processName: '' });
    await App.save({ immediate: true, rescan: true });
    App.toast(`„${name}“ hinzugefügt – suche Cover …`, 'ok', 3000);
    // Cover gleich im Hintergrund laden
    api.scrape({ ids: [id] }).catch(() => {});
  }

  function activate() {
    const item = focusedItem();
    if (!item) return;
    if (item.kind === 'game') return launch(item.game);
    if (item.kind === 'system') return openConsole(item.system);
    if (item.kind === 'action') {
      Sounds.play('accept');
      if (item.id === 'addGame') return addGameFlow();
      if (item.id === 'addSystem') return App.addSystemWizard();
      if (item.id === 'sysMenu') { const c = App.library.systems.find((x) => x.id === App.emuOpen); if (c) systemDetails(c); return; }
      if (item.id === 'bigpicture') return launch({ id: 'steam-bigpicture', name: 'Steam Big Picture' });
    }
  }

  function toggleFavorite(game) {
    const favs = new Set(App.cfg.favorites || []);
    if (favs.has(game.id)) favs.delete(game.id); else favs.add(game.id);
    App.cfg.favorites = [...favs];
    App.save();
    App.toast(favs.has(game.id) ? `★ ${game.name} zu Favoriten hinzugefügt` : `${game.name} aus Favoriten entfernt`, 'info', 1800);
    const keep = { ...App.focus };
    renderHome();
    setFocus(Math.min(keep.s, App.sections.length - 1), Math.min(keep.i, (App.sections[keep.s] || { items: [1] }).items.length - 1), true);
  }

  // ---------------- Modals (Menüs) ----------------
  /** Öffnet ein Menü. items: { label, icon, action, danger, type:'select', options:[{value,label}], value, onChange, info } */
  App.menu = function ({ title, text, items, onClose, className }) {
    const m = { title, text, items, focus: Math.max(0, items.findIndex((x) => x.focus)), onClose, className };
    if (m.focus < 0) m.focus = 0;
    App.modalStack.push(m);
    renderModal();
    Sounds.play('open');
  };
  App.closeMenu = function () {
    const m = App.modalStack.pop();
    renderModal();
    if (m && m.onClose) m.onClose();
  };
  App.confirm = function (title, text, okLabel = 'Ja') {
    return new Promise((resolve) => {
      let done = false;
      App.menu({
        title, text,
        items: [
          { label: okLabel, icon: 'check', action: () => { done = true; App.closeMenu(); resolve(true); } },
          { label: 'Abbrechen', icon: 'x', action: () => App.closeMenu() }
        ],
        onClose: () => !done && resolve(false)
      });
    });
  };

  function renderModal() {
    const m = App.modalStack[App.modalStack.length - 1];
    if (App.updateNavBack) setTimeout(App.updateNavBack, 0);
    $('#overlay').classList.toggle('hidden', !m);
    renderHints();
    if (!m) return;
    const box = $('#modal');
    box.className = 'modal ' + (m.className || '');
    box.innerHTML = (m.header || '') + `<h2>${esc(m.title || '')}</h2>` + (m.text ? `<div class="modal-text">${m.text}</div>` : '');
    const list = el('div', 'menu');
    m.items.forEach((it, i) => {
      if (it.type === 'info') {
        list.appendChild(el('div', 'menu-info', `<span>${esc(it.label)}</span><b>${esc(it.value)}</b>`));
        return;
      }
      const b = el('div', 'btn' + (it.danger ? ' danger' : '') + (i === m.focus ? ' focused' : ''));
      if (it.type === 'select') {
        const opt = it.options.find((o) => o.value === it.value) || it.options[0] || { label: '-' };
        b.innerHTML = `<span class="ico">${(Icons.has(it.icon) ? Icons.svg(it.icon) : esc(it.icon || ''))}</span><span class="grow">${esc(it.label)}</span><span class="select"><span class="arrow">◀</span>${esc(opt.label)}<span class="arrow">▶</span></span>`;
      } else {
        b.innerHTML = `<span class="ico">${(Icons.has(it.icon) ? Icons.svg(it.icon) : esc(it.icon || ''))}</span><span class="grow">${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}`;
      }
      b.onclick = () => { m.focus = i; modalAction('accept'); };
      list.appendChild(b);
    });
    box.appendChild(list);
    const f = list.querySelector('.btn.focused');
    if (f) f.scrollIntoView({ block: 'nearest' });
  }

  function modalAction(a) {
    const m = App.modalStack[App.modalStack.length - 1];
    const selectable = m.items.map((x, i) => (x.type === 'info' ? -1 : i)).filter((i) => i >= 0);
    const pos = selectable.indexOf(m.focus);
    const it = m.items[m.focus];
    if (a === 'up' || a === 'down') {
      const np = Math.max(0, Math.min(selectable.length - 1, pos + (a === 'down' ? 1 : -1)));
      if (np !== pos) { m.focus = selectable[np]; Sounds.play('move'); renderModal(); }
    } else if ((a === 'left' || a === 'right') && it && it.type === 'select') {
      const idx = it.options.findIndex((o) => o.value === it.value);
      const ni = (idx + (a === 'right' ? 1 : -1) + it.options.length) % it.options.length;
      it.value = it.options[ni].value;
      Sounds.play('move');
      if (it.onChange) it.onChange(it.value);
      renderModal();
    } else if (a === 'accept' && it) {
      if (it.type === 'select') return modalAction('right');
      Sounds.play('accept');
      it.action && it.action();
    } else if (a === 'back') {
      Sounds.play('back');
      App.closeMenu();
    }
  }

  // ---------- Detailseite eines Spiels ----------
  function gameDetails(game) {
    const sys = systemOf(game.system);
    const ov = (App.cfg.gameOverrides[game.id] = App.cfg.gameOverrides[game.id] || {});
    const cleanup = () => { if (!Object.keys(ov).length) delete App.cfg.gameOverrides[game.id]; };
    const items = [
      { label: 'Spielen', icon: 'play', action: () => { App.closeMenu(); launch(game); } },
      { label: isFav(game.id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', icon: 'star', action: () => { App.closeMenu(); toggleFavorite(game); } }
    ];
    if (game.type === 'rom') {
      const sysCfg = App.cfg.systems.find((s) => s.id === game.system);
      const options = [{ value: '', label: `Standard (${(App.library.emulators.find((e) => e.id === (sysCfg && sysCfg.emulator)) || { name: '–' }).name})` }]
        .concat(App.library.emulators.map((e) => ({ value: e.id, label: e.name + (e.found ? '' : ' (nicht gefunden)') })));
      items.push({
        type: 'select', label: 'Starten mit', icon: 'gamepad', options, value: ov.emulator || '',
        onChange: (v) => { if (v) ov.emulator = v; else delete ov.emulator; cleanup(); App.save({ rescan: true }); }
      });
    }
    if (['rom', 'steam', 'epic', 'pc'].includes(game.type)) items.push({ label: game.cover ? 'Cover neu herunterladen' : 'Cover herunterladen', icon: 'download', action: async () => {
      App.closeMenu();
      App.toast(`Suche Cover für „${game.name}“ …`, 'info', 2500);
      const r = await App.scrape({ ids: [game.id], force: true });
      const now = gameById(game.id);
      App.toast(now && now.cover ? `✔ Cover für „${game.name}“ geladen` : `Kein Cover für „${game.name}“ gefunden – ${game.type === 'rom' ? 'Tipp: ROM-Datei nach No-Intro/Redump benennen oder ScreenScraper einrichten' : 'Tipp: SteamGridDB-Schlüssel unter Einstellungen → Cover eintragen oder eigenes Bild wählen'}`, now && now.cover ? 'ok' : 'error', 6000);
      return r;
    } });
    items.push({ label: 'Cover-Bild ändern …', icon: 'image', action: async () => {
      const p = await api.pickImage();
      if (p) { ov.cover = p; App.closeMenu(); await App.save({ immediate: true, rescan: true }); App.toast('Cover geändert', 'ok'); }
    } });
    if (ov.cover) items.push({ label: 'Standard-Cover verwenden', icon: 'undo', action: async () => { delete ov.cover; cleanup(); App.closeMenu(); await App.save({ immediate: true, rescan: true }); } });
    items.push({ label: game.hidden ? 'Wieder anzeigen' : 'Aus Bibliothek ausblenden', icon: 'eye', action: async () => {
      if (game.hidden) { if (game.hiddenBy === 'manual') delete ov.hidden; else ov.hidden = false; } else ov.hidden = true;
      cleanup(); App.closeMenu(); await App.save({ immediate: true, rescan: true });
      App.toast(game.hidden ? 'Spiel wird wieder angezeigt' : (game.type === 'rom' ? 'Ausgeblendet – wieder einblenden unter Einstellungen → Systeme & ROMs → Konsole' : 'Ausgeblendet – wieder einblenden unter Einstellungen → Steam & Stores'), 'info', 4000);
    } });
    if (game.type === 'pc' && game.system === 'pc') {
      items.push({ label: 'Spiel entfernen', icon: 'trash', danger: true, action: async () => {
        App.closeMenu();
        if (await App.confirm('Spiel entfernen?', `„${esc(game.name)}“ wird aus AleGamestation entfernt (die Spieldateien bleiben erhalten).`, 'Entfernen')) {
          App.cfg.pcGames = App.cfg.pcGames.filter((g) => g.id !== game.id);
          await App.save({ immediate: true, rescan: true });
        }
      } });
    }
    // Infos
    const info = (label, value) => value && items.push({ type: 'info', label, value });
    info('System', sys.name);
    info('Quelle', game.type === 'rom' ? `Emulator ${game.emulatorName}` : game.source);
    const file = game.rom || game.exe || game.installDir || '';
    info('Datei', file.length > 60 ? '…' + file.slice(-58) : file);
    info('Spielzeit', fmtPlaytime((App.cfg.playtime || {})[game.id]) || 'Noch nicht gespielt');
    info('Zuletzt', fmtDate((App.cfg.lastPlayed || {})[game.id]));
    const cover = game.cover
      ? `<img class="detail-cover" src="${esc(game.cover)}">`
      : `<div class="detail-cover placeholder" style="--c:${esc(sys.color)}"><div class="ph-sys">${esc(sys.short)}</div><div class="ph-name">${esc(game.name)}</div></div>`;
    App.menu({ title: game.name, text: '', items, className: 'details' });
    App.modalStack[App.modalStack.length - 1].header = cover;
    renderModal();
  }

  function systemDetails(s) {
    if (s.standalone) return emulatorDetails(s);
    const sysCfg = App.cfg.systems.find((x) => x.id === s.id);
    const err = (e) => App.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    App.menu({
      title: s.name,
      text: s.count ? `${s.count} Spiele · Emulator: ${esc(s.emulatorName)}` : 'Noch keine Spiele gefunden – lege ROMs in den ROM-Ordner und lies die Bibliothek neu ein.',
      className: 'system-details',
      items: [
        ...(s.count && App.emuOpen !== s.id ? [{ label: 'Spiele anzeigen', icon: 'list', action: () => { App.closeMenu(); openConsole(s); } }] : []),
        { label: `${s.emulatorName} ohne Spiel starten`, icon: 'play', hint: s.emulatorFound ? 'z.B. zum Einrichten' : 'Emulator nicht gefunden', action: async () => {
          App.closeMenu();
          try { const st = await api.launchEmulator(s.id); if (st && st.running) showRunning(st); } catch (e) { err(e); }
        } },
        { label: 'ROM-Ordner öffnen', icon: 'folder', hint: (sysCfg.romDirs || [])[0] || '', action: async () => {
          App.closeMenu();
          try { const d = await api.openRomDir(s.id); App.toast(`Ordner geöffnet: ${d}`, 'ok'); } catch (e) { err(e); }
        } },
        { label: 'ROM-Ordner hinzufügen …', icon: 'plus', action: async () => {
          const d = await api.pickFolder();
          if (!d) return;
          sysCfg.romDirs = [...(sysCfg.romDirs || []), d];
          App.closeMenu();
          await App.save({ immediate: true, rescan: true });
          App.toast(`Ordner hinzugefügt – ${(App.library.systems.find((x) => x.id === s.id) || { count: 0 }).count} Spiele gefunden`, 'ok');
        } },
        { label: 'Bibliothek neu einlesen', icon: 'refresh', action: async () => { App.closeMenu(); await App.refreshLibrary(); } },
        {
          type: 'select', label: 'Emulator', icon: 'gamepad', value: sysCfg.emulator,
          options: App.library.emulators.map((e) => ({ value: e.id, label: e.name + (e.found ? '' : ' (nicht gefunden)') })),
          onChange: (v) => { sysCfg.emulator = v; App.save({ rescan: true }); }
        },
        { type: 'info', label: 'ROM-Ordner', value: (sysCfg.romDirs || []).join(' ; ') || '–' },
        { type: 'info', label: 'Dateiendungen', value: (sysCfg.extensions || []).join(' ') },
        { label: 'Fehlende Cover für dieses System laden', icon: 'download', action: () => { App.closeMenu(); App.scrape({ system: s.id }); } },
        { label: sysCfg.logo ? 'Logo / Abbildung ändern …' : 'Eigenes Logo / Abbildung wählen …', icon: 'image', hint: 'oben rechts auf der Kachel', action: async () => {
          const p = await api.pickImage();
          if (!p) return;
          sysCfg.logo = p;
          App.closeMenu();
          await App.save({ immediate: true, rescan: true });
          App.toast('Logo gespeichert', 'ok');
        } },
        ...(sysCfg.logo ? [{ label: 'Eingebaute Abbildung verwenden', icon: 'undo', action: async () => { delete sysCfg.logo; App.closeMenu(); await App.save({ immediate: true, rescan: true }); } }] : []),
        { label: sysCfg.tileImage ? 'Hintergrundbild ändern …' : 'Hintergrundbild für die Kachel wählen …', icon: 'image', hint: 'z.B. Foto der Konsole', action: async () => {
          const p = await api.pickImage();
          if (!p) return;
          sysCfg.tileImage = p;
          App.closeMenu();
          await App.save({ immediate: true, rescan: true });
          App.toast('Hintergrundbild gespeichert', 'ok');
        } },
        ...(sysCfg.tileImage ? [{ label: 'Hintergrundbild entfernen', icon: 'undo', action: async () => { delete sysCfg.tileImage; App.closeMenu(); await App.save({ immediate: true, rescan: true }); } }] : []),
        { label: 'Position verschieben', icon: 'extend', hint: '◀ ▶ im Emulator-Tab', action: () => startMoveSystem(s) },
        { label: 'Im Emulator-Tab ausblenden', icon: 'eye-off', action: () => hideSystem(s) },
        { label: 'In Einstellungen bearbeiten', icon: 'settings', action: () => { App.closeMenu(); openSettings('systems'); } }
      ]
    });
    const heroBg = s.tileImage ? `;background-image:linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,.1)),url('${esc(s.tileImage).replace(/'/g, '%27')}');background-size:cover;background-position:center` : '';
    const heroIcon = s.logo ? `<img src="${esc(s.logo)}" alt="">` : s.tileImage ? '<div style="flex:1"></div>' : ConsoleIcons.forSystem(s.id, s.name);
    App.modalStack[App.modalStack.length - 1].header = `<div class="detail-cover sys-hero" style="--c:${esc(s.color)}${heroBg}">${heroIcon}<span>${esc(s.short)}</span></div>`;
    renderModal();
  }

  /** Emulator ohne Konsole */
  function emulatorDetails(s) {
    const emuId = s.emulatorId;
    const err = (e) => App.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    App.menu({
      title: s.name,
      text: 'Dieser Emulator ist noch keiner Konsole zugeordnet. Richte ihn als Konsole ein, damit seine Spiele hier erscheinen.',
      className: 'system-details',
      items: [
        { label: 'Als Konsole einrichten …', icon: 'plus', hint: 'Konsole, ROM-Ordner', action: () => { App.closeMenu(); App.addSystemWizard(emuId); } },
        { label: `${s.name} starten`, icon: 'play', hint: s.emulatorFound ? 'ohne Spiel' : 'Programm nicht gefunden', action: async () => {
          App.closeMenu();
          try { const st = await api.launchEmulator(s.id); if (st && st.running) showRunning(st); } catch (e) { err(e); }
        } },
        { label: 'Position verschieben', icon: 'extend', hint: '◀ ▶ im Emulator-Tab', action: () => startMoveSystem(s) },
        { label: 'Im Emulator-Tab ausblenden', icon: 'eye-off', action: () => hideSystem(s) },
        { label: 'In Einstellungen bearbeiten', icon: 'settings', action: () => { App.closeMenu(); openSettings('emulators'); } }
      ]
    });
    App.modalStack[App.modalStack.length - 1].header = `<div class="detail-cover sys-hero" style="--c:${esc(s.color)}">${ConsoleIcons.forSystem('generic')}<span>${esc(s.short)}</span></div>`;
    renderModal();
  }

  // ---------- Konsole hinzufügen (Assistent) ----------
  const SYSTEM_PRESETS = [
    { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', color: '#e4002b', extensions: ['.nes', '.zip'] },
    { id: 'snes', name: 'Super Nintendo', short: 'SNES', color: '#7b5aa6', extensions: ['.sfc', '.smc', '.zip'] },
    { id: 'n64', name: 'Nintendo 64', short: 'N64', color: '#009e4f', extensions: ['.z64', '.n64', '.v64', '.zip'] },
    { id: 'gb', name: 'Game Boy / Color', short: 'GB', color: '#8b8f3a', extensions: ['.gb', '.gbc', '.zip'] },
    { id: 'gba', name: 'Game Boy Advance', short: 'GBA', color: '#4b2bb3', extensions: ['.gba', '.zip'] },
    { id: 'nds', name: 'Nintendo DS', short: 'NDS', color: '#8a8d91', extensions: ['.nds', '.zip'] },
    { id: '3ds', name: 'Nintendo 3DS', short: '3DS', color: '#c8102e', extensions: ['.3ds', '.cci', '.cia', '.3dsx'] },
    { id: 'gc', name: 'GameCube / Wii', short: 'GC/Wii', color: '#6a5acd', extensions: ['.iso', '.gcm', '.rvz', '.wbfs', '.ciso'] },
    { id: 'wiiu', name: 'Wii U', short: 'Wii U', color: '#009ac7', extensions: ['.wua', '.wux', '.wud', '.rpx'] },
    { id: 'switch', name: 'Nintendo Switch', short: 'Switch', color: '#e60012', extensions: ['.nsp', '.xci'] },
    { id: 'sms', name: 'Sega Master System', short: 'SMS', color: '#2a4fa0', extensions: ['.sms', '.zip'] },
    { id: 'md', name: 'Sega Mega Drive', short: 'Mega Drive', color: '#1f4fa3', extensions: ['.md', '.gen', '.bin', '.zip'] },
    { id: 'saturn', name: 'Sega Saturn', short: 'Saturn', color: '#3a3a6a', extensions: ['.cue', '.chd', '.iso'] },
    { id: 'dc', name: 'Sega Dreamcast', short: 'Dreamcast', color: '#e95d0f', extensions: ['.gdi', '.cdi', '.chd'] },
    { id: 'ps1', name: 'PlayStation', short: 'PS1', color: '#a3a3a3', extensions: ['.cue', '.chd', '.pbp', '.m3u'] },
    { id: 'ps2', name: 'PlayStation 2', short: 'PS2', color: '#1d3fbb', extensions: ['.iso', '.chd', '.cso'] },
    { id: 'ps3', name: 'PlayStation 3', short: 'PS3', color: '#222222', extensions: ['.iso', '.pkg'] },
    { id: 'psp', name: 'PlayStation Portable', short: 'PSP', color: '#2b2b2b', extensions: ['.iso', '.cso', '.pbp'] },
    { id: 'pce', name: 'PC Engine / TurboGrafx-16', short: 'PC Engine', color: '#d85a1a', extensions: ['.pce', '.cue', '.zip'] },
    { id: 'arcade', name: 'Arcade (MAME / FBNeo)', short: 'Arcade', color: '#b0007a', extensions: ['.zip', '.7z'] }
  ];

  /** @param {string} [preEmuId] bereits gewählter Emulator */
  App.addSystemWizard = function (preEmuId) {
    const have = new Set(App.cfg.systems.map((s) => s.id));
    const items = SYSTEM_PRESETS.filter((p) => !have.has(p.id)).map((p) => ({
      label: p.name, hint: p.extensions.join(' '), icon: 'gamepad', action: () => { App.closeMenu(); pickEmulator(p); }
    }));
    items.push({ label: 'Eigene Konsole …', icon: 'plus', hint: 'Name & Endungen später anpassen', action: () => {
      App.closeMenu();
      pickEmulator({ id: 'sys', name: 'Eigene Konsole', short: 'Eigene', color: '#5b6b8c', extensions: ['.zip', '.7z', '.iso', '.bin'] });
    } });
    App.menu({ title: 'Konsole hinzufügen', text: 'Für welche Konsole möchtest du Spiele hinzufügen?', items });

    function pickEmulator(p) {
      if (preEmuId) return pickFolder(p, preEmuId);
      const list = App.cfg.emulators.map((e) => {
        const info = (App.library.emulators || []).find((x) => x.id === e.id);
        return { label: e.name, icon: 'gamepad', hint: info && info.found ? 'gefunden' : 'Programm nicht gefunden', action: () => { App.closeMenu(); pickFolder(p, e.id); } };
      });
      list.unshift({ label: 'Neuen Emulator auswählen (.exe) …', icon: 'plus', action: async () => {
        const exe = await api.pickFile({ filters: [{ name: 'Programme', extensions: ['exe'] }] });
        if (!exe) return;
        const id = App.newEmulator(exe);
        App.closeMenu();
        pickFolder(p, id);
      } });
      App.menu({ title: `${p.short}: Emulator wählen`, text: 'Mit welchem Emulator sollen die Spiele starten? Start-Argumente (z.B. Vollbild) kannst du später unter Einstellungen → Emulatoren anpassen.', items: list });
    }

    function pickFolder(p, emuId) {
      App.menu({
        title: `${p.short}: ROM-Ordner`, text: 'Wo liegen deine Spiele für diese Konsole? Unterordner werden mit durchsucht.',
        items: [
          { label: 'Ordner auswählen …', icon: 'folder', action: async () => { const d = await api.pickFolder(); if (!d) return; App.closeMenu(); finish(p, emuId, [d]); } },
          { label: 'Später festlegen', icon: 'skip-forward', action: () => { App.closeMenu(); finish(p, emuId, []); } }
        ]
      });
    }

    async function finish(p, emuId, dirs) {
      let id = p.id;
      while (App.cfg.systems.some((s) => s.id === id)) id = p.id + '-' + Math.random().toString(36).slice(2, 6);
      App.cfg.systems.push({ id, name: p.name, short: p.short, color: p.color, extensions: p.extensions, romDirs: dirs, emulator: emuId, enabled: true });
      await App.save({ immediate: true, rescan: true });
      // Zum Emulatoren-Tab wechseln und die neue Konsole auswählen
      App.tabIndex = Math.max(0, App.tabs.findIndex((t) => t.id === 'emulators'));
      renderTabs();
      showView('home');
      const systems = emuTabSystems();
      App.emuOpen = null;
      App.focus = { s: 0, i: Math.max(0, systems.findIndex((s) => s.id === id)) };
      renderHome();
      const count = (systems.find((s) => s.id === id) || { count: 0 }).count;
      Sounds.play('accept');
      App.toast(`✔ ${p.name} eingerichtet${dirs.length ? ` – ${count} Spiele gefunden` : ' – ROM-Ordner kannst du später festlegen'}`, 'ok', 5000);
    }
  };

  // ---------- Power-Menü ----------
  function powerMenu() {
    const doPower = async (action, label) => {
      App.closeMenu();
      if (App.cfg.general.confirmPowerActions && !(await App.confirm(label + '?', 'Bist du sicher?', label))) return;
      App.toast(label + ' …');
      api.power(action);
    };
    App.menu({
      title: 'Menü',
      text: '',
      items: [
        ...(App.update && App.update.status === 'ready' ? [{ label: `Update auf v${App.update.available} installieren`, icon: 'update', hint: 'App startet neu', action: () => { App.closeMenu(); App.installUpdate(); } }] : []),
        { label: 'Nach Updates suchen', icon: 'refresh', hint: App.update && App.update.available ? `v${App.update.available} verfügbar` : `v${(App.update && App.update.version) || ''}`, action: () => { App.closeMenu(); App.updateDialog(true); } },
        { label: 'Herunterfahren', icon: 'power', danger: true, action: () => doPower('shutdown', 'Herunterfahren') },
        { label: 'Neu starten', icon: 'restart', action: () => doPower('restart', 'Neu starten') },
        { label: 'Energie sparen', icon: 'moon', action: () => doPower('sleep', 'Energie sparen') },
        { label: 'Zum Desktop (Konsolenmodus beenden)', icon: 'logout', action: () => doPower('exit', 'Konsolenmodus beenden') },
        { label: 'Maus- & Tastatursteuerung', icon: 'mouse', hint: Glyphs.comboLabel(App.cfg.controller.mouseModeCombo), action: () => { App.closeMenu(); api.toggleMouseMode(); } },
        ...(App.cfg.homeassistant && App.cfg.homeassistant.enabled ? [
          { label: 'Fernseher einschalten / Eingang wählen', icon: 'tv', action: async () => { App.closeMenu(); try { await api.haTv(true); App.toast('Fernseher angesteuert', 'ok'); } catch (e) { App.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000); } } },
          { label: 'Fernseher ausschalten', icon: 'power', action: async () => { App.closeMenu(); try { await api.haTv(false); } catch (e) { App.toast(String(e.message || e), 'error'); } } }
        ] : []),
        { label: 'Sortieren & Filtern …', icon: 'list', hint: SORTS.find((x) => x.value === sortMode()).label, action: () => { App.closeMenu(); arrangeMenu(); } },
        { label: 'Bildschirm umschalten …', icon: 'monitor', action: displayMenu },
        { label: 'Fehlende Cover herunterladen', icon: 'download', action: () => { App.closeMenu(); App.scrape({}); } },
        { label: 'Bibliothek neu einlesen', icon: 'refresh', action: async () => { App.closeMenu(); await App.refreshLibrary(); App.toast(`${App.library.games.length} Spiele gefunden`, 'ok'); } },
        ...(App.debug ? [{ label: 'Debug-Bericht erstellen', icon: 'bolt', hint: 'Datei auf dem Desktop', action: () => { App.closeMenu(); App.debugReport(); } }] : []),
        { label: 'Einstellungen', icon: 'settings', action: () => { App.closeMenu(); openSettings(); } }
      ]
    });
  }

  function displayMenu() {
    const set = (mode, label) => { App.closeMenu(); App.closeMenu(); api.setDisplayMode(mode); App.toast(`Anzeige: ${label}`); };
    const tv = async (mode) => {
      App.closeMenu(); App.closeMenu();
      App.toast('Schalte auf den Fernseher um …', 'info', 2500);
      const r = await api.tvOnly(mode).catch((e) => ({ ok: false, error: String(e.message || e) }));
      App.toast(r && r.ok ? (mode === 'only' ? 'Nur noch der Fernseher ist aktiv' : 'Fernseher ist jetzt der Hauptbildschirm') : (r && r.error) || 'Umschalten fehlgeschlagen', r && r.ok ? 'ok' : 'error', 6000);
    };
    App.menu({
      title: 'Bildschirm', text: 'Wie Win + P. Nach dem Umschalten passt sich die Oberfläche automatisch an.',
      items: [
        ...(App.cfg.display.tv ? [
          { label: `Nur Fernseher (${App.cfg.display.tv.name})`, icon: 'tv', action: () => tv('only') },
          { label: 'Fernseher als Hauptbildschirm', icon: 'tv', hint: 'Monitore bleiben an', action: () => tv('primary') },
          { label: 'Alle Bildschirme wieder einschalten', icon: 'extend', action: async () => { App.closeMenu(); App.closeMenu(); await api.restoreDisplays(); App.toast('Bildschirme wiederhergestellt', 'ok'); } }
        ] : []),
        { label: App.cfg.display.tv ? 'Nur zweiter Bildschirm (Windows wählt)' : 'Nur zweiter Bildschirm (TV)', icon: 'tv', action: () => set('external', 'nur TV') },
        { label: 'Nur PC-Bildschirm', icon: 'monitor', action: () => set('internal', 'nur PC-Bildschirm') },
        { label: 'Duplizieren', icon: 'duplicate', action: () => set('clone', 'dupliziert') },
        { label: 'Erweitern', icon: 'extend', action: () => set('extend', 'erweitert') }
      ]
    });
  }

  function openSettings(section) {
    const i = App.tabs.findIndex((t) => t.id === 'settings');
    App.tabIndex = i;
    renderTabs();
    showView('settings');
    SettingsView.open(section);
  }
  App.openSettings = openSettings;
  // ---------- Vor/Zurück (Maus-Seitentasten, Alt+←/→, Zurück-Knopf) ----------
  App.forwardStack = [];
  App.pushForward = (fn) => { App.forwardStack.push(fn); if (App.forwardStack.length > 20) App.forwardStack.shift(); updateNavBack(); };
  function navForward() {
    const fn = App.forwardStack.pop();
    if (!fn) return false;
    App._navigatingForward = true;
    try { fn(); } finally { App._navigatingForward = false; }
    Sounds.play('move');
    updateNavBack();
    return true;
  }
  /** Gibt es etwas, wohin „Zurück“ führt? (für den Zurück-Knopf oben) */
  function canGoBack() {
    if (App.running) return false;
    return !!(App.modalStack.length || App.moveSystem || App.view === 'settings' || App.emuOpen && App.tabs[App.tabIndex].id === 'emulators' || App.tabIndex !== 0);
  }
  function updateNavBack() {
    const b = $('#navBack');
    if (b) b.classList.toggle('hidden', !canGoBack());
  }
  App.updateNavBack = updateNavBack;

  App.backToLibrary = function () {
    App.tabIndex = 0;
    renderTabs();
    showView('home');
    renderHome();
  };

  // ---------- Läuft-Anzeige ----------
  function showRunning(st) {
    // Während der Startanimation erst danach anzeigen
    if (App.launchAnimating) { App.pendingRunning = st; return; }
    App.running = st;
    $('#runningTitle').textContent = st.game.name;
    const combo = Glyphs.comboHtml(App.cfg.controller.closeGameCombo);
    const g = Glyphs.html('GUIDE', { raw: true, pad: true });
    const guide = (App.cfg.controller.guideButton !== 'off' ? ` oder ${g} drücken` : '') + (App.cfg.controller.overlayEnabled !== false ? ` · ${g} halten: Konsolen-Menü` : '');
    $('#runningHint').innerHTML = `Zum Beenden am Controller ${combo} gedrückt halten${guide}`;
    $('#running').classList.remove('hidden');
    renderHints();
  }
  function hideRunning() {
    App.running = null;
    App.pendingRunning = null; // Spiel schon beendet, während die Startanimation lief
    $('#running').classList.add('hidden');
    renderHints();
  }
  $('#btnKill').onclick = () => api.kill();

  // ---------- Hinweise ----------
  function renderHints() {
    const h = $('#hints');
    const hint = (g, t) => `<span class="hint">${g} ${t}</span>`;
    let html = '';
    if (App.running) html = hint(glyph('A'), 'Spiel beenden');
    else if (App.modalStack.length) html = hint(glyph('A'), 'Auswählen') + hint(glyph('B'), 'Zurück');
    else if (App.view === 'settings') html = SettingsView.hints(hint, glyph);
    else if (App.moveSystem) html = hint('◀ ▶', 'Verschieben') + hint(glyph('A'), 'Ablegen');
    else {
      const item = focusedItem();
      if (item && item.kind === 'game') html += hint(glyph('A'), 'Spielen') + hint(glyph('X'), 'Favorit') + hint(glyph('Y'), 'Details');
      else if (item && item.kind === 'system') html += hint(glyph('A'), 'Spiele anzeigen') + hint(glyph('Y'), 'Konsole');
      else if (item) html += hint(glyph('A'), 'Öffnen');
      html += hint(glyph('LB') + glyph('RB'), App.sections[App.focus.s] && App.sections[App.focus.s].letterJump ? 'Buchstabe' : 'Bereich');
      if (App.emuOpen && App.tabs[App.tabIndex].id === 'emulators') html += hint(glyph('B'), 'Alle Konsolen');
      html += hint(glyph('LT') + glyph('RT'), 'Kategorie') + hint(glyph('START'), 'Menü');
    }
    h.innerHTML = html;
  }
  App.renderHints = renderHints;

  // ---------------- Eingabe ----------------
  Input.on(() => setTimeout(updateNavBack, 0));
  Input.on((a, src) => {
    if (App.debug) App.log('eingabe', `${a} (${src || '?'})`, debugContext());
    if (a === 'forward') { if (!App.modalStack.length && !App.running && !App.moveSystem) navForward(); return; }
    if (App.recording) return;
    if (App.running) {
      if (a === 'accept') api.kill();
      return;
    }
    if (App.modalStack.length) return modalAction(a);
    if (App.moveSystem) {
      if (a === 'left' || a === 'right') { if (moveSystemStep(a === 'right' ? 1 : -1)) Sounds.play('move'); }
      else if (a === 'accept' || a === 'back') { Sounds.play('accept'); endMoveSystem(); }
      return;
    }
    // L2/R2: große Tabs wechseln (überall, auch in den Einstellungen)
    if (a === 'lt' || a === 'rt') return switchTab(App.tabIndex + (a === 'rt' ? 1 : -1));
    if (App.view === 'settings') return SettingsView.handle(a);
    if (a === 'start' || a === 'guide') return powerMenu();
    if (a === 'select') return openSettings();
    const item = focusedItem();
    switch (a) {
      case 'up': if (moveVertical(-1) !== false) Sounds.play('move'); break;
      case 'down': if (moveVertical(1) !== false) Sounds.play('move'); break;
      case 'left': if (moveHorizontal(-1)) Sounds.play('move'); break;
      case 'right': if (moveHorizontal(1)) Sounds.play('move'); break;
      case 'accept': activate(); break;
      case 'back':
        if (App.emuOpen && App.tabs[App.tabIndex].id === 'emulators') closeConsole();
        else if (App.tabIndex !== 0) { const prev = App.tabIndex; switchTab(0); App.pushForward(() => switchTab(prev)); }
        else if (App.focus.s || App.focus.i) { setFocus(0, 0); Sounds.play('back'); }
        break;
      case 'x': if (item && item.kind === 'game') toggleFavorite(item.game); break;
      case 'y':
        if (item && item.kind === 'game') gameDetails(item.game);
        else if (item && item.kind === 'system') systemDetails(item.system);
        break;
      // L1/R1: in langen Listen nach Anfangsbuchstaben springen, sonst zum vorherigen/nächsten Bereich
      case 'lb': case 'rb': {
        const sec = App.sections[App.focus.s];
        if (sec && sec.letterJump) letterJump(a === 'rb' ? 1 : -1);
        else if (moveVertical(a === 'rb' ? 1 : -1) !== false) Sounds.play('move');
        break;
      }
    }
  });

  // ---------------- Controller-Symbole ----------------
  function refreshGlyphs() {
    $('#tabL').outerHTML = Glyphs.html('LT').replace('class="glyph', 'id="tabL" class="glyph bumper');
    $('#tabR').outerHTML = Glyphs.html('RT').replace('class="glyph', 'id="tabR" class="glyph bumper');
    $('#killGlyph').outerHTML = Glyphs.html('A').replace('class="glyph', 'id="killGlyph" class="glyph');
    $('#emptyMenuGlyph').outerHTML = Glyphs.html('START').replace('class="glyph', 'id="emptyMenuGlyph" class="glyph');
    const pad = $('#padStatus');
    pad.innerHTML = Icons.svg(Glyphs.style() === 'keyboard' ? 'keyboard' : 'gamepad');
    pad.title = Glyphs.detected().name || 'Controller';
    if (App.running) showRunning(App.running);
    renderHints();
    if (App.view === 'settings' && SettingsView.rerender) SettingsView.rerender();
  }
  Glyphs.onChange((style, reason) => {
    refreshGlyphs();
    // Nur beim Wechsel des Controller-Typs einblenden, nicht bei jedem Wechsel Tastatur <-> Controller
    if (reason === 'controller') App.toast(`${Glyphs.NAMES[Glyphs.padStyle()]}-Controller erkannt`, 'info', 1800);
  });

  // ---------------- Start ----------------
  function tickClock() {
    $('#clock').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tickClock, 5000);
  tickClock();

  document.addEventListener('gamepads', (e) => $('#padStatus').classList.toggle('on', e.detail > 0));

  let cursorTimer = null;
  window.addEventListener('mousemove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    if (App.cfg && App.cfg.general.hideCursor) cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
  });

  async function init() {
    App.cfg = await api.getConfig();
    try { App.emuProfiles = await api.emulatorProfiles(); } catch { App.emuProfiles = []; }
    applyConfig();
    if (App.cfg.general.hideCursor) document.body.classList.add('hide-cursor');
    App.library = await api.getLibrary();
    if (!App.library.games.length && !App.library.systems.length) App.library = await api.refreshLibrary();
    buildTabs();
    renderHome();
    const st = await api.gameStatus();
    if (st.running) showRunning(st);

    api.onGameStatus((s) => (s.running ? showRunning(s) : hideRunning()));
    api.onConfigChanged((c) => { App.cfg = c; refreshDebug(); if (App.view === 'home') { const f = { ...App.focus }; renderHome(); setFocus(Math.min(f.s, Math.max(0, App.sections.length - 1)), 0, true); } });
    api.onToast((t) => App.toast(t.text, t.type, t.ms));
    // Maus: Zurück-Knopf oben und Mausrad in den Spiele-Rastern
    $('#navBack').onclick = () => Input.trigger('back', 'mouse');
    if (api.onNavCommand) api.onNavCommand((a) => setTimeout(() => Input.navCommand(a), 60));
    $('#gridWrap').addEventListener('wheel', (e) => {
      const row = e.target.closest && e.target.closest('.shelf.strip .shelf-items');
      if (row && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) row.scrollBy({ left: e.deltaX || e.deltaY, behavior: 'auto' });
      else $('#grid').scrollBy({ top: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    }, { passive: false });
    updateNavBack();
    refreshDebug();
    api.onDebugEvent(() => refreshDebug());
    window.addEventListener('error', (e) => App.log('oberfläche', `JS-Fehler: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`, debugContext(), 'error'));
    window.addEventListener('unhandledrejection', (e) => App.log('oberfläche', 'Promise-Fehler: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason), debugContext(), 'error'));
    api.onScrapeProgress(showScrapeProgress);
    api.onMouseMode((on) => {
      Input.configure({ gamepadDisabled: on });
      document.body.classList.toggle('hide-cursor', !on && App.cfg.general.hideCursor);
      App.toast(on ? '🖱 Maus- & Tastatursteuerung aktiv' : '🎮 Controller-Navigation aktiv', 'info', 2000);
    });
    api.onLibraryChanged((lib) => {
      App.library = lib;
      buildTabs();
      if (App.view === 'home' && !App.modalStack.length) {
        const f = { ...App.focus };
        renderHome();
        setFocus(Math.min(f.s, Math.max(0, App.sections.length - 1)), Math.min(f.i, Math.max(0, ((App.sections[f.s] || {}).items || [1]).length - 1)), true);
      }
    });
    api.onPadState((s) => Input.hidState(s));
    try { Input.hidConnected(await api.hidControllers()); } catch { /* ignore */ }
    api.onGamepadConnection((c) => {
      if (c.source === 'hid' && typeof c.count === 'number') {
        Input.hidConnected(c.count);
        $('#padStatus').classList.toggle('on', Input.connected() > 0);
        if (c.connected) Glyphs.setDetected('playstation', c.type === 'dualsense' ? 'DualSense' : 'DualShock 4');
      }
      if (c.connected && c.type && c.source === 'hid' && !Input.connected()) Glyphs.setDetected('playstation', c.type === 'dualsense' ? 'DualSense' : 'DualShock 4');
      if (c.connected && c.source === 'hid') $('#padStatus').classList.add('on');
    });

    // Updates
    App.update = await api.updateState();
    updateBadge();
    let announced = '';
    let announcedAvail = '';
    api.onUpdateState((u) => {
      App.update = u;
      updateBadge();
      if (u.status === 'ready' && announced !== u.available) {
        announced = u.available;
        Sounds.play('accept');
        if (App.installWhenReady) { App.installWhenReady = false; App.installUpdate(); return; }
        App.toast(`⬆ Update v${u.available} ist bereit – Menü → „Nach Updates suchen“ oder es wird beim Beenden automatisch installiert.`, 'ok', 9000);
      } else if (u.status === 'available' && announcedAvail !== u.available) {
        announcedAvail = u.available;
        App.toast(`⬆ Version ${u.available} ist verfügbar – Menü → „Nach Updates suchen“`, 'ok', 7000);
      }
      if (App.updateDialogOpen) App.updateDialog(false);
      if (App.view === 'settings') SettingsView.refreshUpdate && SettingsView.refreshUpdate();
    });
    $('#updateBadge').onclick = () => App.updateDialog(false);
    playBootAnimation();
  }

  // ---------- Boot-Animation ----------
  function playBootAnimation() {
    const boot = $('#boot');
    if (App.cfg.general.bootAnimation === false) {
      boot.remove();
      if (App.cfg.general.startupSound !== false) setTimeout(() => Sounds.play('startup'), 300);
      return;
    }
    boot.classList.add('play');
    if (App.cfg.general.startupSound !== false) setTimeout(() => Sounds.play('startup'), 250);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      boot.classList.add('out');
      setTimeout(() => boot.remove(), 600);
    };
    setTimeout(finish, 2300);
    // Mit jeder Taste überspringen
    const skip = () => { finish(); window.removeEventListener('keydown', skip, true); };
    window.addEventListener('keydown', skip, true);
    Input.on(() => finish());
  }

  // ---------- Cover-Download ----------
  App.scrape = async function (opts) {
    try {
      const r = await api.scrape(opts);
      if (!r) return App.toast('Cover-Download läuft bereits', 'info');
      if (!r.total) return App.toast('Alle Spiele haben bereits Cover', 'ok');
      return r;
    } catch (err) {
      App.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    }
  };
  let scrapeHide = null;
  function showScrapeProgress(p) {
    const box = $('#scrapeStatus');
    clearTimeout(scrapeHide);
    if (p.total <= 1 && !p.finished) return; // Einzelnes Spiel: nur Toast
    box.classList.remove('hidden');
    $('#scrapeCount').textContent = `${p.done} / ${p.total}`;
    $('#scrapeBar').style.width = (p.total ? (p.done / p.total) * 100 : 0) + '%';
    if (p.finished) {
      box.classList.add('done');
      $('#scrapeCurrent').textContent = (p.cancelled ? 'Abgebrochen – ' : 'Fertig – ') + `${p.found} gefunden, ${p.missing} ohne Treffer` + (p.error ? ` · ${p.error}` : '');
      if (p.total > 1) Sounds.play('accept');
      scrapeHide = setTimeout(() => { box.classList.add('hidden'); box.classList.remove('done'); }, 7000);
    } else {
      box.classList.remove('done');
      $('#scrapeCurrent').textContent = p.current || '';
    }
  }

  // ---------- Update-Fenster ----------
  function updateBadge() {
    const u = App.update || {};
    const show = ['available', 'downloading', 'ready'].includes(u.status);
    const b = $('#updateBadge');
    b.classList.toggle('hidden', !show);
    b.innerHTML = u.status === 'downloading' ? `${Icons.svg('download')} ${u.progress || 0} %` : u.status === 'ready' ? `${Icons.svg('update')} Update bereit` : `${Icons.svg('update')} v${esc(u.available || '')}`;
  }

  function notesHtml(notes) {
    if (!notes) return '';
    const lines = notes.split('\n').filter((l) => l.trim());
    const items = lines.map((l) => {
      const m = l.match(/^\s*[-*•]\s+(.*)$/);
      return m ? `<li>${esc(m[1])}</li>` : `<li class="plain">${esc(l)}</li>`;
    }).join('');
    return `<div class="update-notes"><b>Was ist neu</b><ul>${items}</ul></div>`;
  }

  /** @param {boolean} check sofort bei GitHub nachsehen */
  App.updateDialog = function (check) {
    const u = App.update || {};
    const items = [];
    const close = () => { App.updateDialogOpen = false; App.closeMenu(); };
    if (u.status === 'checking') items.push({ type: 'info', label: 'Status', value: 'Frage GitHub nach der neuesten Version …' });
    if (u.status === 'latest') items.push({ type: 'info', label: 'Status', value: 'Du hast die neueste Version' });
    if (u.status === 'error') items.push({ type: 'info', label: 'Fehler', value: u.error || 'Unbekannt' });
    if (u.status === 'available' && u.canInstall) {
      items.push({ label: `Herunterladen & installieren`, icon: 'download', hint: `v${u.available}`, action: async () => { App.installWhenReady = true; await api.downloadUpdate(); } });
    }
    if (u.status === 'available' && !u.canInstall) {
      items.push({ label: 'Installer herunterladen', icon: 'download', hint: 'öffnet den Browser', action: () => api.openUpdatePage(u.installerUrl || u.releaseUrl) });
    }
    if (u.status === 'downloading') items.push({ label: 'Im Hintergrund weiterladen', icon: 'download', hint: `${u.progress || 0} %`, action: close });
    if (u.status === 'ready') {
      items.push({ label: 'Jetzt installieren & neu starten', icon: 'update', action: () => { close(); App.installUpdate(); } });
      items.push({ label: 'Beim nächsten Beenden installieren', icon: 'clock', action: close });
    }
    if (['latest', 'error', 'idle', 'dev', 'unsupported'].includes(u.status)) items.push({ label: 'Erneut suchen', icon: 'refresh', action: () => api.checkUpdate() });
    items.push({ label: 'Release-Seite auf GitHub öffnen', icon: 'external', action: () => api.openUpdatePage(u.releaseUrl) });
    if (!['downloading', 'ready'].includes(u.status)) items.push({ label: 'Schließen', icon: 'x', action: close });

    const progress = u.status === 'downloading' ? `<div class="progress update-progress"><div style="width:${u.progress || 0}%"></div></div>` : '';
    const versions = `<div class="update-versions"><div><small>Installiert</small><b>v${esc(u.version || '?')}</b></div><span>→</span><div><small>Neueste</small><b>${u.available ? 'v' + esc(u.available) : u.status === 'latest' ? 'v' + esc(u.version) : '…'}</b></div></div>`;
    const text = versions + progress + (u.available || u.status === 'latest' ? notesHtml(u.notes) : '');
    const top = App.modalStack[App.modalStack.length - 1];
    if (App.updateDialogOpen && top && top.className === 'update-dialog') {
      // Offenes Fenster aktualisieren, Fokus behalten
      const focusLabel = top.items[top.focus] && top.items[top.focus].label;
      top.text = text;
      top.items = items;
      const fi = items.findIndex((x) => x.label === focusLabel);
      top.focus = fi >= 0 ? fi : Math.max(0, items.findIndex((x) => x.type !== 'info'));
      renderModal();
    } else {
      App.updateDialogOpen = true;
      App.menu({ title: 'Software-Update', text, items, className: 'update-dialog', onClose: () => { App.updateDialogOpen = false; } });
      const m = App.modalStack[App.modalStack.length - 1];
      m.focus = Math.max(0, items.findIndex((x) => x.type !== 'info'));
      renderModal();
    }
    if (check) api.checkUpdate();
  };

  App.installUpdate = async function () {
    if (App.running) return App.toast('Bitte zuerst das Spiel beenden.', 'error');
    App.toast('Update wird installiert – AleGamestation startet gleich neu …', 'ok', 10000);
    Sounds.play('launch');
    setTimeout(() => api.installUpdate(), 900);
  };
  init();
})();
