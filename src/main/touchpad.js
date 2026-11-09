'use strict';
/**
 * Touchpad von DualSense / DualShock 4 als Maus (außerhalb von Spielen).
 *  - 1 Finger bewegen: Maus bewegen
 *  - Touchpad drücken: Linksklick (mit 2 Fingern: Rechtsklick), gedrückt halten = ziehen
 *  - Kurz antippen: Linksklick
 *  - 2 Finger bewegen: scrollen
 */
const { EventEmitter } = require('events');

const DUALSENSE = new Set([0x0ce6, 0x0df2]);

/**
 * Touch-Daten aus einem HID-Report lesen.
 * @returns {{ fingers: {id:number,x:number,y:number}[], width:number, height:number } | null}
 */
function parseTouch(productId, b) {
  if (!b || b.length < 40) return null;
  const ds = DUALSENSE.has(productId);
  let o;
  if (ds) {
    if (b[0] === 0x01 && b.length >= 64) o = 33;
    else if (b[0] === 0x31 && b.length >= 45) o = 34;
    else return null;
  } else {
    if (b[0] === 0x01 && b.length >= 64) o = 35;
    else if (b[0] === 0x11 && b.length >= 45) o = 37;
    else return null;
  }
  const fingers = [];
  for (let f = 0; f < 2; f++) {
    const p = o + f * 4;
    if (b[p] & 0x80) continue; // Bit 7 gesetzt = kein Finger
    fingers.push({
      id: b[p] & 0x7f,
      x: b[p + 1] | ((b[p + 2] & 0x0f) << 8),
      y: (b[p + 2] >> 4) | (b[p + 3] << 4)
    });
  }
  return { fingers, width: 1920, height: ds ? 1080 : 943 };
}

class TouchpadMouse extends EventEmitter {
  /**
   * @param {{ send: (line: string) => void, getConfig: Function, isEnabled: () => boolean }} opts
   */
  constructor(opts) {
    super();
    this.send = opts.send;
    this.getConfig = opts.getConfig;
    this.isEnabled = opts.isEnabled;
    this.dev = new Map(); // Geräte-ID -> Zustand
  }

  _state(id) {
    if (!this.dev.has(id)) this.dev.set(id, { prev: [], button: false, down: null, acc: { x: 0, y: 0, w: 0, h: 0 }, tap: null, maxFingers: 0 });
    return this.dev.get(id);
  }

  /**
   * Neuer Report.
   * @param {string} id Gerät
   * @param {{fingers:Array}} touch Ergebnis von parseTouch
   * @param {boolean} button Touchpad gedrückt
   * @param {number} [now]
   */
  update(id, touch, button, now = Date.now()) {
    const st = this._state(id);
    if (!this.isEnabled()) {
      if (st.down) { this.send(`b ${st.down} 0`); st.down = null; }
      st.prev = touch ? touch.fingers : [];
      st.button = button;
      st.tap = null;
      return;
    }
    const c = this.getConfig().controller || {};
    const fingers = touch ? touch.fingers : [];
    const speed = (c.touchpadSpeed || 1) * 1.25;

    // Klick über die Touchpad-Taste
    if (button && !st.button) {
      st.down = fingers.length >= 2 ? 'R' : 'L';
      this.send(`b ${st.down} 1`);
      st.tap = null; // ein echter Klick ersetzt das Antippen
    } else if (!button && st.button && st.down) {
      this.send(`b ${st.down} 0`);
      st.down = null;
    }
    st.button = button;

    // Bewegung: gleichen Finger (gleiche ID) mit vorherigem Report vergleichen
    const moved = [];
    for (const f of fingers) {
      const p = st.prev.find((q) => q.id === f.id);
      if (p) moved.push({ dx: f.x - p.x, dy: f.y - p.y });
    }
    if (fingers.length === 1 && moved.length === 1) {
      const { dx, dy } = moved[0];
      // leichte Beschleunigung für schnelle Wischbewegungen
      const accel = 1 + Math.min(1.5, Math.hypot(dx, dy) / 40);
      st.acc.x += dx * speed * accel;
      st.acc.y += dy * speed * accel;
      const mx = Math.trunc(st.acc.x); const my = Math.trunc(st.acc.y);
      if (mx || my) { this.send(`m ${mx} ${my}`); st.acc.x -= mx; st.acc.y -= my; }
      if (st.tap) st.tap.dist += Math.hypot(dx, dy);
    } else if (fingers.length >= 2 && moved.length >= 2) {
      // Zwei Finger: scrollen (natürliche Richtung wie am Laptop)
      const dy = (moved[0].dy + moved[1].dy) / 2;
      const dx = (moved[0].dx + moved[1].dx) / 2;
      st.acc.w += dy * 4;
      st.acc.h += -dx * 4;
      const w = Math.trunc(st.acc.w / 40) * 40; const h = Math.trunc(st.acc.h / 40) * 40;
      if (w) { this.send(`w ${w}`); st.acc.w -= w; }
      if (h) { this.send(`h ${h}`); st.acc.h -= h; }
      if (st.tap) st.tap.dist += Math.hypot(dx, dy);
    }

    // Antippen erkennen
    if (fingers.length && !st.prev.length && !button) {
      st.tap = { start: now, dist: 0 };
      st.maxFingers = fingers.length;
    }
    if (fingers.length > st.maxFingers) st.maxFingers = fingers.length;
    if (!fingers.length && st.prev.length && st.tap) {
      if (c.touchpadTap !== false && now - st.tap.start < 220 && st.tap.dist < 25) {
        const b = st.maxFingers >= 2 ? 'R' : 'L';
        this.send(`b ${b} 1`);
        this.send(`b ${b} 0`);
      }
      st.tap = null;
    }
    if (!fingers.length) { st.acc.x = 0; st.acc.y = 0; }
    st.prev = fingers;
  }

  reset() {
    for (const st of this.dev.values()) if (st.down) this.send(`b ${st.down} 0`);
    this.dev.clear();
  }
}

module.exports = { parseTouch, TouchpadMouse };
