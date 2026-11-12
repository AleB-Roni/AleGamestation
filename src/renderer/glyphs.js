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
  // Tastatur: Bedien-Tasten -> Tastenkappen
  STYLES.keyboard = {
    A: ['Leertaste', 'key'], B: ['Esc', 'key'], X: ['F', 'key'], Y: ['R', 'key'],
    LB: ['Z', 'key'], RB: ['C', 'key'], LT: ['Q', 'key'], RT: ['E', 'key'],
    START: ['M', 'key'], BACK: ['O', 'key'], GUIDE: ['M', 'key'], LS: ['', 'key'], RS: ['', 'key'], TOUCHPAD: ['', 'key']
  };
  const NAMES = { xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo', keyboard: 'Tastatur' };
  let method = 'gamepad';

  /** Symbole des Controllers (ohne Tastatur) – für Tastenkombinationen und Belegungs-Texte */
  function padStyle() {
    return configured && configured !== 'auto' ? configured : detected;
  }

  /** Aktuell angezeigte Symbole: Tastatur, sobald zuletzt mit der Tastatur bedient wurde */
  function style() {
    if (method === 'keyboard' && (!configured || configured === 'auto')) return 'keyboard';
    return padStyle();
  }

  /** Physische Taste für eine Bedien-Taste (bei vertauschtem A/B) */
  function physical(key) {
    if (swapAB && key === 'A') return 'B';
    if (swapAB && key === 'B') return 'A';
    return key;
  }

  function label(key) {
    const s = STYLES[padStyle()];
    const k = String(key).toUpperCase();
    if (s[k]) return s[k][0];
    return key;
  }

  function html(key, { raw = false, pad = false } = {}) {
    const st = pad ? padStyle() : style();
    const k = raw || st === 'keyboard' ? String(key).toUpperCase() : physical(String(key).toUpperCase());
    const def = STYLES[st][k];
    const dk = String(key).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!def) return `<span class="glyph pill" data-k="${dk}">${key}</span>`;
    return `<span class="glyph ${def[1]}" data-k="${dk}">${def[0]}</span>`;
  }

  /** "BACK+START" -> Symbole des aktuellen Controllers */
  function comboHtml(combo) {
    return String(combo || '').split('+').map((k) => html(k.trim(), { raw: true, pad: true })).join(' + ');
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
    if (changed) listeners.forEach((fn) => fn(style(), 'controller'));
  }

  function setInputMethod(m) {
    if (m === method) return;
    const before = style();
    method = m;
    if (style() !== before) listeners.forEach((fn) => fn(style(), 'method'));
  }

  /** ◀ ▶ als anklickbare Pfeile (Maus) */
  const arrows = () => '<span class="click-arrow" data-k="LEFT">◀</span><span class="click-arrow" data-k="RIGHT">▶</span>';

  window.Glyphs = {
    arrows,
    html, label, comboHtml, comboLabel, style, padStyle, typeFromId, setDetected, setInputMethod,
    inputMethod: () => method,
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
