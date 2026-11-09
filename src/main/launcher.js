'use strict';
/**
 * Startet Spiele / Emulatoren, überwacht sie und beendet sie auf Wunsch (Controller-Kombination).
 */
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

/** Zerlegt eine Argumentzeile in einzelne Argumente (beachtet "Anführungszeichen"). */
function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function fillPlaceholders(arg, vars) {
  return arg.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? vars[key] : all));
}

function powershell(script, timeout = 15000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** Liefert PIDs aller Prozesse, deren .exe in dem Ordner liegt (nur Windows). */
async function pidsInDir(dir) {
  if (!IS_WIN || !dir) return [];
  const norm = path.resolve(dir).replace(/[\\/]+$/, '') + '\\';
  const out = await powershell(
    `$d=${psQuote(norm)}; Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Id }`
  );
  return out.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => n > 0 && n !== process.pid);
}

function taskkill(args) {
  return new Promise((resolve) => execFile('taskkill', args, { windowsHide: true }, () => resolve()));
}

async function closeGracefully(pids, waitMs) {
  if (!IS_WIN || !pids.length || !waitMs) return;
  await powershell(`${pids.join(',')} | ForEach-Object { try { (Get-Process -Id $_ -ErrorAction Stop).CloseMainWindow() | Out-Null } catch {} }`);
  await new Promise((r) => setTimeout(r, waitMs));
}

/**
 * Ordner, deren Prozesse niemals "als Spielordner" beendet werden dürfen
 * (z.B. Notepad liegt in C:\Windows\System32 – dort laufen viele Windows-Prozesse).
 */
function isSafeKillDir(dir) {
  if (!dir) return false;
  const norm = path.resolve(dir).replace(/[\\/]+$/, '').toLowerCase();
  const env = process.env;
  const blocked = [
    env.SystemRoot || 'C:\\Windows', env.windir,
    env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData,
    env.USERPROFILE, env.APPDATA, env.LOCALAPPDATA, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop'), env.USERPROFILE && path.join(env.USERPROFILE, 'Downloads')
  ].filter(Boolean).map((d) => path.resolve(d).replace(/[\\/]+$/, '').toLowerCase());
  const sysRoot = path.resolve(env.SystemRoot || 'C:\\Windows').toLowerCase();
  if (norm === sysRoot || norm.startsWith(sysRoot + path.sep)) return false;
  if (blocked.includes(norm)) return false;
  // Laufwerkswurzel (C:\) oder zu kurze Pfade
  if (/^[a-z]:$/.test(norm) || norm === '/' || norm.split(/[\\/]/).filter(Boolean).length < 2) return false;
  return true;
}

/** Inhalt einer .url-Datei (Internet-Verknüpfung) -> URL */
function readUrlFile(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/^\s*URL\s*=\s*(.+?)\s*$/im);
    return m ? m[1] : '';
  } catch { return ''; }
}

class Launcher extends EventEmitter {
  /**
   * @param {Function} getConfig
   * @param {{ readShortcutLink?: Function, openPath?: Function, openExternal?: Function }} platform Electron-shell-Funktionen
   */
  constructor(getConfig, platform = {}) {
    super();
    this.getConfig = getConfig;
    this.platform = platform;
    this.current = null; // { game, child, pid, dirs, startedAt, poll }
  }

  isRunning() {
    return !!this.current;
  }

  status() {
    if (!this.current) return { running: false };
    const { game, startedAt } = this.current;
    return { running: true, game: { id: game.id, name: game.name, system: game.system }, startedAt };
  }

