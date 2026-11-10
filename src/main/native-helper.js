'use strict';
/**
 * Gemeinsames Windows-Hilfsprogramm (input-helper.ps1): Maus/Tastatur (SendInput),
 * Medientasten und Fenster-Fokus (Overlay über Vollbild-Spielen).
 * send(line) = Befehl ohne Antwort, request(cmd) = Anfrage mit Antwort.
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const IS_WIN = process.platform === 'win32';

class NativeHelper {
  constructor() {
    this.proc = null;
    this.seq = 0;
    this.pending = new Map(); // id -> resolve
  }

  _ensure() {
    if (!IS_WIN) return null;
    if (this.proc) return this.proc;
    const script = path.join(__dirname, 'input-helper.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const m = line.trim().match(/^a (\d+) ?(.*)$/);
      if (!m) return;
      const done = this.pending.get(Number(m[1]));
      if (done) { this.pending.delete(Number(m[1])); done(m[2]); }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      for (const done of this.pending.values()) done('');
      this.pending.clear();
    });
    return this.proc;
  }

  /** Befehl ohne Antwort, z.B. "m 5 0" oder "front 123456 1" */
  send(line) {
    const p = this._ensure();
    if (!p) return;
    try { p.stdin.write(line + '\n'); } catch { /* ignore */ }
  }

  /** Anfrage mit Antwort, z.B. request('fg') -> "123456" ('' bei Zeitüberschreitung) */
  request(cmd, timeoutMs = 1500) {
    const p = this._ensure();
    if (!p) return Promise.resolve('');
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(''); }, timeoutMs);
      this.pending.set(id, (v) => { clearTimeout(timer); resolve(v); });
      try { p.stdin.write(`q ${id} ${cmd}\n`); } catch { clearTimeout(timer); this.pending.delete(id); resolve(''); }
    });
  }

  /** Aktuelles Vordergrundfenster (z.B. das laufende Spiel) */
  async foreground() {
    const v = await this.request('fg');
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Fenster nach vorne holen – auch über Vollbild-Spiele und trotz Windows-Fokus-Sperre */
  front(hwnd, topmost = false) {
    if (hwnd) this.send(`front ${hwnd} ${topmost ? 1 : 0}`);
  }

  /** Fenster ganz nach oben legen, ohne ihm den Fokus zu geben */
  top(hwnd) {
    if (hwnd) this.send(`top ${hwnd}`);
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch { /* ignore */ } this.proc = null; }
  }
}

/** HWND eines Electron-Fensters als Zahl */
function hwndOf(win) {
  if (!win || win.isDestroyed()) return 0;
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

module.exports = { NativeHelper, hwndOf };
