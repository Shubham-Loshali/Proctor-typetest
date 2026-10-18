// All sounds are generated with the Web Audio API, so there are no audio files to host.
const Snd = (() => {
  let ctx = null;
  let muted = localStorage.getItem('mute') === '1';
  let clickBuf = null;

  function c() {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, delay, slideTo) {
    if (muted) return;
    const x = c(), t = x.currentTime + (delay || 0);
    const o = x.createOscillator(), g = x.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(x.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // mechanical key: a short noise "tick" plus a low "thock"
  function key() {
    if (muted) return;
    const x = c();
    if (!clickBuf) {
      const n = Math.floor(x.sampleRate * 0.035);
      clickBuf = x.createBuffer(1, n, x.sampleRate);
      const d = clickBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
    }
    const s = x.createBufferSource(); s.buffer = clickBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = x.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = x.createGain(); g.gain.value = 0.45;
    s.connect(f); f.connect(g); g.connect(x.destination); s.start();
    tone(130, 0.05, 'sine', 0.12, 0);
  }

  return {
    unlock() { c(); },
    key,
    err() { tone(190, 0.14, 'sawtooth', 0.06, 0, 110); },
    back() { tone(240, 0.04, 'triangle', 0.05, 0); },
    beep(go) { go ? tone(1040, 0.35, 'square', 0.05, 0) : tone(620, 0.12, 'square', 0.04, 0); },
    end() { tone(520, 0.5, 'sine', 0.12, 0); tone(390, 0.8, 'sine', 0.1, 0.12); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.1, i * 0.13)); },
    toggle() { muted = !muted; localStorage.setItem('mute', muted ? '1' : '0'); return muted; },
    isMuted() { return muted; },
  };
})();
