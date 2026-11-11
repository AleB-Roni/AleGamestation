'use strict';
/**
 * AleClip-Anbindung: Clips (Instant Replay), Screenshots und Aufnahme direkt aus dem Overlay.
 * Spricht AleClip über seine lokale Verbindung "AleClipSingleInstance" an (Windows: Named Pipe),
 * eine Zeile JSON hin, eine Zeile JSON zurück. AleClip muss laufen (wird bei Bedarf minimiert gestartet).
 */
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PIPE_NAME = 'AleClipSingleInstance';
const pipePath = () => (process.platform === 'win32' ? `\\\\.\\pipe\\${PIPE_NAME}` : path.join(process.env.TMPDIR || os.tmpdir(), PIPE_NAME));

class AleClip {
  /** @param {{ getConfig: Function, trace?: Function }} opts */
  constructor(opts) {
    this.getConfig = opts.getConfig;
    this.trace = opts.trace || (() => {});
    this.pipe = opts.pipe || pipePath();
  }

  cfg() { return this.getConfig().aleclip || {}; }
  enabled() { return this.cfg().enabled !== false; }

  /** AleClip.exe suchen: Einstellung, sonst typische Installationsorte */
  findExe() {
    const c = this.cfg();
    const candidates = [
      c.exe,
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AleClip', 'AleClip.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'AleClip', 'AleClip.exe')
    ].filter(Boolean);
    return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || '';
  }

  /** Eine Anfrage schicken; Antwort als Objekt (bei Fehler: { ok:false, offline:true }) */
  request(msg, timeoutMs = 2500) {
    return new Promise((resolve) => {
      let buf = '';
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* ignore */ } resolve(v); };
      const sock = net.connect(this.pipe);
      const timer = setTimeout(() => finish({ ok: false, offline: !buf, error: 'AleClip antwortet nicht' }), timeoutMs);
      sock.setEncoding('utf8');
      sock.on('connect', () => sock.write(JSON.stringify(msg) + '\n'));
      sock.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i >= 0) {
          try { finish(JSON.parse(buf.slice(0, i))); } catch { finish({ ok: false, error: 'Ungültige Antwort von AleClip' }); }
        }
      });
      sock.on('error', () => finish({ ok: false, offline: true, error: 'AleClip läuft nicht' }));
      sock.on('close', () => finish({ ok: false, offline: !buf, error: buf ? 'Ungültige Antwort von AleClip' : 'AleClip läuft nicht' }));
    });
  }

  async status() {
    if (!this.enabled()) return { ok: false, disabled: true };
    const r = await this.request({ cmd: 'status' });
    if (r.offline) return { ok: false, offline: true, installed: !!this.findExe() };
    return r;
  }

  /** AleClip minimiert (im Tray) starten und warten, bis es antwortet */
  async start(waitMs = 15000) {
    const exe = this.findExe();
    if (!exe) throw new Error('AleClip wurde nicht gefunden – Pfad unter Einstellungen → Clips (AleClip) eintragen');
    this.trace('AleClip starten: ' + exe);
    spawn(exe, ['--minimized'], { detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(exe) }).unref();
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 700));
      const st = await this.request({ cmd: 'status' }, 1500);
      if (!st.offline) return st;
    }
    throw new Error('AleClip wurde gestartet, antwortet aber noch nicht');
  }

  /** Letzte `seconds` als Clip speichern; endAgo = so viele Sekunden vor jetzt enden (Overlay-Zeit weglassen) */
  async saveReplay(seconds, endAgo = 0) {
    const r = await this.request({ cmd: 'save_replay', seconds, end_ago: Math.max(0, Math.round(endAgo * 10) / 10) }, 4000);
    this.trace('AleClip Clip speichern', { seconds, endAgo, antwort: r });
    if (r.offline) throw new Error('AleClip läuft nicht');
    if (!r.ok) throw new Error(r.error === 'Instant Replay ist aus' ? 'Instant Replay ist in AleClip ausgeschaltet' : r.error || 'Clip konnte nicht gespeichert werden');
    return r;
  }

  async command(cmd, extra = {}) {
    const r = await this.request({ cmd, ...extra }, 4000);
    this.trace('AleClip ' + cmd, r);
    if (r.offline) throw new Error('AleClip läuft nicht');
    if (!r.ok) throw new Error(r.error || 'AleClip: Befehl fehlgeschlagen');
    return r;
  }
}

module.exports = { AleClip, pipePath, PIPE_NAME };
