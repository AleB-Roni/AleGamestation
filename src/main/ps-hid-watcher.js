'use strict';
/**
 * Liest PlayStation-Controller (DualSense, DualSense Edge, DualShock 4) direkt per HID –
 * USB und Bluetooth, ohne Steam Input oder DS4Windows. Liefert die Tasten im selben
 * Bit-Format wie der XInput-Watcher, damit die Tastenkombinationen für alle Controller gleich funktionieren.
 */
const { EventEmitter } = require('events');
const { BUTTONS } = require('./gamepad-watcher');
const { parseTouch } = require('./touchpad');

const SONY = 0x054c;
const DUALSENSE = new Set([0x0ce6, 0x0df2]);
const DUALSHOCK4 = new Set([0x05c4, 0x09cc, 0x0ba0]);

const HAT = [
  BUTTONS.UP, BUTTONS.UP | BUTTONS.RIGHT, BUTTONS.RIGHT, BUTTONS.DOWN | BUTTONS.RIGHT,
  BUTTONS.DOWN, BUTTONS.DOWN | BUTTONS.LEFT, BUTTONS.LEFT, BUTTONS.UP | BUTTONS.LEFT
];

/** Wandelt einen HID-Input-Report in eine Tastenmaske um (oder null, wenn unbekannt). */
function parseReport(productId, data) {
  const b = data;
  if (!b || b.length < 10) return null;
  const ds = DUALSENSE.has(productId);
  let o; let l2; let r2;
  if (b[0] === 0x01 && b.length >= 64) {
    if (ds) { o = 8; l2 = 5; r2 = 6; } else { o = 5; l2 = 8; r2 = 9; }
  } else if (b[0] === 0x31 && ds && b.length >= 12) { o = 9; l2 = 6; r2 = 7; } // DualSense Bluetooth (erweitert)
  else if (b[0] === 0x11 && !ds && b.length >= 12) { o = 7; l2 = 10; r2 = 11; } // DualShock 4 Bluetooth (erweitert)
  else if (b[0] === 0x01) { o = 5; l2 = 8; r2 = 9; } // Bluetooth (einfacher Modus)
  else return null;

  const b0 = b[o]; const b1 = b[o + 1]; const b2 = b[o + 2];
  let mask = 0;
  const hat = b0 & 0x0f;
  if (hat < 8) mask |= HAT[hat];
  if (b0 & 0x10) mask |= BUTTONS.X; // □
  if (b0 & 0x20) mask |= BUTTONS.A; // ✕
  if (b0 & 0x40) mask |= BUTTONS.B; // ○
  if (b0 & 0x80) mask |= BUTTONS.Y; // △
  if (b1 & 0x01) mask |= BUTTONS.LB;
  if (b1 & 0x02) mask |= BUTTONS.RB;
  if ((b1 & 0x04) || b[l2] > 120) mask |= BUTTONS.LT;
  if ((b1 & 0x08) || b[r2] > 120) mask |= BUTTONS.RT;
  if (b1 & 0x10) mask |= BUTTONS.BACK; // Create / Share
  if (b1 & 0x20) mask |= BUTTONS.START; // Options
  if (b1 & 0x40) mask |= BUTTONS.LS;
  if (b1 & 0x80) mask |= BUTTONS.RS;
  if (b2 & 0x01) mask |= BUTTONS.GUIDE; // PS-Taste
  if (b2 & 0x02) mask |= BUTTONS.TOUCHPAD;
  return mask;
}

/** Analog-Sticks: [lx, ly, rx, ry] im Bereich -1..1 (Y nach unten positiv) oder null */
function parseAxes(productId, data) {
  const b = data;
  if (!b || b.length < 10) return null;
  const ds = DUALSENSE.has(productId);
  let o;
  if (b[0] === 0x01) o = 1;
  else if (b[0] === 0x31 && ds) o = 2;
  else if (b[0] === 0x11 && !ds) o = 3;
  else return null;
  return [b[o], b[o + 1], b[o + 2], b[o + 3]].map((v) => Math.max(-1, Math.min(1, (v - 128) / 127)));
}

class PsHidWatcher extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map(); // path -> { dev, last }
    this.timer = null;
    this.HID = null;
  }

  start() {
    if (this.timer) return;
    try { this.HID = require('node-hid'); } catch (err) {
      this.emit('log', 'node-hid nicht verfügbar: ' + err.message);
      return;
    }
    const scan = async () => {
      try {
        const list = (await this.HID.devicesAsync()).filter((d) => d.vendorId === SONY && (DUALSENSE.has(d.productId) || DUALSHOCK4.has(d.productId)));
        // Nur die Gamepad-Schnittstelle (Usage Page 1, Usage 5) öffnen
        for (const d of list.filter((x) => !x.usagePage || (x.usagePage === 1 && x.usage === 5))) {
          if (!d.path || this.devices.has(d.path)) continue;
          await this._open(d);
        }
      } catch (err) { this.emit('log', String(err)); }
      this.timer = setTimeout(scan, 3000);
    };
    scan();
  }

  async _open(info) {
    try {
      const dev = await this.HID.HIDAsync.open(info.path);
      const entry = { dev, last: -2 };
      this.devices.set(info.path, entry);
      const type = DUALSENSE.has(info.productId) ? 'dualsense' : 'dualshock4';
      this.emit('connection', { id: info.path, type, connected: true, name: info.product });
      // Per Bluetooth senden die Controller erst nach dem Lesen des Kalibrier-Reports den
      // erweiterten Report (mit Touchpad-Daten). Per USB ist das harmlos.
      try { await dev.getFeatureReport(DUALSENSE.has(info.productId) ? 0x05 : 0x02, DUALSENSE.has(info.productId) ? 41 : 37); } catch { /* ignore */ }
      dev.on('data', (data) => {
        const mask = parseReport(info.productId, data);
        if (mask === null) return;
        const touch = parseTouch(info.productId, data);
        if (touch) {
          const tsig = (mask & BUTTONS.TOUCHPAD ? 'B' : '') + touch.fingers.map((f) => `${f.id}:${f.x}:${f.y}`).join('|');
          if (tsig !== entry.tsig) {
            entry.tsig = tsig;
            this.emit('touch', { id: 'ps:' + info.path, touch, button: !!(mask & BUTTONS.TOUCHPAD) });
          }
        }
        const axes = parseAxes(info.productId, data) || [0, 0, 0, 0];
        // Sticks gerundet vergleichen, damit nicht jeder Report (250+/s) ein Ereignis auslöst
        const sig = mask + ':' + axes.map((v) => Math.round(v * 32)).join(',');
        if (sig !== entry.sig) {
          entry.sig = sig;
          this.emit('state', { id: 'ps:' + info.path, mask, axes });
        }
        if (mask === entry.last) return;
        entry.last = mask;
        this.emit('buttons', { id: info.path, mask });
      });
      dev.on('error', () => this._close(info.path, type));
    } catch (err) {
      this.emit('log', `PlayStation-Controller konnte nicht geöffnet werden: ${err.message}`);
    }
  }

  _close(path, type) {
    const e = this.devices.get(path);
    if (!e) return;
    try { e.dev.close(); } catch { /* ignore */ }
    this.devices.delete(path);
    this.emit('buttons', { id: path, mask: -1 });
    this.emit('connection', { id: path, type, connected: false });
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const p of [...this.devices.keys()]) this._close(p);
  }
}

module.exports = { PsHidWatcher, parseReport, parseAxes };
