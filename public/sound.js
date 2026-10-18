// Real Alpaca Mechanical Switch Audio with zero-latency Web Audio API playback
const Snd = (() => {
  let ctx = null;
  let muted = localStorage.getItem('mute') === '1';
  const keyBuffers = [];
  let spaceBuffer = null;

  function c() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext;
      ctx = new A();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Preload Alpaca switch audio files into memory
  async function loadBuffer(url) {
    try {
      const audioCtx = c();
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      return await audioCtx.decodeAudioData(arrayBuf);
    } catch (e) {
      return null;
    }
  }

  async function preloadAlpaca() {
    for (let i = 1; i <= 5; i++) {
      const buf = await loadBuffer('/sounds/alpaca/press_key' + i + '.mp3');
      if (buf) keyBuffers.push(buf);
    }
    spaceBuffer = await loadBuffer('/sounds/alpaca/press_space.mp3');
  }

  // Preload as soon as the script loads
  if (typeof window !== 'undefined') {
    preloadAlpaca();
  }

  function playBuffer(buf, vol = 0.85) {
    if (muted || !buf) return;
    const x = c();
    const src = x.createBufferSource();
    src.buffer = buf;
    // Natural slight pitch variation for mechanical realism
    src.playbackRate.value = 0.98 + Math.random() * 0.04;
    const gainNode = x.createGain();
    gainNode.gain.value = vol;
    src.connect(gainNode);
    gainNode.connect(x.destination);
    src.start();
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

  function key(char) {
    if (muted) return;
    c();
    if (char === ' ' && spaceBuffer) {
      playBuffer(spaceBuffer, 0.9);
      return;
    }
    if (keyBuffers.length > 0) {
      const buf = keyBuffers[Math.floor(Math.random() * keyBuffers.length)];
      playBuffer(buf, 0.85);
    }
  }

  function back() {
    if (muted) return;
    c();
    if (keyBuffers.length > 0) {
      const buf = keyBuffers[Math.floor(Math.random() * keyBuffers.length)];
      playBuffer(buf, 0.75);
    }
  }

  return {
    unlock() { c(); if (keyBuffers.length === 0) preloadAlpaca(); },
    key,
    back,
    err() { tone(190, 0.14, 'sawtooth', 0.06, 0, 110); },
    beep(go) { go ? tone(1040, 0.35, 'square', 0.05, 0) : tone(620, 0.12, 'square', 0.04, 0); },
    end() { tone(520, 0.5, 'sine', 0.12, 0); tone(390, 0.8, 'sine', 0.1, 0.12); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.1, i * 0.13)); },
    toggle() { muted = !muted; localStorage.setItem('mute', muted ? '1' : '0'); return muted; },
    isMuted() { return muted; },
  };
})();
