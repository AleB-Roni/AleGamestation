/* Tastensymbole passend zum Controller: Xbox, PlayStation (✕ ○ □ △), Nintendo.
 * Intern heißen die Tasten immer wie beim Xbox-Layout (A B X Y LB RB LT RT BACK START GUIDE). */
(function () {
  let detected = 'xbox';
  let detectedName = '';
  let configured = 'auto';
  let swapAB = false;
  const listeners = [];

  const STYLES = {
    xbox: {
      A: ['A', 'a'], B: ['B', 'b'], X: ['X', 'x'], Y: ['Y', 'y'],
      LB: ['LB', 'pill'], RB: ['RB', 'pill'], LT: ['LT', 'pill'], RT: ['RT', 'pill'],
      START: ['☰', 'pill'], BACK: ['⧉', 'pill'], GUIDE: ['Xbox', 'pill'], LS: ['LS', 'pill'], RS: ['RS', 'pill'], TOUCHPAD: ['Touchpad', 'pill']
    },
    playstation: {
      A: ['✕', 'ps ps-cross'], B: ['○', 'ps ps-circle'], X: ['□', 'ps ps-square'], Y: ['△', 'ps ps-triangle'],
      LB: ['L1', 'pill'], RB: ['R1', 'pill'], LT: ['L2', 'pill'], RT: ['R2', 'pill'],
      START: ['Options', 'pill'], BACK: ['Create', 'pill'], GUIDE: ['PS', 'pill ps-home'], LS: ['L3', 'pill'], RS: ['R3', 'pill'], TOUCHPAD: ['Touchpad', 'pill']
    },
    nintendo: {
      // Standard-Belegung: unten = B, rechts = A, links = Y, oben = X
      A: ['B', 'nin'], B: ['A', 'nin'], X: ['Y', 'nin'], Y: ['X', 'nin'],
      LB: ['L', 'pill'], RB: ['R', 'pill'], LT: ['ZL', 'pill'], RT: ['ZR', 'pill'],
      START: ['+', 'pill'], BACK: ['−', 'pill'], GUIDE: ['⌂', 'pill'], LS: ['L-Stick', 'pill'], RS: ['R-Stick', 'pill'], TOUCHPAD: ['', 'pill']
    }
  };
  const NAMES = { xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo' };

  function style() {
    return configured && configured !== 'auto' ? configured : detected;
  }

  /** Physische Taste für eine Bedien-Taste (bei vertauschtem A/B) */
  function physical(key) {
    if (swapAB && key === 'A') return 'B';
    if (swapAB && key === 'B') return 'A';
    return key;
  }

  function label(key) {
    const s = STYLES[style()];
    const k = String(key).toUpperCase();
    if (s[k]) return s[k][0];
    return key;
  }

  function html(key, { raw = false } = {}) {
    const k = raw ? String(key).toUpperCase() : physical(String(key).toUpperCase());
    const def = STYLES[style()][k];
    if (!def) return `<span class="glyph pill">${key}</span>`;
    return `<span class="glyph ${def[1]}">${def[0]}</span>`;
  }

  /** "BACK+START" -> Symbole des aktuellen Controllers */
  function comboHtml(combo) {
    return String(combo || '').split('+').map((k) => html(k.trim(), { raw: true })).join(' + ');
  }
  function comboLabel(combo) {
    return String(combo || '').split('+').map((k) => label(k.trim())).join(' + ');
  }

  function typeFromId(id) {
    if (/054c|dualsense|dualshock|playstation|wireless controller/i.test(id)) return 'playstation';
    if (/057e|pro controller|joy-con|nintendo|switch/i.test(id)) return 'nintendo';
    return 'xbox';
  }

  function setDetected(type, name) {
    if (!type || (type === detected && name === detectedName)) return;
    const changed = type !== detected;
    detected = type;
    detectedName = name || '';
    if (changed) listeners.forEach((fn) => fn(style()));
  }

  window.Glyphs = {
    html, label, comboHtml, comboLabel, style, typeFromId, setDetected,
    detected: () => ({ type: detected, name: detectedName, label: NAMES[detected] }),
    configure: (opts) => {
      const before = style();
      if (opts.style) configured = opts.style;
      if ('swapAB' in opts) swapAB = !!opts.swapAB;
      if (style() !== before) listeners.forEach((fn) => fn(style()));
    },
    onChange: (fn) => listeners.push(fn),
    NAMES
  };
})();
