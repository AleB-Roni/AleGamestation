'use strict';
/**
 * Maus- & Tastatursteuerung per Controller ("Desktop-Modus").
 * Linker Stick = Maus, rechter Stick = Scrollen, ✕/A = Linksklick, ○/B = Rechtsklick,
 * □/X = Bildschirmtastatur, △/Y = Enter, Steuerkreuz = Pfeiltasten, L1/LB = Alt+Tab,
 * R1/RB = Tab, L2/LT = Rücktaste, R2/RT = Präzisionsmodus (langsam), Options/Start = Esc, L3 = Mittelklick.
 */
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const path = require('path');
const { BUTTONS } = require('./gamepad-watcher');

const VK = { ENTER: 0x0d, ESC: 0x1b, TAB: 0x09, BACK: 0x08, ALT: 0x12, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28 };

// Tastenbelegung: Taste -> Aktion
const MAPPING = [
  { button: 'A', action: { mouse: 'L' } },
  { button: 'B', action: { mouse: 'R' } },
  { button: 'LS', action: { mouse: 'M' } },
  { button: 'X', action: { special: 'keyboard' } },
  { button: 'Y', action: { key: VK.ENTER } },
  { button: 'START', action: { key: VK.ESC } },
  { button: 'RB', action: { key: VK.TAB } },
  { button: 'LT', action: { key: VK.BACK, repeat: true } },
  { button: 'LB', action: { special: 'alttab' } },
  { button: 'UP', action: { key: VK.UP, repeat: true } },
  { button: 'DOWN', action: { key: VK.DOWN, repeat: true } },
  { button: 'LEFT', action: { key: VK.LEFT, repeat: true } },
  { button: 'RIGHT', action: { key: VK.RIGHT, repeat: true } }
];

/** Stick-Wert mit Totzone und Beschleunigungskurve (-1..1 -> -1..1) */
function curve(v, deadzone = 0.18) {
  const a = Math.abs(v);
  if (a < deadzone) return 0;
  const n = (a - deadzone) / (1 - deadzone);
  return Math.sign(v) * n * n;
}

class MouseMode extends EventEmitter {
  /**
   * @param {{ getConfig: Function, send?: (line: string) => void }} opts
   *  send: zum Testen; sonst wird das PowerShell-Hilfsprogramm gestartet
   */
  constructor(opts) {
    super();
    this.getConfig = opts.getConfig;
    this._send = opts.send || null;
    this.proc = null;
    this.active = false;
    this.pads = new Map(); // id -> { mask, axes, at }
    this.prevMask = 0;
    this.acc = { x: 0, y: 0, w: 0, h: 0 };
    this.repeat = new Map(); // button -> next time
    this.timer = null;
    this.lastTick = 0;
  }

  _helper() {
    if (this._send) return this._send;
    if (process.platform !== 'win32') return () => {};
    if (!this.proc) {
      const script = path.join(__dirname, 'input-helper.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      this.proc.on('exit', () => { this.proc = null; });
    }
    return (line) => { try { this.proc && this.proc.stdin.write(line + '\n'); } catch { /* ignore */ } };
  }

  send(line) {
    this._helper()(line);
  }

  /** Neuer Zustand eines Controllers (von XInput- oder PlayStation-Watcher) */
  update({ id, mask, axes }) {
    if (mask < 0) { this.pads.delete(id); return; }
    const prev = this.pads.get(id);
    const moved = !prev || prev.mask !== mask || axes.some((v, i) => Math.abs(v - prev.axes[i]) > 0.05);
    this.pads.set(id, { mask, axes, at: moved ? Date.now() : prev.at });
  }

  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    this.active = on;
    if (on) {
      // Tasten, die beim Einschalten gedrückt sind (die Kombination selbst), nicht auslösen
      this.ignoreUntilRelease = this._current().mask;
      this.prevMask = 0;
      this.acc = { x: 0, y: 0, w: 0, h: 0 };
      this.lastTick = Date.now();
      this.timer = setInterval(() => this.tick(), 1000 / 90);
      this._helper();
    } else {
      clearInterval(this.timer);
      this.timer = null;
      this._releaseAll();
    }
    this.emit('active', on);
  }

