/* Startfenster vor der App: Fernseher (Konsolenmodus) oder am PC – mit Countdown zur Standardauswahl */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { sel: 0, left: 0, timer: null, done: false, ask: null };

  // Controller: Xbox per Chromium + alle Controller über die App (PlayStation per HID)
  Input.hidConnected(1);
  if (api.onPadState) api.onPadState((s) => Input.hidState(s));

  const OPTS = () => [
    { id: 'tv', icon: 'tv', title: 'Fernseher', sub: S.ask && S.ask.tv ? `${esc(S.ask.tv)} · Konsolenmodus` : 'Konsolenmodus' },
    { id: 'pc', icon: 'monitor', title: 'Am PC', sub: 'Bildschirme, Hauptbildschirm<br>und Ton bleiben wie jetzt' }
  ];

  function render() {
    $('#chOptions').innerHTML = OPTS().map((o, i) => `<div class="ch-opt${i === S.sel ? ' sel' : ''}" data-i="${i}">${Icons.svg(o.icon)}<b>${o.title}</b><small>${o.sub}</small></div>`).join('');
    document.querySelectorAll('.ch-opt').forEach((el) => {
      el.onmouseenter = () => { if (S.sel !== +el.dataset.i) { S.sel = +el.dataset.i; stopCountdown(); render(); } };
      el.onclick = () => { S.sel = +el.dataset.i; choose(); };
    });
    const h = (g, t, a) => `<span class="hint" data-a="${a}">${g} ${t}</span>`;
    $('#chHints').innerHTML = h(Glyphs.arrows ? Glyphs.arrows() : '◀ ▶', 'Wählen', '') + h(Glyphs.html('A'), 'Starten', 'accept') + h(Glyphs.html('B'), 'Abbrechen', 'back');
    document.querySelectorAll('#chHints .hint[data-a]').forEach((el) => { if (el.dataset.a) el.onclick = () => handle(el.dataset.a); });
    countdownText();
  }

  function countdownText() {
    const def = S.ask && S.ask.def === 'pc' ? 'am PC' : 'auf dem Fernseher';
    $('#chCountdown').innerHTML = S.timer && S.left > 0 ? `Startet in <b>${S.left}</b> Sekunden ${def}` : '';
  }
  function stopCountdown() { if (S.timer) { clearInterval(S.timer); S.timer = null; countdownText(); } }

  async function choose(id) {
    if (S.done) return;
    S.done = true;
    stopCountdown();
    Sounds.play('accept');
    await api.chooseStart(id || OPTS()[S.sel].id);
  }

  function handle(a) {
    if (S.done) return;
    switch (a) {
      case 'left': case 'up': if (S.sel > 0) { S.sel--; stopCountdown(); render(); Sounds.play('move'); } break;
      case 'right': case 'down': if (S.sel < 1) { S.sel++; stopCountdown(); render(); Sounds.play('move'); } break;
      case 'accept': case 'start': choose(); break;
      case 'back': S.done = true; api.chooseStart('cancel'); break;
    }
  }
  Input.on((a) => handle(a));

  (async () => {
    let mode = {};
    try {
      const cfg = await api.getConfig();
      Sounds.setTheme(cfg.general.uiSounds === false ? 'off' : cfg.general.soundTheme || 'modern');
      Sounds.setVolume(cfg.general.soundVolume ?? 0.7);
      document.documentElement.style.setProperty('--accent', cfg.general.accentColor || '#7c5cff');
      document.documentElement.dataset.theme = cfg.general.theme || 'midnight';
      Glyphs.configure({ style: cfg.controller.glyphStyle || 'auto', swapAB: cfg.controller.swapAB });
      Input.configure({ swapAB: cfg.controller.swapAB });
      mode = (await api.appMode()) || {};
    } catch { /* Standardwerte */ }
    S.ask = mode.ask || { seconds: 10, def: 'tv', tv: '' };
    if (S.ask.updated) {
      const h = document.querySelector('#choose h1');
      if (h) h.innerHTML = `<small class="ch-updated">✔ Update auf Version ${esc(S.ask.updated)} installiert</small>Wo möchtest du spielen?`;
    }
    S.sel = S.ask.def === 'pc' ? 1 : 0;
    S.left = Number(S.ask.seconds) || 0;
    if (S.left > 0) {
      S.timer = setInterval(() => {
        S.left--;
        countdownText();
        if (S.left <= 0) choose(S.ask.def === 'pc' ? 'pc' : 'tv');
      }, 1000);
    }
    render();
    requestAnimationFrame(() => document.body.classList.add('open'));
  })();
})();
