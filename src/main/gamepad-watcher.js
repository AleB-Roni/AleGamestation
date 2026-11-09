'use strict';
/**
 * Globale Controller-Tastenkombinationen (auch wenn ein Spiel im Vordergrund läuft).
 * Unter Windows wird ein kleiner PowerShell-/XInput-Prozess gestartet (keine Installation nötig).
 */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const readline = require('readline');

const BUTTONS = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LS: 0x0040, RS: 0x0080,
  LB: 0x0100, RB: 0x0200, GUIDE: 0x0400,
  A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
  LT: 0x10000, RT: 0x20000
};
const ALIASES = { SELECT: 'BACK', VIEW: 'BACK', MENU: 'START', OPTIONS: 'START', SHARE: 'BACK', HOME: 'GUIDE', PS: 'GUIDE', XBOX: 'GUIDE', L1: 'LB', R1: 'RB', L2: 'LT', R2: 'RT', L3: 'LS', R3: 'RS' };

/** "BACK+START" -> Bitmaske (0 = ungültig) */
function parseCombo(str) {
  let mask = 0;
  for (const raw of String(str || '').toUpperCase().split(/[+\s,]+/).filter(Boolean)) {
    const name = ALIASES[raw] || raw;
    if (!BUTTONS[name]) return 0;
    mask |= BUTTONS[name];
  }
  return mask;
}

class GamepadWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.combos = []; // { name, mask, holdMs }
    this.state = new Map(); // controller -> { mask, timers }
    this.stopped = false;
  }

  setCombos(list) {
    this.combos = list.map((c) => ({ ...c, mask: parseCombo(c.combo) })).filter((c) => c.mask);
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    let script = path.join(__dirname, 'xinput-watcher.ps1');
    // In der gepackten App liegt das Skript außerhalb des asar-Archivs
    script = script.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      const [idx, mask] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(idx)) this._update(idx, mask);
    });
    this.proc.stderr.on('data', (d) => this.emit('log', String(d)));
    this.proc.on('exit', () => {
      this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 3000); // automatisch neu starten
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
    this.proc = null;
  }

  _update(idx, mask) {
    const st = this.state.get(idx) || { mask: 0, timers: new Map() };
    this.state.set(idx, st);
    if (mask < 0) {
      st.mask = 0;
      for (const t of st.timers.values()) clearTimeout(t);
      st.timers.clear();
      this.emit('connection', { index: idx, connected: false });
      return;
    }
    if (st.mask === 0 && mask === 0 && !st.seen) this.emit('connection', { index: idx, connected: true });
    st.seen = true;
    st.mask = mask;
    for (const combo of this.combos) {
      const active = (mask & combo.mask) === combo.mask;
      const timer = st.timers.get(combo.name);
      if (active && !timer) {
        st.timers.set(combo.name, setTimeout(() => {
          st.timers.set(combo.name, 'fired');
          this.emit('combo', { name: combo.name, controller: idx });
        }, combo.holdMs || 0));
      } else if (!active && timer) {
        if (timer !== 'fired') clearTimeout(timer);
        st.timers.delete(combo.name);
      }
    }
  }
}

module.exports = { GamepadWatcher, parseCombo, BUTTONS };
