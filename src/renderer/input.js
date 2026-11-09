/* Einheitliche Eingabe: Controller (Gamepad API) + Tastatur -> Aktionen
 * Aktionen: up down left right accept back x y lb rb start select */
(function () {
  const listeners = [];
  const state = { swapAB: false, analog: true, paused: false, raw: null };
  // Standard-Mapping der Gamepad API (Xbox-Layout)
  const MAP = { 0: 'accept', 1: 'back', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'ls', 11: 'rs', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'guide', 17: 'select' };
  const COMBO_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'BACK', 9: 'START', 10: 'LS', 11: 'RS', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT', 16: 'GUIDE', 17: 'TOUCHPAD' };
  const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'lb', 'rb']);
  const held = new Map(); // action -> { since, last }
  let connected = 0;

  function emit(action, source) {
    if (state.paused || (source === 'gamepad' && !document.hasFocus())) return;
    for (const fn of listeners) fn(action, source);
  }

  // ---------- Tastatur ----------
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'accept', ' ': 'accept', Escape: 'back', Backspace: 'back',
    f: 'x', F: 'x', Tab: 'y', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', PageUp: 'lb', PageDown: 'rb',
    F1: 'start', m: 'start', M: 'start', s: 'select', S: 'select'
  };
  window.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (typing) {
      if (ev.key === 'Escape' || ev.key === 'Enter') { t.blur(); ev.preventDefault(); }
      return;
    }
    const a = KEYS[ev.key];
    if (a) { ev.preventDefault(); emit(a, 'keyboard'); }
  });

  // ---------- Controller ----------
  function poll() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads.length !== connected) {
      connected = pads.length;
      document.dispatchEvent(new CustomEvent('gamepads', { detail: connected }));
    }
    const now = performance.now();
    const active = new Set();
    const rawNames = new Set();
    if (pads.length && window.Glyphs && !state.typeSet) { Glyphs.setDetected(Glyphs.typeFromId(pads[0].id), pads[0].id.split('(')[0].trim()); state.typeSet = true; }
    if (!pads.length) state.typeSet = false;
    for (const p of pads) {
      p.buttons.forEach((b, i) => {
        if ((b.pressed || b.value > 0.5) && window.Glyphs && state.lastPad !== p.index) {
          state.lastPad = p.index;
          Glyphs.setDetected(Glyphs.typeFromId(p.id), p.id.split('(')[0].trim());
        }
        if (b.pressed || b.value > 0.5) {
          let a = MAP[i];
          if (state.swapAB && a === 'accept') a = 'back';
          else if (state.swapAB && a === 'back') a = 'accept';
          if (a) active.add(a);
          if (COMBO_NAMES[i]) rawNames.add(COMBO_NAMES[i]);
        }
      });
      if (state.analog && p.axes.length >= 2) {
        const [x, y] = p.axes;
        if (x < -0.6) active.add('left');
        if (x > 0.6) active.add('right');
        if (y < -0.6) active.add('up');
        if (y > 0.6) active.add('down');
      }
    }
    state.raw = rawNames;
    for (const a of active) {
      const h = held.get(a);
      if (!h) {
        held.set(a, { since: now, last: now });
        emit(a, 'gamepad');
      } else if (REPEATABLE.has(a)) {
        const delay = now - h.since > 1200 ? 55 : 110; // schneller scrollen, je länger gehalten
        if (now - h.since > 380 && now - h.last > delay) { h.last = now; emit(a, 'gamepad'); }
      }
    }
    for (const a of [...held.keys()]) if (!active.has(a)) held.delete(a);
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);

  window.Input = {
    on: (fn) => listeners.push(fn),
    configure: (opts) => Object.assign(state, opts),
    setPaused: (v) => { state.paused = !!v; held.clear(); },
    /** aktuell gedrückte Tasten als Namen (für Kombinations-Aufnahme) */
    rawButtons: () => [...(state.raw || [])],
    connected: () => connected
  };
})();
