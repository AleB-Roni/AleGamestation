/* Kleine UI-Sounds, synthetisch erzeugt (keine Audiodateien nötig) */
(function () {
  let ctx = null;
  let enabled = true;
  const presets = {
    move: { f: 880, f2: 990, d: 0.045, v: 0.035, type: 'sine' },
    tab: { f: 520, f2: 700, d: 0.07, v: 0.05, type: 'triangle' },
    accept: { f: 660, f2: 1320, d: 0.12, v: 0.06, type: 'triangle' },
    back: { f: 500, f2: 300, d: 0.09, v: 0.05, type: 'sine' },
    error: { f: 200, f2: 140, d: 0.18, v: 0.07, type: 'square' },
    launch: { f: 330, f2: 1320, d: 0.35, v: 0.07, type: 'sawtooth' }
  };
  function play(name) {
    if (!enabled) return;
    const p = presets[name];
    if (!p) return;
    try {
      ctx = ctx || new AudioContext();
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 3000;
      o.type = p.type;
      o.frequency.setValueAtTime(p.f, t);
      o.frequency.exponentialRampToValueAtTime(p.f2, t + p.d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p.v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.d + 0.05);
      o.connect(filt).connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + p.d + 0.08);
    } catch (_) { /* Audio nicht verfügbar */ }
  }
  window.Sounds = { play, setEnabled: (v) => { enabled = !!v; } };
})();
