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
    const read = (buf) => String(buf).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => { if (!l.startsWith('{')) last = l; onLine && onLine(l); });
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

/** Gibt es ein System-Update? (nur prüfen, nichts laden) → true/false */
async function checkSystemUpdate() {
  if (!fs.existsSync(UPDATE) || updating) return false;
  if (await stagedUpdate()) return false; // schon geladen, wartet auf Neustart
  let available = false;
  return runWithProgress('pkexec', [UPDATE, '--check'], (line) => {
    const pr = parseBootcProgress(line);
    if (pr && pr.check) available = pr.update;
  }).then(() => available);
}

/** Systemupdate (bootc): neues Abbild laden – aktiv nach dem Neustart */
/**
 * Fortschritt von bootc (--progress-fd, JSON-Zeilen) in etwas Lesbares übersetzen.
 * @returns {{ pct?: number, text?: string, done?: boolean, update?: boolean } | null}
 */
function parseBootcProgress(line) {
  if (!line.startsWith('{')) return null;
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  const gb = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1048576) + ' MB');
  if (e.type === 'AgsDone') return { done: true, update: !!e.update };
  if (e.type === 'AgsCheck') return { check: true, update: !!e.update };
  if (e.type === 'ProgressBytes') {
    const total = e.bytesTotal || 0;
    const pct = total ? Math.min(100, Math.floor((e.bytes / total) * 100)) : (e.stepsTotal ? Math.floor((e.steps / e.stepsTotal) * 100) : undefined);
    const parts = [total ? `${gb(e.bytes)} von ${gb(total)}` : e.bytes ? gb(e.bytes) : '', e.stepsTotal ? `Ebene ${Math.min(e.steps + 1, e.stepsTotal)} von ${e.stepsTotal}` : ''].filter(Boolean);
    return { pct, text: `Lade System-Update: ${parts.join(' · ')}` };
  }
  if (e.type === 'ProgressSteps') {
    const pct = e.stepsTotal ? Math.floor((e.steps / e.stepsTotal) * 100) : undefined;
    const sub = (e.subtasks || []).find((x) => !x.completed);
    const what = { importing: 'Importiere', deploying: 'Richte ein', staging: 'Bereite vor', pulling: 'Lade' }[String(e.task || '').toLowerCase()] || e.description || 'Arbeite';
    return { pct, text: `${what}${sub && sub.description ? ': ' + sub.description : ''}${e.stepsTotal ? ` (${e.steps}/${e.stepsTotal})` : ''}` };
  }
  return null;
}

/** Ist schon ein neues System für den nächsten Start vorgemerkt? → Version oder '' */
function stagedUpdate() {
  return new Promise((resolve) => {
    execFile('rpm-ostree', ['status', '--json'], { timeout: 15000 }, (err, out) => {
      try {
        const d = JSON.parse(out).deployments || [];
        const s = d.find((x) => x.staged || (!x.booted && d.indexOf(x) === 0 && d.some((y) => y.booted) && x.version !== (d.find((y) => y.booted) || {}).version));
        resolve(s ? String(s.version || 'neu') : '');
      } catch { resolve(''); }
    });
  });
}

let updating = null;
/** Systemupdate (bootc): neues Abbild laden – aktiv nach dem Neustart. Ergebnis: { staged, version, already? } bzw. { none }
 *  onProgress bekommt { text, pct } (pct aus bootc --progress-fd, sonst undefined) */
