// Simulates N players joining and typing at random speeds.
// Usage: node test/bots.js 100 http://localhost:3000 JOINCODE
// (the join code is shown on the admin page and printed when the server starts)
const { io } = require('socket.io-client');

const N = parseInt(process.argv[2], 10) || 100;
const URL = process.argv[3] || 'http://localhost:3000';
const CODE = process.argv[4];
if (!CODE) { console.log('Usage: node test/bots.js 100 http://localhost:3000 JOINCODE'); process.exit(1); }

for (let i = 0; i < N; i++) {
  const s = io(URL);
  const pid = 'bot' + i;
  const wpm = 30 + Math.random() * 70; // 30 to 100 WPM
  let startAt = 0, offset = 0, text = '', timer = null;

  s.on('connect', () => s.emit('join', { pid, name: 'Bot ' + (i + 1), roll: 'B' + i, code: CODE }, () => {}));
  s.on('state', (st) => {
    offset = st.serverNow - Date.now();
    if (st.text && st.startAt !== startAt) {
      startAt = st.startAt; text = st.text;
      clearInterval(timer);
      timer = setInterval(() => {
        const el = (Date.now() + offset - startAt) / 1000;
        if (el < 0) return;
        const n = Math.min(text.length, Math.floor((el * wpm * 5) / 60));
        s.emit('progress', { typed: text.slice(0, n), keys: n, mistakes: Math.floor(n * 0.03) });
        if (n >= text.length) clearInterval(timer);
      }, 500);
    }
  });
}
console.log(`Started ${N} bots against ${URL}`);
