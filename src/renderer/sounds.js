/* UI-Sounds im Stil moderner Konsolen – komplett synthetisch erzeugt (keine Audiodateien, eigenes Sounddesign).
 * Weiche, glockenartige Töne mit Hall. Themen: "modern" (sanft, luftig), "retro" (8-Bit), "off". */
(function () {
  let ctx = null;
  let master = null;
  let reverb = null;
  let theme = 'modern';
  let volume = 0.7;
  let lastMove = 0;
  let moveStep = 0;

  function init() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    // Sanfter Kompressor gegen Übersteuern
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    // Hall aus generierter Impulsantwort (abklingendes, gefiltertes Rauschen)
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = buf;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    reverb.connect(lp).connect(wet).connect(master);
    return ctx;
  }

  /** Glockenartiger Ton: Grundton + leise Obertöne, schneller Anschlag, weiches Ausklingen */
  function bell(freq, { at = 0, dur = 0.5, vol = 0.12, wet = 0.6, partials = [1, 2.01, 3.0], decay = [1, 0.28, 0.08], pan = 0 } = {}) {
    const t = ctx.currentTime + at;
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(master);
    const send = ctx.createGain();
    send.gain.value = wet;
    panner.connect(send).connect(reverb);
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * p;
      const v = vol * (decay[i] ?? 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + i * 0.8));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  /** Gefiltertes Rauschen (für "Whoosh"/Luft) */
  function air({ at = 0, dur = 0.3, from = 800, to = 4000, vol = 0.05, q = 1.2 } = {}) {
    const t = ctx.currentTime + at;
    const len = Math.ceil(ctx.sampleRate * (dur + 0.05));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g);
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(reverb);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Kurzer, weicher "Tick" (wie ein sanfter Klick) */
  function tick(freq, vol = 0.06) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(hp).connect(g).connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    g.connect(send).connect(reverb);
    o.start(t);
    o.stop(t + 0.08);
  }

  // Pentatonik (D-Dur) für angenehme, nie schiefe Tonfolgen
  const SCALE = [1174.66, 1318.51, 1479.98, 1760.0, 1975.53];

  const MODERN = {
    move() {
      // Leicht variierende Tonhöhe beim schnellen Scrollen – klingt lebendig statt monoton
      const now = performance.now();
      moveStep = now - lastMove < 180 ? (moveStep + 1) % SCALE.length : 0;
      lastMove = now;
      tick(SCALE[moveStep] * 1.5, 0.035);
      bell(SCALE[moveStep], { dur: 0.22, vol: 0.05, wet: 0.35, partials: [1, 2.0], decay: [1, 0.15] });
    },
    tab() {
      air({ dur: 0.28, from: 600, to: 3200, vol: 0.035 });
      bell(880, { at: 0.03, dur: 0.35, vol: 0.06, wet: 0.5, pan: -0.15 });
      bell(1318.5, { at: 0.07, dur: 0.4, vol: 0.045, wet: 0.6, pan: 0.15 });
    },
    accept() {
      bell(1174.66, { dur: 0.6, vol: 0.09, wet: 0.6 });
      bell(1760, { at: 0.06, dur: 0.8, vol: 0.075, wet: 0.7 });
    },
    back() {
      bell(1318.5, { dur: 0.35, vol: 0.07, wet: 0.5 });
      bell(880, { at: 0.06, dur: 0.45, vol: 0.06, wet: 0.55 });
    },
    error() {
      bell(220, { dur: 0.35, vol: 0.12, wet: 0.2, partials: [1, 1.5], decay: [1, 0.4] });
      bell(207.65, { at: 0.11, dur: 0.4, vol: 0.1, wet: 0.2, partials: [1, 1.5], decay: [1, 0.4] });
    },
    launch() {
      // Aufsteigender, schimmernder Akkord
      air({ dur: 1.1, from: 300, to: 7000, vol: 0.05, q: 0.8 });
      [587.33, 880, 1174.66, 1479.98, 1760, 2349.32].forEach((f, i) => bell(f, { at: i * 0.07, dur: 1.6, vol: 0.06, wet: 0.85, pan: (i % 2 ? 0.3 : -0.3) }));
    },
    startup() {
      // Ruhiger, warmer Akkord beim Start
      [293.66, 440, 587.33, 739.99].forEach((f, i) => bell(f, { at: i * 0.12, dur: 3.2, vol: 0.05, wet: 1, partials: [1, 2.0, 3.0], decay: [1, 0.2, 0.05] }));
      bell(1174.66, { at: 0.6, dur: 2.4, vol: 0.04, wet: 1 });
      air({ at: 0.0, dur: 2.2, from: 200, to: 2400, vol: 0.025, q: 0.6 });
    },
    toggle() {
      tick(2400, 0.05);
      bell(1479.98, { dur: 0.25, vol: 0.05, wet: 0.4 });
    },
    open() {
      air({ dur: 0.22, from: 1200, to: 4200, vol: 0.03 });
      bell(1318.51, { dur: 0.5, vol: 0.06, wet: 0.65 });
    }
  };

  function chip(type, f1, f2, dur, vol = 0.05, at = 0) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const RETRO = {
    move: () => chip('square', 1200, 1200, 0.03, 0.03),
    tab: () => chip('square', 600, 900, 0.06, 0.04),
    accept: () => { chip('square', 880, 880, 0.06, 0.04); chip('square', 1320, 1320, 0.1, 0.04, 0.06); },
    back: () => chip('square', 700, 350, 0.08, 0.04),
    error: () => chip('sawtooth', 160, 100, 0.2, 0.05),
    launch: () => [523, 659, 784, 1047].forEach((f, i) => chip('square', f, f, 0.08, 0.04, i * 0.08)),
    startup: () => [392, 523, 659, 784].forEach((f, i) => chip('triangle', f, f, 0.15, 0.06, i * 0.12)),
    toggle: () => chip('square', 1500, 1500, 0.03, 0.03),
    open: () => chip('square', 900, 1300, 0.06, 0.035)
  };

  function play(name) {
    if (theme === 'off' || volume <= 0) return;
    try {
      init();
      if (ctx.state === 'suspended') ctx.resume();
      const set = theme === 'retro' ? RETRO : MODERN;
      if (set[name]) set[name]();
    } catch (_) { /* Audio nicht verfügbar */ }
  }

  window.Sounds = {
    play,
    setEnabled: (v) => { if (!v) theme = 'off'; else if (theme === 'off') theme = 'modern'; },
    setTheme: (t) => { theme = t || 'modern'; },
    setVolume: (v) => { volume = Math.max(0, Math.min(1, Number(v))); if (master) master.gain.value = volume; }
  };
})();
