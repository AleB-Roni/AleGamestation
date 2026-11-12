/* Einheitliche Eingabe: Controller (Gamepad API) + Tastatur -> Aktionen
 * Aktionen: up down left right accept back x y lb rb start select */
(function () {
  const listeners = [];
  const state = { swapAB: false, analog: true, paused: false, raw: null };
  // Standard-Mapping der Gamepad API (Xbox-Layout)
  const MAP = { 0: 'accept', 1: 'back', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'ls', 11: 'rs', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'guide' }; // 17 = Touchpad-Klick: wird als Mausklick verwendet
  const COMBO_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'BACK', 9: 'START', 10: 'LS', 11: 'RS', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT', 16: 'GUIDE', 17: 'TOUCHPAD' };
  const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'lb', 'rb', 'lt', 'rt']);
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
  // latched: seit der letzten Abfrage neu gedrückte Tasten (gehen auch bei blitzschnellem Antippen nicht verloren)
  const hid = { mask: 0, axes: [0, 0, 0, 0], at: 0, connected: 0, latched: 0 };

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
    // Q/E (Bild auf/ab): große Tabs wie L2/R2 · Z/C: Bereiche wie L1/R1
    q: 'lt', e: 'rt', pageup: 'lt', pagedown: 'rt',
    z: 'lb', c: 'rb',
    m: 'start', f1: 'start', o: 'select', f2: 'select'
  };
  window.addEventListener('keydown', (ev) => {
    if ((ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) || ev.key === 'BrowserBack' || ev.key === 'BrowserForward') {
      ev.preventDefault();
      emit(ev.key === 'ArrowLeft' || ev.key === 'BrowserBack' ? 'back' : 'forward', 'keyboard');
      return;
    }
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
    if (ev.repeat && !['up', 'down', 'left', 'right', 'lb', 'rb', 'lt', 'rt'].includes(a)) return;
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
        if (!((hid.mask | hid.latched) & bit)) continue;
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
    hid.latched = 0;
  }
  // Fester Takt statt Bildwiederholung: wird bei verdeckten/transparenten Fenstern nicht gedrosselt
  setInterval(poll, 16);

  // ---------- Maus: Seitentasten zurück/vor, Rechtsklick = zurück ----------
  const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  window.addEventListener('mousedown', (ev) => { if (ev.button === 3 || ev.button === 4) ev.preventDefault(); });
  window.addEventListener('mouseup', (ev) => {
    if (ev.button === 3 || ev.button === 4) {
      ev.preventDefault();
      state.lastMouseNav = performance.now();
      emit(ev.button === 3 ? 'back' : 'forward', 'mouse');
    }
  });
  window.addEventListener('contextmenu', (ev) => {
    if (isTyping(ev.target)) return; // in Textfeldern das normale Menü (Einfügen …)
    ev.preventDefault();
    if (state.rightClickBack !== false) emit('back', 'mouse');
  });

  // ---------- Maus: Tasten-Symbole anklicken (Hinweisleiste, Reiter-Pfeile, Zurück-Hinweise) ----------
  const KEY_ACTION = { A: 'accept', B: 'back', X: 'x', Y: 'y', LB: 'lb', RB: 'rb', LT: 'lt', RT: 'rt', START: 'start', BACK: 'select', GUIDE: 'guide', LEFT: 'left', RIGHT: 'right', UP: 'up', DOWN: 'down' };
  window.addEventListener('click', (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    const scope = t.closest('.mouse-keys');
    if (!scope) return;
    let k = t.closest('[data-k]');
    // Klick auf den Text eines Hinweises mit genau einem Symbol: dieses Symbol
    if (!k) { const h = t.closest('.hint'); const ks = h ? h.querySelectorAll('[data-k]') : []; if (ks.length === 1) k = ks[0]; }
    const a = k && KEY_ACTION[k.dataset.k];
    if (!a) return;
    ev.preventDefault(); ev.stopPropagation();
    emit(a, 'mouse');
  }, true);

  window.Input = {
    on: (fn) => listeners.push(fn),
    /** Aktion auslösen, als käme sie vom Controller (z.B. Zurück-Knopf in der Oberfläche) */
    trigger: (action, source = 'mouse') => emit(action, source),
    /** Seitentaste über Windows gemeldet: nur, wenn sie nicht schon als Mausklick ankam */
    navCommand: (action) => { if (performance.now() - (state.lastMouseNav || 0) > 400) emit(action, 'mouse'); },
    configure: (opts) => Object.assign(state, opts),
    setPaused: (v) => { state.paused = !!v; held.clear(); },
    /** aktuell gedrückte Tasten als Namen (für Kombinations-Aufnahme) */
    rawButtons: () => [...(state.raw || [])],
    connected: () => connected + hid.connected,
    /** Zustand eines direkt gelesenen PlayStation-Controllers (von der App) */
    hidState: (s) => {
      const next = s.mask < 0 ? 0 : s.mask;
      hid.latched |= next & ~hid.mask;
      hid.mask = next;
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
