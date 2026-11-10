/* Konsolen-Overlay: Spiel fortsetzen/beenden, Schnellstart, Spotify, Lautstärke */
(function () {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { data: null, spotify: null, rows: [], row: 0, col: 0, armed: null, armTimer: null, spotifyTimer: null, playlists: [] };

  // Eingaben kommen ausschließlich von der App (alle Controller-Typen), nicht von Chromium
  Input.configure({ chromiumPads: false });
  Input.hidConnected(1);
  api.onPadState((s) => Input.hidState(s));

  function toast(text, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function cover(g, sysColor) {
    return g.cover
      ? `<img src="${esc(g.cover)}" alt="">`
      : `<div class="placeholder" style="--c:${esc(sysColor || '#444')}"><div class="ph-name">${esc(g.name)}</div></div>`;
  }

  function minutesSince(ts) {
    if (!ts) return '';
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return m < 60 ? `läuft seit ${m} Min.` : `läuft seit ${Math.floor(m / 60)} Std. ${m % 60} Min.`;
  }

  /** Zeilen aufbauen: jede Zeile ist eine Liste von Elementen mit action() */
  function buildRows() {
    const d = S.data || {};
    const rows = [];
    const game = d.running;
    const g = [{ kind: 'btn', icon: 'play', label: game ? 'Zurück zum Spiel' : 'Schließen', action: () => act({ type: 'resume' }) },
      { kind: 'btn', icon: 'home', label: 'Zur Oberfläche', action: () => act({ type: 'home' }) }];
    if (game) g.push({ kind: 'btn', icon: 'stop', label: 'Spiel beenden', danger: true, confirm: 'Wirklich beenden?', action: () => act({ type: 'quit' }) });
    rows.push({ title: game ? 'Spiel' : 'AleGamestation', items: g });

    const sysColor = (id) => ((d.systems || []).find((s) => s.id === id) || {}).color;
    rows.push({
      title: game ? 'Schnellstart – wechselt das Spiel' : 'Schnellstart',
      items: (d.recent || []).map((r) => ({
        kind: 'game', game: r, color: sysColor(r.system), confirm: game ? `${game.name} beenden & starten` : null,
        action: () => act({ type: 'launch', id: r.id })
      })),
      empty: 'Noch keine zuletzt gespielten Spiele'
    });

    const sp = S.spotify || {};
    const ctl = (cmd) => () => act({ type: 'spotify', cmd }, true);
    let music;
    if (sp.api && (sp.active || sp.running)) {
      music = [{ kind: 'btn', icon: 'skip-back', label: 'Zurück', action: ctl('prev') },
        { kind: 'btn', icon: sp.playing ? '⏸' : '▶', label: sp.playing ? 'Pause' : 'Abspielen', action: ctl('playpause') },
        { kind: 'btn', icon: 'skip-forward', label: 'Weiter', action: ctl('next') },
        { kind: 'btn', icon: 'shuffle', label: sp.shuffle ? 'Zufall an' : 'Zufall aus', on: !!sp.shuffle, action: ctl('shuffle') }];
    } else if (sp.running) {
      music = [{ kind: 'btn', icon: 'skip-back', label: 'Zurück', action: ctl('prev') },
        { kind: 'btn', icon: sp.playing ? '⏸' : '▶', label: sp.playing ? 'Pause' : 'Abspielen', action: ctl('playpause') },
        { kind: 'btn', icon: 'skip-forward', label: 'Weiter', action: ctl('next') }];
    } else {
      music = [{ kind: 'btn', icon: 'music', label: 'Spotify im Hintergrund starten', action: ctl('open') },
        { kind: 'btn', icon: 'play-pause', label: 'Play / Pause', action: ctl('playpause') }];
    }
    rows.push({ title: 'Musik', items: music, music: true });
    if (sp.api) {
      rows.push({
        title: 'Musik auswählen',
        items: (S.playlists || []).map((pl) => ({ kind: 'playlist', pl, action: () => playPlaylist(pl) })),
        empty: S.playlistError || 'Lade deine Playlists …'
      });
    }

    rows.push({
      title: 'System',
      items: [
        { kind: 'btn', icon: 'volume-down', label: 'Leiser', action: () => act({ type: 'volume', cmd: 'voldown' }, true), repeat: true },
        { kind: 'btn', icon: 'volume-up', label: 'Lauter', action: () => act({ type: 'volume', cmd: 'volup' }, true), repeat: true },
        { kind: 'btn', icon: 'volume-x', label: 'Stumm', action: () => act({ type: 'volume', cmd: 'mute' }, true) },
        { kind: 'btn', icon: 'mouse', label: 'Maussteuerung', action: () => act({ type: 'mouse' }) }
      ]
    });
    return rows;
  }

  function render() {
    const d = S.data || {};
    const game = d.running;
    $('#ovNow').innerHTML = game
      ? `<div class="mini">${cover(game, ((d.systems || []).find((s) => s.id === game.system) || {}).color)}</div><div><small>Läuft gerade</small><h2>${esc(game.name)}</h2><div class="time">${esc(minutesSince(game.startedAt))}</div></div>`
      : `<div><small>Kein Spiel aktiv</small><h2>Konsolen-Menü</h2></div>`;
    S.rows = buildRows();
    S.row = Math.min(S.row, S.rows.length - 1);
    const box = $('#ovRows');
    box.innerHTML = '';
    S.rows.forEach((r, ri) => {
      const t = document.createElement('div');
      t.className = 'ov-row-title';
      t.innerHTML = `<span>${esc(r.title)}</span>`;
      box.appendChild(t);
      if (r.music) {
        const sp = S.spotify || {};
        const m = document.createElement('div');
        m.className = 'ov-music';
        if (sp.api && sp.title) {
          m.className = 'ov-music ov-track';
          const pct = sp.duration ? Math.min(100, (sp.progress / sp.duration) * 100) : 0;
          m.innerHTML = `${sp.image ? `<img src="${esc(sp.image)}" alt="">` : `<div class="art">${Icons.svg('music')}</div>`}
            <div class="meta"><b>${esc(sp.title)}</b><span>${esc(sp.artist || '')}${sp.playing ? '' : ' · pausiert'}</span>
            <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
        } else {
          m.innerHTML = sp.unsupported ? 'Steuert Spotify und andere Player über die Medientasten'
            : sp.error ? esc(sp.error)
              : sp.api && sp.active === false && !sp.running ? 'Spotify ist bereit – Playlist auswählen zum Abspielen'
                : !sp.running && !sp.active ? 'Spotify läuft nicht' : sp.playing ? `${Icons.svg('music')} <b>${esc(sp.title || '')}</b>${sp.artist ? ' – ' + esc(sp.artist) : ''}` : 'Spotify pausiert';
          if (!sp.api && !sp.unsupported) m.innerHTML += ' <span class="ov-tip">· Playlists auswählen: Einstellungen → Spotify</span>';
        }
        box.appendChild(m);
      }
      const row = document.createElement('div');
      row.className = 'ov-row';
      if (!r.items.length) row.innerHTML = `<div class="ov-empty">${esc(r.empty || '')}</div>`;
      r.items.forEach((it, ci) => {
        const el = document.createElement('div');
        if (it.kind === 'game') {
          el.className = 'ov-game';
          el.innerHTML = cover(it.game, it.color);
        } else if (it.kind === 'playlist') {
          el.className = 'ov-pl' + (it.pl.liked ? ' liked' : '');
          el.innerHTML = `${it.pl.image ? `<img src="${esc(it.pl.image)}" alt="">` : `<div class="art">${Icons.svg(it.pl.liked ? 'heart' : 'music')}</div>`}<div class="name">${esc(it.pl.name)}</div>`;
        } else {
          el.className = 'ov-btn' + (it.danger ? ' danger' : '') + (it.on ? ' on' : '');
          el.innerHTML = `<span class="ico">${Icons.svg(it.icon) || esc(it.icon)}</span><span>${esc(it.label)}</span>`;
        }
        el.onclick = () => { S.row = ri; S.col = ci; activate(); };
        it.el = el;
        row.appendChild(el);
      });
      box.appendChild(row);
    });
    focus();
    hints();
  }

  function focus() {
    S.rows.forEach((r, ri) => r.items.forEach((it, ci) => {
      const on = ri === S.row && ci === S.col;
      it.el.classList.toggle('focused', on);
      const armed = S.armed && S.armed.row === ri && S.armed.col === ci;
      it.el.classList.toggle('armed', !!armed);
      const lbl = it.el.querySelector('.ov-armed-label');
      if (armed && it.kind === 'game' && !lbl) it.el.insertAdjacentHTML('beforeend', `<div class="ov-armed-label">${esc(it.confirm)}</div>`);
      if (!armed && lbl) lbl.remove();
      if (it.kind === 'btn') {
        const text = it.el.querySelector('span:last-child');
        if (text) text.textContent = armed ? it.confirm : it.label;
      }
      if (on) it.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }));
  }

  function hints() {
    const h = (g, t) => `<span class="hint">${g} ${t}</span>`;
    const it = cur();
    $('#ovHints').innerHTML = h(Glyphs.html('A'), S.armed ? 'Bestätigen' : it && it.kind === 'game' ? 'Starten' : it && it.kind === 'playlist' ? 'Abspielen' : 'Auswählen')
      + h(Glyphs.html('B'), S.armed ? 'Abbrechen' : 'Zurück zum Spiel')
      + h(Glyphs.html('GUIDE', { raw: true, pad: true }), 'Schließen');
  }

  function cur() {
    const r = S.rows[S.row];
    return r && r.items[S.col];
  }

  function disarm() {
    clearTimeout(S.armTimer);
    if (!S.armed) return false;
    S.armed = null;
    focus(); hints();
    return true;
  }

  async function act(a, stayOpen) {
    try {
      const r = await api.overlayAction(a);
      if (a.type === 'spotify' || a.type === 'volume') setTimeout(refreshSpotify, 600);
      if (a.type === 'quit' && r === false) toast('Kein laufendes Spiel erkannt', 'error');
      return r;
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    }
    return stayOpen;
  }

  function activate() {
    const it = cur();
    if (!it) return;
    // Gefährliche Aktionen (Beenden, Spiel wechseln) brauchen eine Bestätigung
    if (it.confirm && !(S.armed && S.armed.row === S.row && S.armed.col === S.col)) {
      S.armed = { row: S.row, col: S.col };
      Sounds.play('error');
      focus(); hints();
      clearTimeout(S.armTimer);
      S.armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    Sounds.play(it.kind === 'game' ? 'launch' : 'accept');
    it.action();
  }

  Input.on((a) => {
    if (!document.body.classList.contains('open')) return;
    const r = S.rows[S.row];
    switch (a) {
      case 'up': if (S.row > 0) { disarm(); S.row--; S.col = Math.min(S.col, Math.max(0, S.rows[S.row].items.length - 1)); focus(); hints(); Sounds.play('move'); } break;
      case 'down': if (S.row < S.rows.length - 1) { disarm(); S.row++; S.col = Math.min(S.col, Math.max(0, S.rows[S.row].items.length - 1)); focus(); hints(); Sounds.play('move'); } break;
      case 'left': if (S.col > 0) { disarm(); S.col--; focus(); hints(); Sounds.play('move'); } break;
      case 'right': if (r && S.col < r.items.length - 1) { disarm(); S.col++; focus(); hints(); Sounds.play('move'); } break;
      case 'accept': activate(); break;
      case 'back': if (!disarm()) { Sounds.play('back'); act({ type: 'resume' }); } else Sounds.play('back'); break;
      default: break;
    }
  });

  async function playPlaylist(pl) {
    toast(`Spiele „${pl.name}“ …`);
    const ok = await act({ type: 'spotify', cmd: 'play', uri: pl.uri }, false);
    if (ok === true) toast(`▶ ${pl.name}`, 'ok');
    setTimeout(refreshSpotify, 1200);
  }

  async function loadPlaylists() {
    S.playlistError = '';
    try { S.playlists = await api.overlayPlaylists(); } catch (e) {
      S.playlists = [];
      S.playlistError = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
    if (S.data) render();
  }

  async function refreshSpotify() {
    try { S.spotify = await api.overlaySpotify(); } catch { S.spotify = null; }
    if (S.data) render();
  }

  async function open() {
    try {
      const cfg = await api.getConfig();
      Sounds.setTheme(cfg.general.uiSounds === false ? 'off' : cfg.general.soundTheme || 'modern');
      Sounds.setVolume(cfg.general.soundVolume ?? 0.7);
      document.documentElement.style.setProperty('--accent', cfg.general.accentColor || '#7c5cff');
      Glyphs.configure({ style: cfg.controller.glyphStyle || 'auto', swapAB: cfg.controller.swapAB });
    } catch { /* Standardwerte */ }
    S.data = await api.overlayData();
    if (S.data.ps) Glyphs.setDetected('playstation', 'DualSense');
    S.row = 0; S.col = 0; S.armed = null;
    render();
    requestAnimationFrame(() => document.body.classList.add('open'));
    Sounds.play('open');
    refreshSpotify().then(() => { if (S.spotify && S.spotify.api) loadPlaylists(); });
    clearInterval(S.spotifyTimer);
    S.spotifyTimer = setInterval(refreshSpotify, 3000);
  }

  function close() {
    document.body.classList.remove('open');
    clearInterval(S.spotifyTimer);
    disarm();
  }

  api.onOverlayOpen(open);
  api.onOverlayClose(close);
  api.onOverlayRefresh(async () => { if (document.body.classList.contains('open')) { S.data = await api.overlayData(); render(); } });

  setInterval(() => {
    $('#ovClock').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const t = document.querySelector('.ov-now .time');
    if (t && S.data && S.data.running) t.textContent = minutesSince(S.data.running.startedAt);
  }, 1000);

  window.Overlay = { open, close, state: S };
})();
