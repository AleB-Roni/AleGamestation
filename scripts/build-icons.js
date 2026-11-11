'use strict';
/**
 * Übernimmt die benötigten Icons aus dem Icon-Paket "Lucide" (ISC-Lizenz, lucide.dev)
 * in src/renderer/icons.js. Aufruf: npm run icons
 */
const fs = require('fs');
const path = require('path');

// App-Name -> Lucide-Name
const MAP = {
  play: 'play', pause: 'pause', stop: 'square', 'skip-back': 'skip-back', 'skip-forward': 'skip-forward',
  home: 'house', power: 'power', restart: 'rotate-ccw', refresh: 'refresh-cw', moon: 'moon', logout: 'log-out',
  monitor: 'monitor', tv: 'tv', duplicate: 'copy', extend: 'columns-2', settings: 'settings', sliders: 'sliders-horizontal',
  download: 'download', upload: 'upload', update: 'circle-arrow-up', star: 'star', gamepad: 'gamepad-2', keyboard: 'keyboard',
  image: 'image', undo: 'undo-2', eye: 'eye', 'eye-off': 'eye-off', trash: 'trash-2', folder: 'folder', 'folder-plus': 'folder-plus',
  plus: 'plus', check: 'check', x: 'x', list: 'list', grid: 'layout-grid', app: 'app-window', clock: 'clock',
  external: 'external-link', music: 'music', 'volume-down': 'volume-1', 'volume-up': 'volume-2', 'volume-x': 'volume-x',
  mouse: 'mouse', search: 'search', plug: 'plug', info: 'info', warning: 'triangle-alert', pin: 'map-pin',
  later: 'fast-forward', back: 'chevron-left', chevron: 'chevron-right', bolt: 'zap', 'play-pause': 'circle-play',
  shuffle: 'shuffle', heart: 'heart', link: 'link', maximize: 'maximize',
  clapperboard: 'clapperboard', camera: 'camera', 'circle-dot': 'circle-dot'
};

const pkgDir = path.dirname(require.resolve('lucide-static/package.json'));
const version = require(path.join(pkgDir, 'package.json')).version;
const out = {};
for (const [name, lucide] of Object.entries(MAP)) {
  const file = path.join(pkgDir, 'icons', lucide + '.svg');
  if (!fs.existsSync(file)) throw new Error(`Lucide-Icon fehlt: ${lucide}`);
  const svg = fs.readFileSync(file, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
  out[name] = inner;
}
const target = path.join(__dirname, '..', 'src', 'renderer', 'icons.js');
const src = fs.readFileSync(target, 'utf8');
const block = `/* LUCIDE-START – automatisch erzeugt mit "npm run icons" aus Lucide ${version} (ISC-Lizenz, siehe licenses/lucide-LICENSE.txt) */\n  const LUCIDE = ${JSON.stringify(out, null, 4).replace(/\n/g, '\n  ')};\n  /* LUCIDE-END */`;
const next = src.replace(/\/\* LUCIDE-START[\s\S]*?LUCIDE-END \*\//, block);
if (next === src && !src.includes('LUCIDE-START')) throw new Error('Markierung LUCIDE-START fehlt in icons.js');
fs.writeFileSync(target, next);
fs.mkdirSync(path.join(__dirname, '..', 'licenses'), { recursive: true });
fs.copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(__dirname, '..', 'licenses', 'lucide-LICENSE.txt'));
console.log(`${Object.keys(out).length} Icons aus Lucide ${version} übernommen`);