  toggle() {
    this.setActive(!this.active);
    return this.active;
  }

  /** Zuletzt benutzter Controller */
  _current() {
    let best = { mask: 0, axes: [0, 0, 0, 0], at: 0 };
    for (const p of this.pads.values()) if (p.at >= best.at) best = p;
    return best;
  }

  _releaseAll() {
    for (const m of MAPPING) {
      if (this.prevMask & BUTTONS[m.button]) this._action(m.action, false);
    }
    this.prevMask = 0;
    this.repeat.clear();
  }

  _action(action, down) {
    if (action.mouse) this.send(`b ${action.mouse} ${down ? 1 : 0}`);
    else if (action.key) this.send(`k ${action.key} ${down ? 1 : 0}`);
    else if (action.special === 'alttab' && down) {
      ['k 18 1', 'k 9 1', 'k 9 0', 'k 18 0'].forEach((l) => this.send(l));
    } else if (action.special === 'keyboard' && down) {
      this.emit('keyboard');
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const c = (this.getConfig().controller || {});
    const speed = (c.mouseSpeed || 1) * 1400; // Pixel pro Sekunde bei vollem Ausschlag
    const { mask, axes } = this._current();

    // Kombinations-Tasten erst nach dem Loslassen wieder benutzen
    if (this.ignoreUntilRelease) this.ignoreUntilRelease &= mask;
    const effective = mask & ~this.ignoreUntilRelease;
    // Während BACK/Create gedrückt ist, keine Aktionen (Platz für Tastenkombinationen)
    const blocked = mask & BUTTONS.BACK;

    // Maus bewegen
    const precise = effective & BUTTONS.RT ? 0.3 : 1;
    this.acc.x += curve(axes[0]) * speed * precise * dt;
    this.acc.y += curve(axes[1]) * speed * precise * dt;
    const mx = Math.trunc(this.acc.x); const my = Math.trunc(this.acc.y);
    if (mx || my) { this.send(`m ${mx} ${my}`); this.acc.x -= mx; this.acc.y -= my; }

    // Scrollen (rechter Stick): bis zu ~15 Rasten pro Sekunde
    this.acc.w += -curve(axes[3], 0.25) * 15 * 120 * dt;
    this.acc.h += curve(axes[2], 0.25) * 15 * 120 * dt;
    const w = Math.trunc(this.acc.w / 30) * 30; const h = Math.trunc(this.acc.h / 30) * 30;
    if (w) { this.send(`w ${w}`); this.acc.w -= w; }
    if (h) { this.send(`h ${h}`); this.acc.h -= h; }

    // Tasten
    const cur = blocked ? 0 : effective;
    for (const m of MAPPING) {
      const bit = BUTTONS[m.button];
      const was = !!(this.prevMask & bit); const is = !!(cur & bit);
      if (is && !was) {
        this._action(m.action, true);
        if (m.action.repeat) this.repeat.set(m.button, now + 400);
      } else if (!is && was) {
        if (m.action.mouse || m.action.key) this._action(m.action, false);
        this.repeat.delete(m.button);
      } else if (is && m.action.repeat && now >= (this.repeat.get(m.button) || Infinity)) {
        this.send(`k ${m.action.key} 1`);
        this.repeat.set(m.button, now + 60);
      }
    }
    this.prevMask = cur;
  }

  /** Bildschirmtastatur von Windows ein-/ausblenden */
  toggleKeyboard() {
    if (process.platform !== 'win32') return;
    execFile('tasklist', ['/FI', 'IMAGENAME eq osk.exe', '/NH'], { windowsHide: true }, (err, out) => {
      if (String(out || '').toLowerCase().includes('osk.exe')) execFile('taskkill', ['/IM', 'osk.exe', '/F'], { windowsHide: true }, () => {});
      else {
        const osk = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'osk.exe');
        spawn('cmd.exe', ['/c', 'start', '', osk], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      }
    });
  }

  stop() {
    this.setActive(false);
    if (this.proc) { try { this.proc.kill(); } catch { /* ignore */ } this.proc = null; }
  }
}

module.exports = { MouseMode, curve, MAPPING };