async function updateSystem(onProgress) {
  if (!fs.existsSync(UPDATE)) return Promise.reject(new Error('Systemupdate nur auf AleGamestation OS verfügbar'));
  if (updating) return Promise.reject(new Error('Es läuft bereits ein System-Update'));
  const report = (p) => { try { onProgress && onProgress(p); } catch { /* ignore */ } };
  updating = (async () => {
    const pending = await stagedUpdate();
    if (pending) return { staged: true, version: pending, already: true };
    let none = false;
    await runWithProgress('pkexec', [UPDATE], (line) => {
      if (/^UPDATE_NONE/.test(line)) { none = true; return; }
      if (/^UPDATE_/.test(line)) return;
      const pr = parseBootcProgress(line);
      if (pr && pr.done) { if (!pr.update) none = true; return; }
      if (pr) { if (!pr.check) report(pr); return; }
      if (!line.startsWith('{')) report({ text: line.trim() });
    });
    if (none) return { none: true };
    return { staged: true, version: await stagedUpdate() };
  })();
  try { return await updating; } finally { updating = null; }
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

/** Läuft KDE Plasma (KWin)? */
function isKde() { return isLinux && /KDE/i.test(process.env.XDG_CURRENT_DESKTOP || ''); }

/** KWin-Skript ausführen (z.B. aktives Fenster schließen) */
function kwinScript(code) {
  const qd = ['qdbus-qt6', 'qdbus6', 'qdbus'].find((q) => { try { return require('child_process').execFileSync('which', [q], { stdio: 'ignore' }) || true; } catch { return false; } });
  if (!qd) return Promise.reject(new Error('KWin nicht erreichbar'));
  const file = path.join(require('os').tmpdir(), `ags-kwin-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(file, code);
  const name = 'ags' + Date.now();
  const q = (args) => new Promise((resolve, reject) => execFile(qd, args, { timeout: 8000 }, (err, out) => (err ? reject(err) : resolve(String(out).trim()))));
  return q(['org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting.loadScript', file, name])
    .then((id) => q(['org.kde.KWin', `/Scripting/Script${id}`, 'org.kde.kwin.Script.run']))
    .finally(() => { setTimeout(() => { q(['org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting.unloadScript', name]).catch(() => {}); fs.rmSync(file, { force: true }); }, 1500); });
}
/** Aktives Fenster schließen (z.B. hängender Emulator, Desktop-Programm) – AleGamestation selbst nie */
function closeActiveWindow() {
  if (!isKde()) return Promise.reject(new Error('Nur im KDE-Desktop verfügbar'));
  return kwinScript(`const w = workspace.activeWindow;
if (w && w.resourceClass !== 'alegamestation' && !w.desktopWindow && !w.dock) { print('AleGamestation schließt: ' + w.caption); w.closeWindow(); }`);
}

/** Alt+F4 im KDE-Desktop: KWin belegt die Taste selbst („Fenster schließen“) – während eines Spiels wird sie
 *  freigegeben, damit AleGamestation das Spiel samt Emulator beenden kann; danach wieder zurückgesetzt. */
const KWIN_CLOSE = "['kwin','Window Close','KWin','Fenster schließen']";
const ALT_F4 = 0x08000000 | 0x01000033;
function kwinAltF4(free) {
  if (!isKde()) return Promise.resolve(false);
  return new Promise((resolve) => execFile('gdbus', ['call', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', '/kglobalaccel',
    '--method', 'org.kde.KGlobalAccel.setForeignShortcut', KWIN_CLOSE, free ? '@ai []' : `[${ALT_F4}]`], { timeout: 3000 }, (err) => resolve(!err)));
}

// ---------- SMB-Freigaben ----------
const SHARES = '/usr/libexec/alegamestation-shares';
function sharesStatus() {
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', 'smb'], (err, out) => {
      const active = String(out).trim() === 'active';
      const ips = Object.values(require('os').networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
      execFile('pdbedit', ['-L'], (e2, out2) => resolve({ available: fs.existsSync(SHARES), active, ips, host: require('os').hostname().split('.')[0], user: require('os').userInfo().username, passwordSet: e2 ? null : new RegExp('^' + require('os').userInfo().username + ':', 'm').test(String(out2)) }));
    });
  });
}
function sharesPassword(pw) {
  if (!pw || String(pw).length < 4) return Promise.reject(new Error('Passwort bitte mit mindestens 4 Zeichen'));
  return new Promise((resolve, reject) => {
    const p = spawn('pkexec', [SHARES, 'passwd'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? resolve(true) : reject(new Error(out.trim().split('\n').pop() || 'Passwort konnte nicht gesetzt werden'))));
    p.stdin.end(String(pw) + '\n');
  });
}
function sharesSet(on) {
  return runWithProgress('pkexec', [SHARES, on ? 'on' : 'off'], () => {});
}

module.exports = { isKde, kwinAltF4, closeActiveWindow, sharesStatus, sharesPassword, sharesSet, isOS, inGamescope, info, switchSession, setupEmulators, updateSystem, stagedUpdate, checkSystemUpdate, parseBootcProgress, markOverlay, SESSION_CMD };
