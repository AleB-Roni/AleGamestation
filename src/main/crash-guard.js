'use strict';
/**
 * Schutz vor plötzlichem Beenden (Absturz, Task-Manager, Stromausfall):
 * Solange der Konsolenmodus Bildschirme/Ton umgestellt hat, liegt eine Wiederherstellungsdatei
 * mit dem ursprünglichen Stand (Anordnung, Hauptbildschirm, Tonausgabe) im Datenordner.
 *  - Ein unabhängiger Wächter (restore-guard.ps1, per WMI gestartet – überlebt „Task beenden“)
 *    stellt sofort zurück, wenn die App verschwindet, ohne die Datei zu löschen.
 *  - Klappt das nicht (z.B. Stromausfall), stellt die App beim nächsten Start zurück.
 * Beim sauberen Beenden wird die Datei gelöscht – dann passiert nichts.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const unpacked = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

class CrashGuard {
  constructor({ dir, log = () => {} }) {
    this.file = path.join(dir, 'restore-state.json');
    this.log = log;
    this.state = null;
    this.guardStarted = false;
  }

  /** Ursprünglichen Stand festhalten (ergänzt vorhandene Angaben) und den Wächter starten */
  arm(partial) {
    this.state = { ...(this.state || {}), ...partial, pid: process.pid, at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (err) { this.log('Wiederherstellungsdatei schreiben fehlgeschlagen: ' + err.message); }
    this.startGuard();
  }

  /** Nur ergänzen, wenn schon scharf geschaltet (z.B. Tonausgabe) */
  update(partial) {
    if (this.state) this.arm(partial);
  }

  /** Sauber zurückgestellt → nichts mehr zu tun */
  disarm() {
    this.state = null;
    try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
  }

  /**
   * Übrig gebliebener Stand eines plötzlich beendeten Laufs (oder null).
   * Dank Einzelinstanz-Sperre gehört eine vorhandene Datei nie zu einer noch laufenden AleGamestation.
   */
  leftover() {
    const files = [this.file, this.file + '.restoring'];
    for (const f of files) {
      try {
        if (!fs.existsSync(f)) continue;
        // .restoring: der Wächter arbeitet gerade – nur übernehmen, wenn er offenbar hängen geblieben ist
        if (f.endsWith('.restoring') && Date.now() - fs.statSync(f).mtimeMs < 60000) continue;
        const st = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (st && st.pid !== process.pid) return { ...st, _file: f };
      } catch { /* kaputte Datei: ignorieren */ }
    }
    return null;
  }

  clearLeftover(st) {
    try { fs.rmSync(st._file || this.file, { force: true }); } catch { /* ignore */ }
  }

  /** Wächter unabhängig vom eigenen Prozessbaum starten (WMI), sonst losgelöst als Kindprozess */
  startGuard(pid = process.pid, done = () => {}) {
    if (!IS_WIN || this.guardStarted) return;
    this.guardStarted = true;
    const script = unpacked(path.join(__dirname, 'restore-guard.ps1'));
    const helper = unpacked(path.join(__dirname, 'input-helper.ps1'));
    const args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-ParentPid', String(pid), '-StateFile', this.file, '-Helper', helper];
    const cmdline = 'powershell.exe ' + args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
    const ps = "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; " +
      `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmdline.replace(/'/g, "''")}'; ProcessStartupInformation = $si }; ` +
      '"$($r.ReturnValue) $($r.ProcessId)"';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, out) => {
      const m = String(out || '').trim().match(/^0 (\d+)/);
      if (!err && m) { this.log(`Wächter für plötzliches Beenden läuft (PID ${m[1]})`); done('wmi'); return; }
      this.log('Wächter per WMI nicht gestartet – starte ihn losgelöst' + (err ? ': ' + err.message : ''));
      try {
        const p = spawn('powershell.exe', args, { detached: true, windowsHide: true, stdio: 'ignore' });
        p.unref();
        done('detached');
      } catch (e) { this.log('Wächter konnte nicht gestartet werden: ' + e.message); this.guardStarted = false; done(''); }
    });
  }
}

module.exports = { CrashGuard };