  async launch(game, shellOpen) {
    if (this.current) throw new Error('Es läuft bereits ein Spiel.');
    const cfg = this.getConfig();

    if (game.type === 'steam') return this._launchSteam(game, cfg, shellOpen);
    if (game.type === 'epic') return this._launchUrl(game, game.launchUrl, shellOpen);
    if (game.type === 'bigpicture') {
      await shellOpen('steam://open/bigpicture');
      return { running: false };
    }

    let exe; let args; let cwd; const dirs = [];
    if (game.type === 'rom') {
      const sys = cfg.systems.find((s) => s.id === game.system);
      const { emulator: emu } = require('./library').resolveEmulator(cfg, game);
      if (!emu) throw new Error(`Für ${sys ? sys.name : game.system} ist kein Emulator eingestellt.`);
      if (!fs.existsSync(emu.exe)) throw new Error(`Emulator nicht gefunden: ${emu.exe}`);
      const vars = {
        rom: game.rom,
        romName: path.basename(game.rom, path.extname(game.rom)),
        romDir: path.dirname(game.rom),
        emuDir: path.dirname(emu.exe)
      };
      exe = emu.exe;
      args = splitArgs(emu.args).map((a) => fillPlaceholders(a, vars));
      cwd = emu.cwd || path.dirname(emu.exe);
      dirs.push(path.dirname(emu.exe));
    } else {
      if (!/^[a-z][a-z0-9+.-]+:/i.test(game.exe) && !fs.existsSync(game.exe)) throw new Error(`Programm nicht gefunden: ${game.exe}`);
      const target = this.resolveTarget(game);
      if (target.mode !== 'spawn') return this._launchOpen(game, target);
      exe = target.exe;
      args = target.args;
      cwd = target.cwd;
      if (game.killMode === 'dir' && isSafeKillDir(path.dirname(exe))) dirs.push(path.dirname(exe));
      if (target.viaCmd) return this._spawn(game, process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[exe, ...args].map((a) => `"${a}"`).join(' ')}"`], cwd, dirs, { windowsVerbatimArguments: true });
    }
    return this._spawn(game, exe, args, cwd, dirs);
  }

  /**
   * Wie wird ein eigenes Programm gestartet?
   * @returns {{mode:'spawn', exe, args, cwd, viaCmd?:boolean} | {mode:'open', path:string, dir?:string} | {mode:'url', url:string}}
   */
  resolveTarget(game) {
    const file = game.exe;
    if (/^[a-z][a-z0-9+.-]+:/i.test(file) && !/^[a-z]:[\\/]/i.test(file)) return { mode: 'url', url: file };
    const ext = path.extname(file).toLowerCase();
    const userArgs = splitArgs(game.args);
    if (ext === '.lnk' && this.platform.readShortcutLink) {
      try {
        const l = this.platform.readShortcutLink(file);
        if (l && l.target && /\.(exe|com)$/i.test(l.target) && fs.existsSync(l.target)) {
          return { mode: 'spawn', exe: l.target, args: [...splitArgs(l.args), ...userArgs], cwd: game.cwd || l.cwd || path.dirname(l.target) };
        }
        return { mode: 'open', path: file, dir: l && l.target ? path.dirname(l.target) : '' };
      } catch { return { mode: 'open', path: file }; }
    }
    if (ext === '.url') {
      const url = readUrlFile(file);
      return url ? { mode: 'url', url } : { mode: 'open', path: file };
    }
    if (ext === '.bat' || ext === '.cmd') return { mode: 'spawn', exe: file, args: userArgs, cwd: game.cwd || path.dirname(file), viaCmd: true };
    if (ext === '.exe' || ext === '.com' || !IS_WIN) return { mode: 'spawn', exe: file, args: userArgs, cwd: game.cwd || path.dirname(file) };
    return { mode: 'open', path: file, dir: path.dirname(file) };
  }

  /** Über Windows öffnen (Verknüpfungen, Store-Apps, URLs ...). Überwacht den Programmordner, wenn bekannt. */
  async _launchOpen(game, target) {
    if (target.mode === 'url') {
      if (!this.platform.openExternal) throw new Error('Kann URL nicht öffnen');
      await this.platform.openExternal(target.url);
    } else {
      if (!this.platform.openPath) throw new Error('Kann Datei nicht öffnen');
      const err = await this.platform.openPath(target.path);
      if (err) throw new Error(`Windows konnte „${path.basename(target.path)}“ nicht öffnen: ${err}`);
    }
    const dir = target.dir && isSafeKillDir(target.dir) ? target.dir : '';
    if (!dir) {
      // Ohne bekannten Programmordner lässt sich das Programm nicht überwachen – nur starten
      return { running: false, opened: true, name: game.name };
    }
    this.current = { game, child: null, pid: null, dirs: [dir], startedAt: Date.now(), seen: false };
    this.emit('started', this.status());
    this._waitForDirProcesses(30000);
    return this.status();
  }

