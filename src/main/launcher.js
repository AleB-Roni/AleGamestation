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

class Launcher extends EventEmitter {
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
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
      if (!fs.existsSync(game.exe)) throw new Error(`Programm nicht gefunden: ${game.exe}`);
      exe = game.exe;
      args = splitArgs(game.args);
      cwd = game.cwd || path.dirname(game.exe);
      if (game.killMode === 'dir') dirs.push(path.dirname(game.exe));
    }

    const child = spawn(exe, args, { cwd, detached: !IS_WIN, windowsHide: false, stdio: 'ignore' });
    this.current = { game, child, pid: child.pid, dirs, startedAt: Date.now() };
    child.on('error', (err) => {
      this.emit('error', err);
      this._finish();
    });
    child.on('exit', () => {
      // Manche Programme starten sich neu bzw. starten einen Kindprozess und beenden den Startprozess sofort.
      // Daher noch prüfen, ob Prozesse aus dem Ordner weiterlaufen.
      this._waitForDirProcesses(0);
    });
    this.emit('started', this.status());
    return this.status();
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

module.exports = { Launcher, splitArgs, fillPlaceholders, powershell };
