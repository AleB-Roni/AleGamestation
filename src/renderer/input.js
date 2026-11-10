/* Einheitliche Eingabe: Controller (Gamepad API) + Tastatur -> Aktionen
 * Aktionen: up down left right accept back x y lb rb start select */
(function () {
  const listeners = [];
  const state = { swapAB: false, analog: true, paused: false, raw: null };
  // Standard-Mapping der Gamepad API (Xbox-Layout)
  const MAP = { 0: 'accept', 1: 'back', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'ls', 11: 'rs', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'guide' }; // 17 = Touchpad-Klick: wird als Mausklick verwendet
  const COMBO_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'BACK', 9: 'START', 10: 'LS', 11: 'RS', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT', 16: 'GUIDE', 17: 'TOUCHPAD' };
  const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'lb', 'rb']);
  const held = new Map(); // action -> { since, last }
  let connected = 0;

  // PlayStation-Controller, direkt von der App per HID gelesen (Bit-Format wie XInput)
  const HID_BITS = [
    [0x0001, 'up', 'UP'], [0x0002, 'down', 'DOWN'], [0x0004, 'left', 'LEFT'], [0x0008, 'right', 'RIGHT'],
    [0x0010, 'start', 'START'], [0x0020, 'select', 'BACK'], [0x0040, 'ls', 'LS'], [0x0080, 'rs', 'RS'],
    [0x0100, 'lb', 'LB'], [0x0200, 'rb', 'RB'], [0x0400, 'guide', 'GUIDE'],
    [0x1000, 'accept', 'A'], [0x2000, 'back', 'B'], [0x4000, 'x', 'X'], [0x8000, 'y', 'Y'],
    [0x10000, 'lt', 'LT'], [0x20000, 'rt', 'RT'], [0x40000, null, 'TOUCHPAD']
  ];
  const hid = { mask: 0, axes: [0, 0, 0, 0], at: 0, connected: 0 };

  function emit(action, source) {
    // Direkt gelesene Controller (hid): die App hat bereits geprüft, ob die Oberfläche bedient werden darf
    if (state.paused || state.gamepadDisabled && source !== 'keyboard') return;
    if (source === 'gamepad' && !document.hasFocus()) return;
    for (const fn of listeners) fn(action, source);
  }

  // ---------- Tastatur ----------
  // Tastatur-Belegung (Groß-/Kleinschreibung egal)
  const KEYS = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    enter: 'accept', ' ': 'accept', escape: 'back', backspace: 'back',
    f: 'x', r: 'y', tab: 'y',
    q: 'lb', e: 'rb', pageup: 'lb', pagedown: 'rb',
    z: 'lt', c: 'rt',
    m: 'start', f1: 'start', o: 'select', f2: 'select'
  };
  window.addEventListener('keydown', (ev) => {
    const t = ev.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (typing) {
      if (ev.key === 'Escape' || ev.key === 'Enter') { t.blur(); ev.preventDefault(); }
      return;
    }
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const a = KEYS[ev.key.toLowerCase()];
    if (!a) return;
    ev.preventDefault();
    if (window.Glyphs) Glyphs.setInputMethod('keyboard');
    // Gehaltene Pfeiltasten/WASD wiederholen (Browser-Wiederholung), andere Tasten nicht
    if (ev.repeat && !['up', 'down', 'left', 'right', 'lb', 'rb'].includes(a)) return;
    emit(a, 'keyboard');
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
    const hidActive = new Set();
    // Solange die App den PlayStation-Controller direkt liest, dessen Chromium-Version ignorieren (sonst doppelte Eingaben)
    // Overlay: Eingaben kommen ausschließlich von der App (state.chromiumPads === false)
    const usePads = state.chromiumPads === false ? [] : hid.connected ? pads.filter((p) => !/054c|dualsense|dualshock|wireless controller/i.test(p.id)) : pads;
    if (hid.connected && hid.at) {
      for (const [bit, a, name] of HID_BITS) {
        if (!(hid.mask & bit)) continue;
        let act = a;
        if (state.swapAB && act === 'accept') act = 'back';
        else if (state.swapAB && act === 'back') act = 'accept';
        if (act) { active.add(act); hidActive.add(act); }
        rawNames.add(name);
      }
      if (state.analog) {
        const [x, y] = hid.axes;
        const add = (a) => { active.add(a); hidActive.add(a); };
        if (x < -0.6) add('left');
        if (x > 0.6) add('right');
        if (y < -0.6) add('up');
        if (y > 0.6) add('down');
      }
    }
    for (const p of usePads) {
      p.buttons.forEach((b, i) => {
        if ((b.pressed || b.value > 0.5) && window.Glyphs && state.lastPad !== p.index) {
          state.lastPad = p.index;
          Glyphs.setDetected(Glyphs.typeFromId(p.id), p.id.split('(')[0].trim());
        }
        if (b.pressed || b.value > 0.5) {
          if (window.Glyphs && !state.paused && !state.gamepadDisabled) Glyphs.setInputMethod('gamepad');
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
      const src = hidActive.has(a) ? 'hid' : 'gamepad';
      if (!h) {
        held.set(a, { since: now, last: now });
        emit(a, src);
      } else if (REPEATABLE.has(a)) {
        const delay = now - h.since > 1200 ? 55 : 110; // schneller scrollen, je länger gehalten
        if (now - h.since > 380 && now - h.last > delay) { h.last = now; emit(a, src); }
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
    connected: () => connected + hid.connected,
    /** Zustand eines direkt gelesenen PlayStation-Controllers (von der App) */
    hidState: (s) => {
      hid.mask = s.mask < 0 ? 0 : s.mask;
      hid.axes = s.axes || [0, 0, 0, 0];
      hid.at = performance.now();
      if (s.mask > 0 && window.Glyphs && !state.paused && !state.gamepadDisabled) Glyphs.setInputMethod('gamepad');
    },
    /** Für die Diagnose: welche Controller kommen auf welchem Weg an */
    debug: () => ({
      pads: (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []).map((p) => p.id.split('(')[0].trim() + (hid.connected && /054c|dualsense|dualshock|wireless controller/i.test(p.id) ? ' (ignoriert, direkt gelesen)' : '')),
      hid: hid.connected,
      lastHid: hid.at ? Math.round((performance.now() - hid.at) / 1000) : null,
      pressed: [...(state.raw || [])]
    }),
    hidConnected: (n) => { hid.connected = Math.max(0, n); if (!hid.connected) { hid.mask = 0; hid.at = 0; } }
  };
})();
