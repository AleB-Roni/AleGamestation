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

  App.toast = function (text, type = 'info', ms = 3200) {
    const t = el('div', 'toast ' + type, esc(text));
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
    const g = App.cfg.general;
    document.documentElement.style.setProperty('--accent', g.accentColor || '#7c5cff');
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
    if (L.systems.some((s) => s.kind === 'emulator')) tabs.push({ id: 'emulators', label: 'Emulatoren' });
    tabs.push({ id: 'all', label: 'Alle Spiele' });
    tabs.push({ id: 'settings', label: '⚙ Einstellungen' });
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
      const e = el('div', 'tab' + (i === App.tabIndex ? ' active' : ''), esc(t.label));
      e.onclick = () => switchTab(i);
      list.appendChild(e);
    });
    const active = list.children[App.tabIndex];
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function switchTab(i) {
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
  }

  // ---------------- Bibliothek: Abschnitte ----------------
  /** Abschnitt: { title, layout: 'strip'|'grid'|'systems', items: [ {kind:'game'|'action'|'system', ...} ] } */
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
      const items = games.filter((g) => g.system === tab.system).map(gi);
      if (tab.system === 'steam' && App.cfg.steam.showBigPictureTile) items.unshift({ kind: 'action', id: 'bigpicture', title: 'Steam Big Picture', sub: 'öffnen', icon: '▶' });
      if (tab.system === 'pc') items.unshift({ kind: 'action', id: 'addGame', title: 'Spiel hinzufügen', sub: '.exe / Verknüpfung', icon: '＋' });
      secs.push({ title: systemOf(tab.system).name, layout: 'grid', items });
    } else if (tab.id === 'emulators') {
      const systems = App.library.systems.filter((s) => s.kind === 'emulator');
      App.emuSystemIndex = Math.min(App.emuSystemIndex, Math.max(0, systems.length - 1));
      secs.push({ title: 'Emulatoren & Systeme', layout: 'systems', items: systems.map((s) => ({ kind: 'system', system: s })) });
      const sys = systems[App.emuSystemIndex];
      if (sys) {
        const list = games.filter((g) => g.system === sys.id).map(gi);
        secs.push({ title: `${sys.name} – ${list.length} Spiele`, layout: 'grid', items: list, emptyText: sys.emulatorFound ? `Keine ROMs gefunden. Wähle oben ${sys.short} aus und drücke die Auswahl-Taste: ROM-Ordner öffnen, Ordner hinzufügen oder den Emulator ohne Spiel starten.` : `Emulator „${sys.emulatorName}“ wurde nicht gefunden. Pfad in Einstellungen → Emulatoren eintragen.` });
      }
    } else if (tab.id === 'all') {
      secs.push({ title: `Alle Spiele (${games.length})`, layout: 'grid', items: games.slice().sort((a, b) => a.name.localeCompare(b.name, 'de')).map(gi), letterJump: true });
    }
    return secs;
  }

  function cardHtml(item, wide) {
    if (item.kind === 'action') {
      return `<div class="placeholder action"><div class="ph-icon">${item.icon}</div><div><div class="ph-name">${esc(item.title)}</div><div class="ph-sys">${esc(item.sub)}</div></div></div>`;
    }
    if (item.kind === 'system') {
      const s = item.system;
      const icon = s.logo ? `<img src="${esc(s.logo)}" alt="">` : ConsoleIcons.forSystem(s.id, s.name);
      return `<div class="sys-tile" style="--c:${esc(s.color)}">
        <div class="sys-icon">${icon}</div>
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
    return inner + badge + (isFav(g.id) ? '<span class="fav-star">★</span>' : '');
  }

  function renderHome() {
    App.sections = buildSections();
    const wrap = $('#grid');
    wrap.innerHTML = '';
    const totalItems = App.sections.reduce((n, s) => n + s.items.length, 0);
    $('#empty').classList.toggle('hidden', totalItems > 0 || App.tabs[App.tabIndex].id !== 'home');
    // Fokus begrenzen
    if (App.focus.s >= App.sections.length) App.focus = { s: Math.max(0, App.sections.length - 1), i: 0 };
    App.sections.forEach((sec, si) => {
      const secEl = el('section', 'shelf ' + sec.layout);
      secEl.appendChild(el('h3', 'shelf-title', esc(sec.title) + (sec.more ? ` <small>+${sec.more - 30} weitere</small>` : '')));
      const row = el('div', 'shelf-items' + (sec.wide ? ' wide' : ''));
      sec.items.forEach((item, ii) => {
        const card = el('div', 'card ' + (item.kind === 'system' ? 'system-card' : item.kind === 'action' ? 'action-card' : ''));
        if (item.kind === 'system' && ii === App.emuSystemIndex) card.classList.add('current');
        card.innerHTML = cardHtml(item, sec.wide);
        card.onclick = () => { setFocus(si, ii); activate(); };
        card.onmouseenter = () => setFocus(si, ii, true);
        row.appendChild(card);
      });
      if (!sec.items.length && sec.emptyText) row.appendChild(el('div', 'shelf-empty', esc(sec.emptyText)));
      secEl.appendChild(row);
      wrap.appendChild(secEl);
    });
    updateFocus();
  }

  function focusedItem() {
    const sec = App.sections[App.focus.s];
    return sec && sec.items[App.focus.i];
  }

  function setFocus(s, i, silent) {
    App.focus = { s, i };
    updateFocus(silent);
  }

  function updateFocus(silent) {
    document.querySelectorAll('#grid .card.selected').forEach((c) => c.classList.remove('selected'));
    const secEl = $('#grid').children[App.focus.s];
    const card = secEl && secEl.querySelector('.shelf-items').children[App.focus.i];
    if (card && card.classList.contains('card')) {
      card.classList.add('selected');
      card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: silent ? 'auto' : 'smooth' });
      if (App.focus.s === 0 && secEl) secEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
      if (g.type === 'rom') chip(`🎮 Emulator: <b>${esc(g.emulatorName)}</b>${g.emulatorOverride ? ' (eigene Wahl)' : ''}`, 'emu');
      else chip(esc(g.source || sys.name));
      if (isFav(g.id)) chip('★ Favorit', 'fav');
      const pt = fmtPlaytime((App.cfg.playtime || {})[g.id]);
      if (pt) chip(pt);
      const lp = fmtDate((App.cfg.lastPlayed || {})[g.id]);
      if (lp) chip(lp);
      bg = g.hero || g.cover;
    } else if (item.kind === 'system') {
      const s = item.system;
      $('#heroSystem').innerHTML = `<span class="dot" style="background:${esc(s.color)};color:${esc(s.color)}"></span>Emulator`;
      $('#heroTitle').textContent = s.name;
      chip(`🎮 ${esc(s.emulatorName)}`, 'emu');
      chip(s.emulatorFound ? '✔ Emulator gefunden' : '✖ Emulator nicht gefunden', s.emulatorFound ? 'ok' : 'bad');
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
  async function launch(game) {
    if (App.running) return App.toast('Es läuft bereits ein Spiel.', 'error');
    Sounds.play('launch');
    try {
      const st = await api.launch(game.id);
      if (st && st.running) showRunning(st);
      else App.toast(`${game.name} wird geöffnet …`);
    } catch (err) {
      Sounds.play('error');
      App.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    }
  }

  async function addGameFlow() {
    const exe = await api.pickFile();
    if (!exe) return;
    const name = exe.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, '');
    App.cfg.pcGames.push({ id: 'pc-' + Date.now(), name, exe, args: '', cwd: '', cover: '', killMode: 'dir', processName: '' });
    await App.save({ immediate: true, rescan: true });
    App.toast(`„${name}“ hinzugefügt. Name & Cover kannst du über ${'Y'} → Details anpassen.`, 'ok', 5000);
  }

  function activate() {
    const item = focusedItem();
    if (!item) return;
    if (item.kind === 'game') return launch(item.game);
    if (item.kind === 'system') {
      // Mit Spielen: in die Spieleliste springen, sonst die Konsolen-Seite öffnen
      if (item.system.count > 0) moveVertical(1); else systemDetails(item.system);
      return;
    }
    if (item.kind === 'action') {
      Sounds.play('accept');
      if (item.id === 'addGame') return addGameFlow();
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
          { label: okLabel, icon: '✔', action: () => { done = true; App.closeMenu(); resolve(true); } },
          { label: 'Abbrechen', icon: '✕', action: () => App.closeMenu() }
        ],
        onClose: () => !done && resolve(false)
      });
    });
  };

  function renderModal() {
    const m = App.modalStack[App.modalStack.length - 1];
    $('#overlay').classList.toggle('hidden', !m);
    renderHints();
    if (!m) return;
    const box = $('#modal');
    box.className = 'modal ' + (m.className || '');
    box.innerHTML = (m.header || '') + `<h2>${esc(m.title || '')}</h2>` + (m.text ? `<p>${m.text}</p>` : '');
    const list = el('div', 'menu');
    m.items.forEach((it, i) => {
      if (it.type === 'info') {
        list.appendChild(el('div', 'menu-info', `<span>${esc(it.label)}</span><b>${esc(it.value)}</b>`));
        return;
      }
      const b = el('div', 'btn' + (it.danger ? ' danger' : '') + (i === m.focus ? ' focused' : ''));
      if (it.type === 'select') {
        const opt = it.options.find((o) => o.value === it.value) || it.options[0] || { label: '-' };
        b.innerHTML = `<span class="ico">${it.icon || ''}</span><span class="grow">${esc(it.label)}</span><span class="select"><span class="arrow">◀</span>${esc(opt.label)}<span class="arrow">▶</span></span>`;
      } else {
        b.innerHTML = `<span class="ico">${it.icon || ''}</span><span class="grow">${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}`;
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
      { label: 'Spielen', icon: '▶', action: () => { App.closeMenu(); launch(game); } },
      { label: isFav(game.id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', icon: '★', action: () => { App.closeMenu(); toggleFavorite(game); } }
    ];
    if (game.type === 'rom') {
      const sysCfg = App.cfg.systems.find((s) => s.id === game.system);
      const options = [{ value: '', label: `Standard (${(App.library.emulators.find((e) => e.id === (sysCfg && sysCfg.emulator)) || { name: '–' }).name})` }]
        .concat(App.library.emulators.map((e) => ({ value: e.id, label: e.name + (e.found ? '' : ' ⚠') })));
      items.push({
        type: 'select', label: 'Starten mit', icon: '🎮', options, value: ov.emulator || '',
        onChange: (v) => { if (v) ov.emulator = v; else delete ov.emulator; cleanup(); App.save({ rescan: true }); }
      });
    }
    if (game.type === 'rom') items.push({ label: game.cover ? 'Cover neu herunterladen' : 'Cover herunterladen', icon: '⬇', action: async () => {
      App.closeMenu();
      App.toast(`Suche Cover für „${game.name}“ …`, 'info', 2500);
      const r = await App.scrape({ ids: [game.id], force: true });
      const now = gameById(game.id);
      App.toast(now && now.cover ? `✔ Cover für „${game.name}“ geladen` : `Kein Cover für „${game.name}“ gefunden – Tipp: ROM-Datei nach No-Intro/Redump benennen oder ScreenScraper einrichten`, now && now.cover ? 'ok' : 'error', 6000);
      return r;
    } });
    items.push({ label: 'Cover-Bild ändern …', icon: '🖼', action: async () => {
      const p = await api.pickImage();
      if (p) { ov.cover = p; App.closeMenu(); await App.save({ immediate: true, rescan: true }); App.toast('Cover geändert', 'ok'); }
    } });
    if (ov.cover) items.push({ label: 'Standard-Cover verwenden', icon: '↺', action: async () => { delete ov.cover; cleanup(); App.closeMenu(); await App.save({ immediate: true, rescan: true }); } });
    items.push({ label: game.hidden ? 'Wieder anzeigen' : 'Aus Bibliothek ausblenden', icon: '👁', action: async () => {
      if (game.hidden) delete ov.hidden; else ov.hidden = true;
      cleanup(); App.closeMenu(); await App.save({ immediate: true, rescan: true });
      App.toast(game.hidden ? 'Spiel wird wieder angezeigt' : 'Ausgeblendet – wieder einblenden unter Einstellungen → Bibliothek', 'info', 4000);
    } });
    if (game.type === 'pc' && game.system === 'pc') {
      items.push({ label: 'Spiel entfernen', icon: '🗑', danger: true, action: async () => {
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
    const sysCfg = App.cfg.systems.find((x) => x.id === s.id);
    const err = (e) => App.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000);
    App.menu({
      title: s.name,
      text: s.count ? `${s.count} Spiele · Emulator: ${esc(s.emulatorName)}` : 'Noch keine Spiele gefunden – lege ROMs in den ROM-Ordner und lies die Bibliothek neu ein.',
      className: 'system-details',
      items: [
        ...(s.count ? [{ label: 'Spiele anzeigen', icon: '▤', action: () => { App.closeMenu(); moveVertical(1); } }] : []),
        { label: `${s.emulatorName} ohne Spiel starten`, icon: '▶', hint: s.emulatorFound ? 'z.B. zum Einrichten' : 'Emulator nicht gefunden', action: async () => {
          App.closeMenu();
          try { const st = await api.launchEmulator(s.id); if (st && st.running) showRunning(st); } catch (e) { err(e); }
        } },
        { label: 'ROM-Ordner öffnen', icon: '📂', hint: (sysCfg.romDirs || [])[0] || '', action: async () => {
          App.closeMenu();
          try { const d = await api.openRomDir(s.id); App.toast(`Ordner geöffnet: ${d}`, 'ok'); } catch (e) { err(e); }
        } },
        { label: 'ROM-Ordner hinzufügen …', icon: '＋', action: async () => {
          const d = await api.pickFolder();
          if (!d) return;
          sysCfg.romDirs = [...(sysCfg.romDirs || []), d];
          App.closeMenu();
          await App.save({ immediate: true, rescan: true });
          App.toast(`Ordner hinzugefügt – ${(App.library.systems.find((x) => x.id === s.id) || { count: 0 }).count} Spiele gefunden`, 'ok');
        } },
        { label: 'Bibliothek neu einlesen', icon: '↻', action: async () => { App.closeMenu(); await App.refreshLibrary(); } },
        {
          type: 'select', label: 'Emulator', icon: '🎮', value: sysCfg.emulator,
          options: App.library.emulators.map((e) => ({ value: e.id, label: e.name + (e.found ? '' : ' ⚠') })),
          onChange: (v) => { sysCfg.emulator = v; App.save({ rescan: true }); }
        },
        { type: 'info', label: 'ROM-Ordner', value: (sysCfg.romDirs || []).join(' ; ') || '–' },
        { type: 'info', label: 'Dateiendungen', value: (sysCfg.extensions || []).join(' ') },
        { label: 'Fehlende Cover für dieses System laden', icon: '⬇', action: () => { App.closeMenu(); App.scrape({ system: s.id }); } },
        { label: 'Eigenes Logo-Bild wählen …', icon: '🖼', action: async () => {
          const p = await api.pickImage();
          if (!p) return;
          sysCfg.logo = p;
          App.closeMenu();
          await App.save({ immediate: true, rescan: true });
        } },
        ...(sysCfg.logo ? [{ label: 'Standard-Abbildung verwenden', icon: '↺', action: async () => { delete sysCfg.logo; App.closeMenu(); await App.save({ immediate: true, rescan: true }); } }] : []),
        { label: 'In Einstellungen bearbeiten', icon: '⚙', action: () => { App.closeMenu(); openSettings('systems'); } }
      ]
    });
    App.modalStack[App.modalStack.length - 1].header = `<div class="detail-cover sys-hero" style="--c:${esc(s.color)}">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : ConsoleIcons.forSystem(s.id, s.name)}<span>${esc(s.short)}</span></div>`;
    renderModal();
  }

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
        ...(App.update && App.update.status === 'ready' ? [{ label: `Update auf v${App.update.available} installieren`, icon: '⬆', hint: 'App startet neu', action: () => { App.closeMenu(); App.installUpdate(); } }] : []),
        { label: 'Herunterfahren', icon: '⏻', danger: true, action: () => doPower('shutdown', 'Herunterfahren') },
        { label: 'Neu starten', icon: '⟳', action: () => doPower('restart', 'Neu starten') },
        { label: 'Energie sparen', icon: '☾', action: () => doPower('sleep', 'Energie sparen') },
        { label: 'Zum Desktop (Konsolenmodus beenden)', icon: '⇱', action: () => doPower('exit', 'Konsolenmodus beenden') },
        { label: 'Maus- & Tastatursteuerung', icon: '🖱', hint: Glyphs.comboLabel(App.cfg.controller.mouseModeCombo), action: () => { App.closeMenu(); api.toggleMouseMode(); } },
        ...(App.cfg.homeassistant && App.cfg.homeassistant.enabled ? [
          { label: 'Fernseher einschalten / Eingang wählen', icon: '📺', action: async () => { App.closeMenu(); try { await api.haTv(true); App.toast('Fernseher angesteuert', 'ok'); } catch (e) { App.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000); } } },
          { label: 'Fernseher ausschalten', icon: '⏼', action: async () => { App.closeMenu(); try { await api.haTv(false); } catch (e) { App.toast(String(e.message || e), 'error'); } } }
        ] : []),
        { label: 'Bildschirm umschalten …', icon: '🖵', action: displayMenu },
        { label: 'Fehlende Cover herunterladen', icon: '⬇', action: () => { App.closeMenu(); App.scrape({}); } },
        { label: 'Bibliothek neu einlesen', icon: '↻', action: async () => { App.closeMenu(); await App.refreshLibrary(); App.toast(`${App.library.games.length} Spiele gefunden`, 'ok'); } },
        { label: 'Einstellungen', icon: '⚙', action: () => { App.closeMenu(); openSettings(); } }
      ]
    });
  }

  function displayMenu() {
    const set = (mode, label) => { App.closeMenu(); App.closeMenu(); api.setDisplayMode(mode); App.toast(`Anzeige: ${label}`); };
    App.menu({
      title: 'Bildschirm', text: 'Wie Win + P. Nach dem Umschalten passt sich die Oberfläche automatisch an.',
      items: [
        { label: 'Nur zweiter Bildschirm (TV)', icon: '📺', action: () => set('external', 'nur TV') },
        { label: 'Nur PC-Bildschirm', icon: '🖥', action: () => set('internal', 'nur PC-Bildschirm') },
        { label: 'Duplizieren', icon: '⧉', action: () => set('clone', 'dupliziert') },
        { label: 'Erweitern', icon: '⇔', action: () => set('extend', 'erweitert') }
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
  App.backToLibrary = function () {
    App.tabIndex = 0;
    renderTabs();
    showView('home');
    renderHome();
  };

  // ---------- Läuft-Anzeige ----------
  function showRunning(st) {
    App.running = st;
    $('#runningTitle').textContent = st.game.name;
    const combo = Glyphs.comboHtml(App.cfg.controller.closeGameCombo);
    $('#runningHint').innerHTML = `Zum Beenden am Controller ${combo} gedrückt halten`;
    $('#running').classList.remove('hidden');
    renderHints();
  }
  function hideRunning() {
    App.running = null;
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
    else {
      const item = focusedItem();
      if (item && item.kind === 'game') html += hint(glyph('A'), 'Spielen') + hint(glyph('X'), 'Favorit') + hint(glyph('Y'), 'Details');
      else if (item && item.kind === 'system') html += hint(glyph('A'), item.system.count ? 'Spiele' : 'Öffnen') + hint(glyph('Y'), 'Konsole');
      else if (item) html += hint(glyph('A'), 'Öffnen');
      if (App.sections[App.focus.s] && App.sections[App.focus.s].letterJump) html += hint(glyph('LT') + glyph('RT'), 'Buchstabe');
      html += hint(glyph('LB') + glyph('RB'), 'Kategorie') + hint(glyph('START'), 'Menü');
    }
    h.innerHTML = html;
  }
  App.renderHints = renderHints;

  // ---------------- Eingabe ----------------
  Input.on((a) => {
    if (App.recording) return;
    if (App.running) {
      if (a === 'accept') api.kill();
      return;
    }
    if (App.modalStack.length) return modalAction(a);
    if (a === 'lb' || a === 'rb') return switchTab(App.tabIndex + (a === 'rb' ? 1 : -1));
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
        if (App.tabIndex !== 0) switchTab(0);
        else if (App.focus.s || App.focus.i) { setFocus(0, 0); Sounds.play('back'); }
        break;
      case 'x': if (item && item.kind === 'game') toggleFavorite(item.game); break;
      case 'y':
        if (item && item.kind === 'game') gameDetails(item.game);
        else if (item && item.kind === 'system') systemDetails(item.system);
        break;
      case 'lt': letterJump(-1); break;
      case 'rt': letterJump(1); break;
    }
  });

  // ---------------- Controller-Symbole ----------------
  function refreshGlyphs() {
    $('#tabL').outerHTML = Glyphs.html('LB').replace('class="glyph', 'id="tabL" class="glyph bumper');
    $('#tabR').outerHTML = Glyphs.html('RB').replace('class="glyph', 'id="tabR" class="glyph bumper');
    $('#killGlyph').outerHTML = Glyphs.html('A').replace('class="glyph', 'id="killGlyph" class="glyph');
    $('#emptyMenuGlyph').outerHTML = Glyphs.html('START').replace('class="glyph', 'id="emptyMenuGlyph" class="glyph');
    const pad = $('#padStatus');
    pad.textContent = Glyphs.style() === 'keyboard' ? '⌨' : Glyphs.style() === 'playstation' ? 'PS' : Glyphs.style() === 'nintendo' ? 'NS' : '🎮';
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
    applyConfig();
    if (App.cfg.general.hideCursor) document.body.classList.add('hide-cursor');
    App.library = await api.getLibrary();
    if (!App.library.games.length && !App.library.systems.length) App.library = await api.refreshLibrary();
    buildTabs();
    renderHome();
    const st = await api.gameStatus();
    if (st.running) showRunning(st);

    api.onGameStatus((s) => (s.running ? showRunning(s) : hideRunning()));
    api.onConfigChanged((c) => { App.cfg = c; if (App.view === 'home') { const f = { ...App.focus }; renderHome(); setFocus(Math.min(f.s, Math.max(0, App.sections.length - 1)), 0, true); } });
    api.onToast((t) => App.toast(t.text, t.type));
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
    api.onGamepadConnection((c) => {
      if (c.connected && c.type && c.source === 'hid' && !Input.connected()) Glyphs.setDetected('playstation', c.type === 'dualsense' ? 'DualSense' : 'DualShock 4');
      if (c.connected && c.source === 'hid') $('#padStatus').classList.add('on');
    });

    // Updates
    App.update = await api.updateState();
    let announced = '';
    api.onUpdateState((u) => {
      App.update = u;
      if (u.status === 'ready' && announced !== u.available) {
        announced = u.available;
        Sounds.play('accept');
        App.toast(`⬆ Update v${u.available} ist bereit – im Menü (☰) installieren oder es wird beim Beenden automatisch installiert.`, 'ok', 9000);
      }
      if (App.view === 'settings') SettingsView.refreshUpdate && SettingsView.refreshUpdate();
    });
    if (App.cfg.general.startupSound !== false) setTimeout(() => Sounds.play('startup'), 300);
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

  App.installUpdate = async function () {
    if (App.running) return App.toast('Bitte zuerst das Spiel beenden.', 'error');
    App.toast('Update wird installiert – AleGamestation startet gleich neu …', 'ok', 10000);
    Sounds.play('launch');
    setTimeout(() => api.installUpdate(), 900);
  };
  init();
})();
