'use strict';
/** Nachgebauter RomM-Server (Antwortformate wie RomM 5.4) für Tests */
const http = require('http');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function rom(id, platform, fsName, extra = {}) {
  const ext = fsName.includes('.') ? fsName.split('.').pop() : '';
  return {
    id, platform_id: platform.id, platform_slug: platform.slug, platform_fs_slug: platform.fs_slug, platform_display_name: platform.name,
    fs_name: fsName, fs_name_no_ext: fsName.replace(/\.[^.]+$/, ''), fs_extension: ext, fs_size_bytes: 2048,
    name: extra.name || fsName.replace(/\.[^.]+$/, '').replace(/\s*\(.*?\)/g, ''), summary: 'Ein Testspiel.',
    metadatum: { genres: ['Platform'], average_rating: 88, first_release_date: 700000000 },
    path_cover_large: `/assets/romm/resources/roms/${platform.id}/${id}/cover/big.png?ts=1`, path_cover_small: null, url_cover: null,
    regions: ['Europe'], has_multiple_files: false, created_at: '2026-01-01T00:00:00Z', ...extra
  };
}

function start({ token = 'rmm_test', port = 0 } = {}) {
  const snes = { id: 1, slug: 'snes', fs_slug: 'snes', name: 'Super Nintendo', rom_count: 3 };
  const psx = { id: 2, slug: 'psx', fs_slug: 'psx', name: 'PlayStation', rom_count: 1 };
  const roms = [
    rom(11, snes, 'Super Mario World (USA).sfc'),
    rom(12, snes, 'Donkey Kong Country (Europe).sfc'),
    rom(13, snes, 'Chrono Trigger (USA).sfc'),
    rom(21, psx, 'Final Fantasy VII (Europe)', { has_multiple_files: true, fs_extension: '' })
  ];
  const calls = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(req.method + ' ' + u.pathname + u.search);
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/heartbeat') return json({ SYSTEM: { VERSION: '5.4.0' } });
    const auth = req.headers.authorization || '';
    const ok = auth === `Bearer ${token}` || auth === 'Basic ' + Buffer.from('ale:geheim').toString('base64');
    if (!ok) return json({ detail: 'Unauthorized' }, 401);
    if (u.pathname === '/api/users/me') return json({ username: 'ale' });
    if (u.pathname === '/api/platforms') return json([snes, psx]);
    if (u.pathname === '/api/roms') {
      const ids = u.searchParams.getAll('platform_ids').map(Number);
      const items = roms.filter((r) => !ids.length || ids.includes(r.platform_id));
      const limit = Number(u.searchParams.get('limit') || 50); const offset = Number(u.searchParams.get('offset') || 0);
      return json({ items: items.slice(offset, offset + limit), total: items.length, limit, offset });
    }
    if (u.pathname === '/api/recommendations') {
      return json(roms.map((r) => ({ rom: r, score: 0.9, reasons: [], seed_rom_id: 11, seed_rom_name: 'Super Mario World' })));
    }
    const one = u.pathname.match(/^\/api\/roms\/(\d+)$/);
    if (one) { const r = roms.find((x) => x.id === Number(one[1])); return r ? json(r) : json({}, 404); }
    const m = u.pathname.match(/^\/api\/roms\/(\d+)\/content\/(.+)$/);
    if (m) {
      const r = roms.find((x) => x.id === Number(m[1]));
      if (!r) return json({}, 404);
      if (r.has_multiple_files) {
        // Kleines ZIP mit zwei Dateien (cue + bin), mit „store“ (unkomprimiert)
        const zip = require('./fake-zip')([['Final Fantasy VII (Europe).cue', 'FILE "Final Fantasy VII (Europe).bin" BINARY'], ['Final Fantasy VII (Europe).bin', 'DATA']]);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length });
        return res.end(zip);
      }
      const body = Buffer.alloc(2048, 7);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
      return res.end(body);
    }
    if (u.pathname.startsWith('/assets/romm/resources/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    return json({}, 404);
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close(), calls, roms })));
}

module.exports = { start };
if (require.main === module) start({ port: Number(process.argv[2]) || 18080 }).then((s) => console.log('Fake-RomM läuft auf', s.url));
