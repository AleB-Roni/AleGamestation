'use strict';
/**
 * Beliebige Bilder in PNG umwandeln (für eigene Logos, Hintergründe, Cover).
 *  1. PNG bleibt PNG
 *  2. Chromium dekodiert: JPG, WebP, AVIF, GIF, SVG, BMP, ICO …
 *  3. Windows (WIC): TIFF, HEIC/HEIF (mit „HEIF-Bilderweiterungen“ aus dem Store), JPEG XR …
 */
const { BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.pjpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.cur': 'image/x-icon',
  '.apng': 'image/apng'
};
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'gif', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif', 'jxr', 'wdp', 'apng'];
const MAX = 4096; // größere Bilder werden verkleinert

const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

/** Über einen unsichtbaren Chromium-Renderer dekodieren und als PNG ausgeben */
async function viaChromium(buf, mime) {
  const w = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    const src = `data:${mime};base64,${buf.toString('base64')}`;
    const out = await w.webContents.executeJavaScript(`new Promise((res) => {
      const i = new Image();
      i.onload = () => {
        let wd = i.naturalWidth || 1024, ht = i.naturalHeight || 1024;
        const s = Math.min(1, ${MAX} / Math.max(wd, ht));
        wd = Math.max(1, Math.round(wd * s)); ht = Math.max(1, Math.round(ht * s));
        const c = document.createElement('canvas'); c.width = wd; c.height = ht;
        c.getContext('2d').drawImage(i, 0, 0, wd, ht);
        res(c.toDataURL('image/png'));
      };
      i.onerror = () => res('');
      i.src = ${JSON.stringify(src)};
    })`, true);
    const m = /^data:image\/png;base64,(.+)$/.exec(out || '');
    return m ? Buffer.from(m[1], 'base64') : null;
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
}

/** Windows Imaging Component (WPF) – kann TIFF, HEIC (mit Erweiterung) usw. */
function viaWic(file) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const out = path.join(os.tmpdir(), `ags-img-${process.pid}-${Date.now()}.png`);
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = 'Add-Type -AssemblyName PresentationCore; ' +
    `$d = [Windows.Media.Imaging.BitmapDecoder]::Create([Uri]${q(file)}, [Windows.Media.Imaging.BitmapCreateOptions]::None, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad); ` +
    '$e = New-Object Windows.Media.Imaging.PngBitmapEncoder; $e.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($d.Frames[0])); ' +
    `$s = [IO.File]::Create(${q(out)}); $e.Save($s); $s.Close()`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 30000 }, () => {
      try { const b = fs.readFileSync(out); fs.rmSync(out, { force: true }); resolve(isPng(b) ? b : null); } catch { resolve(null); }
    });
  });
}

/** Bilddatei → PNG-Daten (Buffer). Wirft einen Fehler, wenn das Format nicht lesbar ist. */
async function toPng(file) {
  const buf = fs.readFileSync(file);
  if (isPng(buf)) return buf;
  const ext = path.extname(file).toLowerCase();
  // JPEG kann Electron direkt
  if (['.jpg', '.jpeg', '.jfif', '.pjpeg'].includes(ext)) {
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) return img.toPNG();
  }
  let png = null;
  if (MIME[ext] || !['.tif', '.tiff', '.heic', '.heif', '.jxr', '.wdp'].includes(ext)) png = await viaChromium(buf, MIME[ext] || 'image/*').catch(() => null);
  if (!png) png = await viaWic(file);
  if (!png) {
    const heic = ['.heic', '.heif'].includes(ext);
    throw new Error(heic ? 'HEIC-Bilder brauchen unter Windows die „HEIF-Bilderweiterungen“ aus dem Microsoft Store' : `Die Datei ließ sich nicht lesen – beschädigt oder Bildformat ${ext || '(unbekannt)'} nicht unterstützt`);
  }
  return png;
}

module.exports = { toPng, isPng, viaWic, EXTENSIONS };