  _spawn(game, exe, args, cwd, dirs, extra = {}) {
    let child;
    try {
      child = spawn(exe, args, { cwd, detached: !IS_WIN, windowsHide: false, stdio: 'ignore', ...extra });
    } catch (err) {
      return this._spawnFailed(game, exe, err);
    }
    this.current = { game, child, pid: child.pid, dirs, startedAt: Date.now() };
    child.on('error', (err) => {
      const cur = this.current;
      if (cur && cur.child === child) { clearTimeout(cur.poll); this.current = null; }
      // Kein startbares Programm (z.B. EFTYPE): über Windows öffnen
      this._spawnFailed(game, exe, err).then((st) => {
        if (st && !st.running) this.emit('opened', st);
      }).catch((e) => { this.emit('error', e); this.emit('exited', { game: { id: game.id, name: game.name }, playedMs: 0 }); });
    });
    child.on('exit', () => {
      // Manche Programme starten sich neu bzw. starten einen Kindprozess und beenden den Startprozess sofort.
      // Daher noch prüfen, ob Prozesse aus dem Ordner weiterlaufen.
      this._waitForDirProcesses(0);
    });
    this.emit('started', this.status());
    return this.status();
  }

  async _spawnFailed(game, exe, err) {
    if (IS_WIN && this.platform.openPath && ['EFTYPE', 'EINVAL', 'EACCES', 'UNKNOWN', 'ENOEXEC'].includes(err.code) && !game._fallback) {
      return this._launchOpen({ ...game, _fallback: true }, { mode: 'open', path: exe, dir: path.dirname(exe) });
    }
    throw new Error(`Start fehlgeschlagen (${err.code || err.message}): ${exe}`);
  }

  async _launchSteam(game, cfg, shellOpen) {
    const url = cfg.steam.launchViaBigPicture ? `steam://open/bigpicture` : `steam://rungameid/${game.appid}`;
    await shellOpen(url);
    this.current = { game, child: null, pid: null, dirs: [game.installDir], startedAt: Date.now(), seen: false };
    this.emit('started', this.status());
    this._waitForDirProcesses(180000);
    return this.status();
  }

  async _launchUrl(game, url, shellOpen) {
    await shellOpen(url);
    this.current = { game, child: null, pid: null, dirs: [game.installDir].filter(Boolean), startedAt: Date.now(), seen: false };
    this.emit('started', this.status());
    this._waitForDirProcesses(180000);
    return this.status();
  }

  /** Überwacht Prozesse aus den Spielordnern; endet, sobald keine mehr laufen. */
  _waitForDirProcesses(appearTimeoutMs = 4000) {
    const cur = this.current;
    if (!cur || cur.poll) return;
    if (!IS_WIN || !cur.dirs.length) return this._finish();
    const started = Date.now();
    const tick = async () => {
      if (this.current !== cur) return;
      let pids = [];
      for (const d of cur.dirs) pids = pids.concat(await pidsInDir(d));
      if (this.current !== cur) return;
      if (pids.length) cur.seen = true;
      if (!pids.length && (cur.seen || Date.now() - started > appearTimeoutMs)) return this._finish();
      cur.poll = setTimeout(tick, 3000);
    };
    cur.poll = setTimeout(tick, 1500);
  }

  _finish() {
    const cur = this.current;
    if (!cur) return;
    clearTimeout(cur.poll);
    this.current = null;
    this.emit('exited', { game: { id: cur.game.id, name: cur.game.name }, playedMs: Date.now() - cur.startedAt });
  }

  /** Beendet das laufende Spiel: erst sanft, dann hart (inkl. Kindprozessen und Prozessen aus dem Spielordner). */
  async kill() {
    const cur = this.current;
    if (!cur) return false;
    const cfg = this.getConfig();
    const game = cur.game;

    if (!IS_WIN) {
      try { process.kill(-cur.pid, 'SIGTERM'); } catch { try { cur.child && cur.child.kill('SIGTERM'); } catch { /* ignore */ } }
      setTimeout(() => this._finish(), 500);
      return true;
    }

    let pids = cur.pid ? [cur.pid] : [];
    for (const d of cur.dirs) pids = pids.concat(await pidsInDir(d));
    pids = [...new Set(pids)];

    await closeGracefully(pids, cfg.controller.gracefulCloseMs);

    for (const pid of pids) await taskkill(['/PID', String(pid), '/T', '/F']);
    if (game.killMode === 'name' && game.processName) await taskkill(['/IM', game.processName, '/F', '/T']);
    // Nachzügler aus dem Ordner
    for (const d of cur.dirs) for (const pid of await pidsInDir(d)) await taskkill(['/PID', String(pid), '/T', '/F']);

    this._finish();
    return true;
  }
}

module.exports = { Launcher, splitArgs, fillPlaceholders, powershell, isSafeKillDir, readUrlFile };
