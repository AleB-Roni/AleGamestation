'use strict';
/**
 * Eden (Switch): Ordner mit Updates/DLC als „externen Inhalt“ eintragen – Eden lädt sie dann ohne Installation in den NAND.
 * Eden speichert das in qt-config.ini, Abschnitt [UI]:
 *   Paths\external_content_dirs\1\path=/home/ale/ROMs/switch/updates
 *   Paths\external_content_dirs\size=1
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Ort der qt-config.ini (portable „user“-Ordner neben der eden.exe hat Vorrang) */
function edenConfigFile(exe) {
  if (process.platform === 'win32') {
    const portable = exe && path.join(path.dirname(exe), 'user');
    if (portable && fs.existsSync(portable)) return path.join(portable, 'config', 'qt-config.ini');
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'eden', 'config', 'qt-config.ini');
  }
  if (exe) {
    const portable = path.join(path.dirname(exe), 'user');
    if (fs.existsSync(portable)) return path.join(portable, 'config', 'qt-config.ini');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'eden', 'qt-config.ini');
}

const KEY = /^Paths\\external_content_dirs\\(\d+)\\path=(.*)$/;
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

/** Ordner eintragen (falls noch nicht drin). Rückgabe: true = geändert */
function addExternalContentDir(iniFile, dir) {
  let text = '';
  try { text = fs.readFileSync(iniFile, 'utf8'); } catch { /* neu anlegen */ }
  const lines = text.length ? text.split(/\r?\n/) : [];
  let start = lines.findIndex((l) => l.trim() === '[UI]');
  if (start < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push('[UI]');
    start = lines.length - 1;
  }
  let end = lines.findIndex((l, i) => i > start && /^\[.*\]\s*$/.test(l.trim()));
  if (end < 0) end = lines.length;
  const existing = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(KEY);
    if (m) existing.push({ idx: Number(m[1]), val: m[2] });
  }
  if (existing.some((e) => norm(e.val) === norm(dir))) return false;
  const n = existing.reduce((a, e) => Math.max(a, e.idx), 0) + 1;
  const insert = [`Paths\\external_content_dirs\\${n}\\path=${norm(dir)}`];
  const sizeIdx = lines.findIndex((l, i) => i > start && i < end && /^Paths\\external_content_dirs\\size=/.test(l));
  if (sizeIdx >= 0) lines[sizeIdx] = `Paths\\external_content_dirs\\size=${n}`;
  else insert.push(`Paths\\external_content_dirs\\size=${n}`);
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, ...insert);
  fs.mkdirSync(path.dirname(iniFile), { recursive: true });
  fs.writeFileSync(iniFile, lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n'));
  return true;
}

/** Ist dieser Emulator Eden (oder ein anderer yuzu-Nachfolger mit gleichem Mechanismus)? */
function isEden(emu) {
  return !!emu && (/eden/i.test(emu.id || '') || /eden/i.test(path.basename(emu.exe || '')));
}

module.exports = { edenConfigFile, addExternalContentDir, isEden };
