'use strict';
/**
 * PlayStation-Controller per Bluetooth koppeln (bt-pair.ps1): nicht verbundene PS-Controller entfernen,
 * nach Controllern im Kopplungsmodus suchen und koppeln. Fortschritt kommt Zeile für Zeile als JSON.
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');

class BtPair extends EventEmitter {
  constructor() {
    super();
    this.running = false;
  }

  /** @returns {Promise<{ ok: boolean, paired: number, removed: number, failed: number, names: string[], error?: string }>} */
  run({ rounds = 3, timeout = 8 } = {}) {
    if (this.running) return Promise.reject(new Error('Die Controller-Suche läuft bereits'));
    if (process.platform !== 'win32') return Promise.resolve({ ok: false, paired: 0, removed: 0, failed: 0, names: [], error: 'Bluetooth-Koppeln geht nur unter Windows' });
    this.running = true;
    const script = path.join(__dirname, 'bt-pair.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    return new Promise((resolve) => {
      const result = { ok: false, paired: 0, removed: 0, failed: 0, names: [], error: '' };
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Rounds', String(rounds), '-Timeout', String(timeout)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d; });
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let step;
        try { step = JSON.parse(line); } catch { return; }
        if (step.t === 'radio' && !step.ok) result.error = 'Kein Bluetooth gefunden – ist Bluetooth am PC eingeschaltet?';
        if (step.t === 'paired') result.names.push(step.name);
        if (step.t === 'done') Object.assign(result, { ok: true, paired: step.paired, removed: step.removed, failed: step.failed });
        this.emit('progress', step);
      });
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, (rounds * (timeout * 1.3 + 25) + 30) * 1000);
      proc.on('close', (code) => {
        clearTimeout(timer);
        this.running = false;
        if (!result.ok && !result.error) result.error = (stderr.trim().split('\n').pop() || `Abgebrochen (Code ${code})`).slice(0, 300);
        this.emit('progress', { t: 'end', ...result });
        resolve(result);
      });
      proc.on('error', (err) => { result.error = err.message; });
    });
  }
}

module.exports = { BtPair };
