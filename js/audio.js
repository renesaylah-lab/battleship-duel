// Tiny WebAudio sound engine — no audio files needed.
(function () {
  const BS = window.BS || (window.BS = {});
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { /* no audio */ }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.2, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }

  function noise(dur, vol, cutoff) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, Math.max(1, c.sampleRate * dur), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    n.buffer = buf;
    const g = c.createGain(); g.gain.value = vol || 0.3;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff || 1200;
    n.connect(f); f.connect(g); g.connect(c.destination);
    n.start();
  }

  BS.sfx = {
    setMuted(m) { muted = m; },
    isMuted() { return muted; },
    resume() { ac(); },
    click() { tone(520, 0.06, "square", 0.07); },
    place() { tone(330, 0.08, "triangle", 0.14); tone(440, 0.08, "triangle", 0.08); },
    fire() { tone(200, 0.28, "sawtooth", 0.16, 70); noise(0.18, 0.12, 800); },
    miss() { noise(0.4, 0.2, 1600); tone(300, 0.22, "sine", 0.05, 180); },
    hit() { noise(0.55, 0.38, 900); tone(95, 0.42, "sawtooth", 0.22, 40); },
    sunk() { noise(0.8, 0.42, 700); tone(75, 0.75, "sawtooth", 0.28, 28); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.28, "triangle", 0.2), i * 150)); },
    lose() { [440, 349, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.32, "sawtooth", 0.16), i * 170)); },
    turn() { tone(680, 0.12, "sine", 0.1, 880); },
  };
})();
