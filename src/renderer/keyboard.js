/* Bildschirmtastatur für den Controller – tippt in das Fenster, das gerade den Fokus hat (Spiel, Browser …) */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VK = { BACK: 0x08, TAB: 0x09, ENTER: 0x0d, LEFT: 0x25, RIGHT: 0x27 };

  // Tasten: Text-Taste = 'a' · Funktionstaste = { label, act, w }
  const F = {
    back: { label: '⌫', act: 'back', w: 1.5, fn: true },
    shift: { label: '⇧', act: 'shift', w: 1.5, fn: true },
    enter: { label: 'Enter', act: 'enter', w: 1.5, fn: true },
    sym: { label: '?123', act: 'sym', w: 1.5, fn: true },
    abc: { label: 'ABC', act: 'sym', w: 1.5, fn: true },
    space: { label: 'Leertaste', act: 'space', w: 5, fn: true },
    left: { label: '◀', act: 'left', fn: true },
    right: { label: '▶', act: 'right', fn: true },
    tab: { label: 'Tab', act: 'tab', fn: true },
    close: { icon: 'x', label: 'Schließen', act: 'close', w: 1.5, fn: true }
  };
  const LAYERS = {
    abc: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß', F.back],
      ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü', '+'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä', '#'],
      [F.shift, 'y', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-', F.enter],
      [F.sym, '@', F.space, F.left, F.right, F.close]
    ],
    sym: [
      ['!', '"', '§', '$', '%', '&', '/', '(', ')', '=', '?', F.back],
      ['€', '*', '~', "'", '`', '´', '^', '°', '|', '\\', '_', '²'],
      ['{', '}', '[', ']', '<', '>', ';', ':', '#', '+', '³', 'µ'],
      [F.tab, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', F.enter],
      [F.abc, '@', F.space, F.left, F.right, F.close]
    ]
  };
  const S = { layer: 'abc', shift: 0, row: 1, col: 0, keys: [] }; // shift: 0 aus, 1 einmal, 2 dauerhaft

  Input.configure({ chromiumPads: false });
  Input.hidConnected(1);
  api.onPadState((s) => Input.hidState(s));

  const textOf = (k) => (S.shift && /^[a-zäöüß]$/.test(k) && k !== 'ß' ? k.toUpperCase() : k);

  function render() {
    const rows = LAYERS[S.layer];
    S.keys = [];
    $('#kbdRows').innerHTML = rows.map((row, r) => `<div class="kbd-row">${row.map((k, c) => {
      const fn = typeof k === 'object';
      const label = fn ? (k.icon ? Icons.svg(k.icon) : '') + (k.label ? `<span>${esc(k.label)}</span>` : '') : esc(textOf(k));
      const on = fn && k.act === 'shift' && S.shift;
      return `<div class="kbd-key${fn ? ' fn' : ''}${on ? ' on' : ''}" data-r="${r}" data-c="${c}" style="flex-grow:${fn ? k.w || 1 : 1}">${label}</div>`;
    }).join('')}</div>`).join('');
    document.querySelectorAll('.kbd-key').forEach((el) => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); S.row = +el.dataset.r; S.col = +el.dataset.c; select(); press(); });
    });
    S.row = Math.min(S.row, rows.length - 1);
    S.col = Math.min(S.col, rows[S.row].length - 1);
    select();
    hints();
  }

  function el(r = S.row, c = S.col) { return document.querySelector(`.kbd-key[data-r="${r}"][data-c="${c}"]`); }
  function select() {
    document.querySelectorAll('.kbd-key.sel').forEach((x) => x.classList.remove('sel'));
    const e = el();
    if (e) e.classList.add('sel');
  }

  /** Hoch/runter: Taste in der Nachbarreihe, deren Mitte am nächsten liegt */
  function moveRow(d) {
    const rows = LAYERS[S.layer];
    const nr = S.row + d;
    if (nr < 0 || nr >= rows.length) return;
    const cur = el().getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    let best = 0; let dist = Infinity;
    rows[nr].forEach((_, c) => {
      const b = el(nr, c).getBoundingClientRect();
      const dd = Math.abs(b.left + b.width / 2 - cx);
      if (dd < dist) { dist = dd; best = c; }
    });
    S.row = nr; S.col = best;
    select(); Sounds.play('move');
  }
  function moveCol(d) {
    const len = LAYERS[S.layer][S.row].length;
    S.col = (S.col + d + len) % len;
    select(); Sounds.play('move');
  }

  function flash(e) { if (!e) return; e.classList.add('hit'); setTimeout(() => e.classList.remove('hit'), 120); }
  function send(k) { api.keyboardKey(k).catch(() => {}); }

  function act(a) {
    switch (a) {
      case 'back': send({ vk: VK.BACK }); break;
      case 'enter': send({ vk: VK.ENTER }); break;
      case 'tab': send({ vk: VK.TAB }); break;
      case 'left': send({ vk: VK.LEFT }); break;
      case 'right': send({ vk: VK.RIGHT }); break;
      case 'space': send({ text: ' ' }); break;
      case 'shift': S.shift = (S.shift + 1) % 3; render(); return;
      case 'sym': S.layer = S.layer === 'abc' ? 'sym' : 'abc'; render(); return;
      case 'close': send({ close: true }); return;
    }
  }

  function press() {
    const k = LAYERS[S.layer][S.row][S.col];
    flash(el());
    Sounds.play('move');
    if (typeof k === 'object') return act(k.act);
    send({ text: textOf(k) });
    if (S.shift === 1) { S.shift = 0; render(); }
  }

  function hints() {
    const h = (g, t) => `<span class="hint">${g} ${t}</span>`;
    const g = (k) => Glyphs.html(k, { raw: true, pad: true });
    $('#kbdHints').innerHTML = h(Glyphs.html('A'), 'Tippen') + h(Glyphs.html('B'), 'Löschen') + h(g('X'), 'Leertaste') + h(g('Y'), 'Umschalt')
      + h(g('LB') + g('RB'), 'Cursor') + h(g('LT'), '?123') + h(g('START'), 'Enter') + h(g('BACK'), 'Schließen');
  }

  Input.on((a) => {
    if (!document.body.classList.contains('open')) return;
    switch (a) {
      case 'up': moveRow(-1); break;
      case 'down': moveRow(1); break;
      case 'left': moveCol(-1); break;
      case 'right': moveCol(1); break;
      case 'accept': press(); break;
      case 'back': flash(el()); act('back'); break;
      case 'x': act('space'); break;
      case 'y': act('shift'); break;
      case 'lb': act('left'); break;
      case 'rb': act('right'); break;
      case 'lt': act('sym'); break;
      case 'rt': case 'start': act('enter'); break;
      case 'select': act('close'); break;
    }
  });

  async function open() {
    try {
      const cfg = await api.getConfig();
      Sounds.setTheme(cfg.general.uiSounds === false ? 'off' : cfg.general.soundTheme || 'modern');
      Sounds.setVolume(cfg.general.soundVolume ?? 0.7);
      document.documentElement.style.setProperty('--accent', cfg.general.accentColor || '#7c5cff');
      document.documentElement.dataset.theme = cfg.general.theme || 'midnight';
      Glyphs.configure({ style: cfg.controller.glyphStyle || 'auto', swapAB: cfg.controller.swapAB });
      const d = await api.overlayData().catch(() => null);
      if (d && d.ps) Glyphs.setDetected('playstation', 'DualSense');
    } catch { /* Standardwerte */ }
    S.layer = 'abc'; S.shift = 0; S.row = 1; S.col = 0;
    render();
    requestAnimationFrame(() => document.body.classList.add('open'));
    Sounds.play('open');
  }
  function close() { document.body.classList.remove('open'); }

  api.onKeyboardOpen(open);
  if (api.onKeyboardClose) api.onKeyboardClose(close);
})();
