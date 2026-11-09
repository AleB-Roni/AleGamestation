'use strict';
/**
 * Systemfunktionen: Bildschirm umschalten (nur TV / nur Monitor / duplizieren / erweitern),
 * eigene Befehle ausführen, Herunterfahren / Neustart / Energiesparen.
 */
const { exec, execFile } = require('child_process');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const DISPLAY_MODES = ['internal', 'external', 'clone', 'extend'];

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/**
 * Bildschirm-Modus über das Windows-eigene DisplaySwitch.exe setzen (wie Win+P).
 * internal = nur PC-Bildschirm, external = nur zweiter Bildschirm (TV), clone = duplizieren, extend = erweitern
 */
function setDisplayMode(mode) {
  if (!IS_WIN || !DISPLAY_MODES.includes(mode)) return Promise.resolve({ ok: false, skipped: true });
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DisplaySwitch.exe');
  return new Promise((resolve) => {
    execFile(exe, ['/' + mode], { windowsHide: true }, (err) => resolve({ ok: !err }));
  });
}

async function runCommands(list) {
  const results = [];
  for (const cmd of list || []) {
    if (cmd && String(cmd).trim()) results.push(await run(cmd));
  }
  return results;
}

function power(action) {
  if (!IS_WIN) {
    const map = { shutdown: 'systemctl poweroff', restart: 'systemctl reboot', sleep: 'systemctl suspend' };
    return map[action] ? run(map[action]) : Promise.resolve({ ok: false });
  }
  const map = {
    shutdown: 'shutdown /s /t 0',
    restart: 'shutdown /r /t 0',
    // Energiesparen (Ruhezustand wird nicht erzwungen, wenn er deaktiviert ist)
    sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
    lock: 'rundll32.exe user32.dll,LockWorkStation'
  };
  return map[action] ? run(map[action]) : Promise.resolve({ ok: false });
}

module.exports = { setDisplayMode, runCommands, power, DISPLAY_MODES };
