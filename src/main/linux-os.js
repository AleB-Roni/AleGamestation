'use strict';
/**
 * AleGamestation OS (Linux, Gamescope-Spielmodus): Desktop-Wechsel, Systemupdate, Emulator-Einrichtung,
 * Overlay-Fenster über Spielen. Auf Windows und normalem Linux ohne OS-Dateien passiert hier nichts.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const SESSION_CMD = '/usr/bin/alegamestation-session';
const FIRSTBOOT = '/usr/libexec/alegamestation-firstboot';
const UPDATE = '/usr/libexec/alegamestation-os-update';

const isLinux = process.platform === 'linux';
/** Läuft auf AleGamestation OS? */
function isOS() {
  return isLinux && (process.env.ALEGAMESTATION_OS === '1' || fs.existsSync(SESSION_CMD));
}
/** Läuft im Gamescope-Spielmodus? */
function inGamescope() {
  return isLinux && (process.argv.includes('--gamescope') || !!process.env.GAMESCOPE_WAYLAND_DISPLAY);
}

function info() {
  let version = '';
  try { version = (fs.readFileSync('/usr/share/alegamestation/os-version', 'utf8') || '').trim(); } catch { /* keine */ }
  let image = '';
  try { const j = JSON.parse(fs.readFileSync('/usr/share/ublue-os/image-info.json', 'utf8')); image = j['image-name'] || ''; } catch { /* keine */ }
  return { os: isOS(), gamescope: inGamescope(), version, image };
}

/** In den Desktop- (desktop) oder Spielmodus (game) wechseln – meldet die Sitzung ab, SDDM meldet neu an */
function switchSession(mode) {
  if (!isOS()) return Promise.reject(new Error('Nur auf AleGamestation OS verfügbar'));
  // Schon im Desktop (App läuft dort als Fenster): nicht abmelden – das Skript merkt sich nur den Modus
  return new Promise((resolve, reject) => {
    execFile(SESSION_CMD, [mode === 'desktop' ? 'desktop' : mode === 'steam' ? 'steam' : 'game'], { timeout: 30000 }, (err, _out, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').pop()));
      else resolve(true);
    });
  });
}

/** Skript mit Fortschritt (eine Zeile pro Schritt) */
function runWithProgress(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    const read = (buf) => String(buf).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => { last = l; onLine && onLine(l); });
    p.stdout.on('data', read);
    p.stderr.on('data', read);
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(last) : reject(new Error(last || `Fehlercode ${code}`))));
  });
}

/** Emulatoren (Flatpak), RetroArch-Cores, ROM-Ordner einrichten bzw. nachinstallieren */
function setupEmulators(onLine) {
  if (!fs.existsSync(FIRSTBOOT)) return Promise.reject(new Error('Einrichtung nur auf AleGamestation OS verfügbar'));
  return runWithProgress(FIRSTBOOT, ['--force'], onLine);
}

/** Systemupdate (bootc): neues Abbild laden – aktiv nach dem Neustart */
function updateSystem(onLine) {
  if (!fs.existsSync(UPDATE)) return Promise.reject(new Error('Systemupdate nur auf AleGamestation OS verfügbar'));
  return runWithProgress('pkexec', [UPDATE], onLine);
}

/**
 * Gamescope zeigt nur das aktive Spiel – eigene Fenster (Overlay, Tastatur, Hinweise) als Overlay-Ebene markieren,
 * damit sie über dem Spiel erscheinen (wie das Steam-Overlay).
 */
function markOverlay(win) {
  if (!inGamescope() || !win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    const xid = buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
    if (!xid) return;
    execFile('xprop', ['-id', String(xid), '-f', 'GAMESCOPE_EXTERNAL_OVERLAY', '32c', '-set', 'GAMESCOPE_EXTERNAL_OVERLAY', '1'], () => {});
  } catch { /* ohne xprop: Fenster erscheint nur, wenn es den Fokus hat */ }
}

module.exports = { isOS, inGamescope, info, switchSession, setupEmulators, updateSystem, markOverlay, SESSION_CMD };
