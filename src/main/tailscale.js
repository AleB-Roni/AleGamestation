'use strict';
/**
 * Tailscale: diesen Rechner ins eigene Tailnet bringen – Fernzugriff auf AleGamestation-Rechner und RomM von unterwegs.
 * Nutzt die Tailscale-Kommandozeile (Windows: Tailscale-App, Linux/AleGamestation OS: tailscaled).
 * Anmeldung per Link/QR-Code (z.B. mit dem Handy scannen).
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const IS_WIN = process.platform === 'win32';
const OS_HELPER = '/usr/libexec/alegamestation-tailscale';

function cli() {
  if (process.env.AGS_TAILSCALE_CLI) return process.env.AGS_TAILSCALE_CLI; // für Tests
  if (IS_WIN) {
    const c = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((d) => path.join(d, 'Tailscale', 'tailscale.exe'));
    return c.find((p) => fs.existsSync(p)) || '';
  }
  return ['/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale'].find((p) => fs.existsSync(p)) || '';
}

function run(args, timeout = 15000) {
  return new Promise((resolve) => {
    const exe = cli();
    if (!exe) return resolve({ ok: false, out: '', err: 'not-installed' });
    execFile(exe, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
  });
}

class Tailscale extends EventEmitter {
  installed() { return !!cli(); }

  /** Zustand: running | needs-login | stopped | not-installed | no-daemon */
  async status() {
    if (!this.installed()) return { state: 'not-installed', download: IS_WIN ? 'https://tailscale.com/download/windows' : 'https://tailscale.com/download/linux' };
    const r = await run(['status', '--json']);
    let j = null;
    try { j = JSON.parse(r.out); } catch { /* kein JSON */ }
    if (!j) {
      if (/failed to connect|connection refused|is tailscaled running|no such file/i.test(r.err + r.out)) return { state: 'no-daemon', error: 'Der Tailscale-Dienst läuft nicht' };
      return { state: 'stopped', error: (r.err || r.out).trim().split('\n').pop() };
    }
    const self = j.Self || {};
    const peers = Object.values(j.Peer || {}).map((p) => ({
      name: p.HostName || (p.DNSName || '').split('.')[0], dns: (p.DNSName || '').replace(/\.$/, ''), ip: (p.TailscaleIPs || [])[0] || '',
      online: !!p.Online, os: p.OS || ''
    })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const state = j.BackendState === 'Running' ? 'running' : j.BackendState === 'NeedsLogin' || j.BackendState === 'NoState' ? 'needs-login' : 'stopped';
    return {
      state, backend: j.BackendState, name: self.HostName || '', dns: (self.DNSName || '').replace(/\.$/, ''), ip: (self.TailscaleIPs || [])[0] || '',
      tailnet: (j.CurrentTailnet && j.CurrentTailnet.Name) || '', user: (j.User && self.UserID && j.User[self.UserID] && j.User[self.UserID].LoginName) || '',
      authUrl: j.AuthURL || '', peers
    };
  }

  /**
   * Verbinden. Liefert ggf. den Anmelde-Link (+ QR-Code als Bild) über das Ereignis 'login' und meldet 'connected'.
   * Auf AleGamestation OS über einen Helfer mit Root-Rechten (setzt den Benutzer als „Operator“, danach ohne Passwort).
   */
  up({ hostname } = {}) {
    if (!this.installed()) return Promise.reject(new Error('Tailscale ist nicht installiert'));
    const extra = ['--json', '--accept-routes'];
    if (hostname) extra.push(`--hostname=${hostname}`);
    let cmd; let args;
    if (!IS_WIN && fs.existsSync(OS_HELPER)) { cmd = 'pkexec'; args = [OS_HELPER, 'up', ...extra]; } else { cmd = cli(); args = ['up', ...extra]; }
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true });
      let buf = ''; let errBuf = ''; let sent = false;
      const tryParse = () => {
        // tailscale up --json gibt ein JSON-Objekt aus (evtl. über mehrere Zeilen)
        const m = buf.match(/\{[\s\S]*\}/);
        if (!m) return;
        try {
          const j = JSON.parse(m[0]);
          if (j.AuthURL && !sent) { sent = true; this.emit('login', { url: j.AuthURL, qr: j.QR || '' }); }
          if (j.BackendState === 'Running') this.emit('connected');
        } catch { /* noch unvollständig */ }
      };
      p.stdout.on('data', (d) => { buf += d; tryParse(); });
      p.stderr.on('data', (d) => {
        errBuf += d;
        const m = String(d).match(/https:\/\/login\.tailscale\.com\/\S+/);
        if (m && !sent) { sent = true; this.emit('login', { url: m[0], qr: '' }); }
      });
      p.on('error', (err) => reject(err));
      p.on('exit', (code) => {
        if (code === 0) { this.emit('connected'); resolve(true); return; }
        const msg = (errBuf || buf).trim().split('\n').filter(Boolean).pop() || `Fehlercode ${code}`;
        reject(new Error(/access denied|permission|operator/i.test(msg) ? 'Keine Berechtigung – Tailscale einmalig mit Administratorrechten verbinden („sudo tailscale up --operator=$USER“)' : msg));
      });
    });
  }

  async down() {
    const r = !IS_WIN && fs.existsSync(OS_HELPER)
      ? await new Promise((res) => execFile('pkexec', [OS_HELPER, 'down'], (err, out, e) => res({ ok: !err, err: String(e || '') })))
      : await run(['down']);
    if (!r.ok) throw new Error((r.err || 'Trennen fehlgeschlagen').trim().split('\n').pop());
    return true;
  }

  async logout() {
    const r = await run(['logout'], 30000);
    if (!r.ok) throw new Error((r.err || 'Abmelden fehlgeschlagen').trim().split('\n').pop());
    return true;
  }
}

module.exports = { Tailscale, cli };
