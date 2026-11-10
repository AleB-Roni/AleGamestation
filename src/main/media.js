'use strict';
/**
 * Musik & Lautstärke für das Overlay.
 *  - Steuerung über die Windows-Medientasten (funktioniert mit Spotify und den meisten Playern, ohne Konto/API)
 *  - Aktueller Spotify-Titel aus dem Fenstertitel ("Künstler - Titel"; nur "Spotify..." = pausiert)
 */
const { powershell } = require('./launcher');

const IS_WIN = process.platform === 'win32';
const VK = { playpause: 0xb3, next: 0xb0, prev: 0xb1, volup: 0xaf, voldown: 0xae, mute: 0xad };

/** "Daft Punk - Get Lucky" -> { playing: true, artist, title } */
function parseSpotifyTitle(windowTitle) {
  const t = String(windowTitle || '').trim();
  if (!t) return { running: false, playing: false };
  if (/^spotify( (premium|free))?$/i.test(t) || /^spotify\b/i.test(t) && !t.includes(' - ')) return { running: true, playing: false };
  const i = t.indexOf(' - ');
  if (i < 0) return { running: true, playing: true, artist: '', title: t };
  return { running: true, playing: true, artist: t.slice(0, i), title: t.slice(i + 3) };
}

async function spotifyInfo() {
  if (!IS_WIN) return { running: false, playing: false, unsupported: true };
  const out = await powershell("Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty MainWindowTitle", 6000);
  const running = out.trim() ? true : !!(await powershell("if (Get-Process Spotify -ErrorAction SilentlyContinue) { 'ja' }", 6000)).trim();
  const info = parseSpotifyTitle(out);
  return { ...info, running: running || info.running };
}

/** Medientaste drücken (über das Eingabe-Hilfsprogramm der Maussteuerung) */
function mediaKey(send, name) {
  const vk = VK[name];
  if (!vk) return false;
  send(`k ${vk} 1`);
  send(`k ${vk} 0`);
  return true;
}

module.exports = { spotifyInfo, mediaKey, parseSpotifyTitle, VK };
