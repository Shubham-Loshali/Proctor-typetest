// Load test that MEASURES lag instead of just starting bots.
//
// Usage:
//   node test/loadtest.js --url https://your-app.onrender.com --code JOINCODE --n 100 --pass ADMINPASS
//
//   --url   server address (default http://localhost:3000)
//   --code  join code shown on /admin
//   --n     number of simulated players (default 100)
//   --pass  admin password. If given, the test logs in as admin, starts a round by itself and
//           reads the server's own health numbers. Without it, start the round yourself from /admin.
//   --secs  round length in seconds when --pass is used (default 30)
//   --ramp  spread joins over this many ms (default 0 = everyone at once, like a real room)
//
// While it runs it prints one line every 5 seconds, then a final verdict.
const { io } = require('socket.io-client');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; };
const URL = arg('url', 'http://localhost:3000');
const CODE = arg('code');
const N = parseInt(arg('n', '100'), 10);
const PASS = arg('pass');
const SECS = parseInt(arg('secs', '30'), 10);
const RAMP = parseInt(arg('ramp', '0'), 10);
if (!CODE) { console.log('Missing --code. Example: node test/loadtest.js --url http://localhost:3000 --code ABCDE --n 100 --pass innovista'); process.exit(1); }

const TEXT = 'Every great project begins with a small idea and a stubborn habit of trying again. Code that works on the first run is rare, so we learn to read errors, test our assumptions, and fix one thing at a time. Teamwork matters as much as talent, because a clear message to a teammate can save hours of confusion. Keep your hands relaxed, your eyes on the screen, and your mind on the next word.';

const m = {
  phases: {}, connected: 0, joined: 0, joinFail: 0, connectErr: 0, disconnects: 0, reconnects: 0,
  connectMs: [], joinMs: [], rtt: [], rttWindow: [], timeouts: 0, results: 0, roundStarted: false, packets: 0,
};
let health = null;
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };

function bot(i) {
  const t0 = Date.now();
  const s = io(URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
  const pid = 'lt' + i + '-' + Math.random().toString(36).slice(2, 6);
  const wpm = 30 + Math.random() * 70;
  let wasConnected = false, started = 0, timer = null, text = '';

  const doJoin = () => {
    const j0 = Date.now();
    s.emit('join', { pid, name: 'Load ' + (i + 1), roll: 'L' + i, code: CODE }, (res) => {
      if (res && res.ok) { m.joined++; m.joinMs.push(Date.now() - j0); }
      else { m.joinFail++; if (m.joinFail <= 3) console.log('  join failed:', res && res.error); }
    });
  };
  s.on('connect', () => {
    if (wasConnected) m.reconnects++; else { m.connected++; m.connectMs.push(Date.now() - t0); }
    wasConnected = true; doJoin();
  });
  s.on('connect_error', () => { m.connectErr++; });
  s.on('disconnect', () => { m.disconnects++; });
  s.on('results', () => { m.results++; });
  s.on('state', (st) => {
    m.phases[st.phase] = (m.phases[st.phase] || 0) + 1;
    if (st.text && st.startAt !== started) {
      started = st.startAt; text = st.text; m.roundStarted = true;
      const off = st.serverNow - Date.now();
      clearInterval(timer);
      timer = setInterval(() => {
        const el = (Date.now() + off - started) / 1000;
        if (el < 0) return;
        const n = Math.min(text.length, Math.floor((el * wpm * 5) / 60));
        s.volatile.emit('progress', { typed: text.slice(0, n), keys: n, mistakes: Math.floor(n * 0.03) });
        m.packets++;
        if (n >= text.length) clearInterval(timer);
      }, 500);
    }
  });
  // latency probe: how long does the server take to answer this bot?
  setInterval(() => {
    if (!s.connected) return;
    const t = Date.now();
    s.timeout(5000).emit('latency', (err) => {
      if (err) { m.timeouts++; return; }
      const ms = Date.now() - t; m.rtt.push(ms); m.rttWindow.push(ms);
    });
  }, 1000 + Math.random() * 500);
}

console.log(`Load test: ${N} players -> ${URL}${RAMP ? ' (ramped over ' + RAMP + ' ms)' : ' (all at once)'}\n`);
for (let i = 0; i < N; i++) RAMP ? setTimeout(() => bot(i), (i / N) * RAMP) : bot(i);

// optional admin: starts the round and reads server health
if (PASS) {
  const a = io(URL, { transports: ['websocket', 'polling'] });
  a.on('health', (h) => { health = h; maxHealth = { loopMax: Math.max(maxHealth.loopMax, h.loopMax), cpu: Math.max(maxHealth.cpu, h.cpu), loopP99: Math.max(maxHealth.loopP99, h.loopP99) }; });
  a.on('connect', () => a.emit('admin:login', PASS, (r) => {
    if (!r.ok) { console.log('Admin login failed: ' + r.error); return; }
    setTimeout(() => {
      a.emit('admin:setup', { text: TEXT, duration: SECS }, (s1) => {
        if (!s1.ok) return console.log('Could not set up round: ' + s1.error);
        a.emit('admin:start', (s2) => { if (s2.ok) startedAt = Date.now(); console.log(s2.ok ? '\n>> Admin started a ' + SECS + 's round\n' : 'Could not start: ' + s2.error); });
      });
    }, Math.max(8000, RAMP + 4000)); // let everyone join first
  }));
}
let maxHealth = { loopMax: 0, cpu: 0, loopP99: 0 };
let startedAt = 0;

const HARD_STOP = (PASS ? 120 + SECS : 120); // seconds
let tick = 0;
const iv = setInterval(() => {
  tick += 5;
  const w = m.rttWindow; m.rttWindow = [];
  console.log(
    `[${String(tick).padStart(3)}s] connected ${m.connected}/${N}  joined ${m.joined}  dropped ${m.disconnects}  ` +
    `ping p50 ${pct(w, 0.5)}ms p95 ${pct(w, 0.95)}ms max ${w.length ? Math.max(...w) : 0}ms` +
    (m.timeouts ? `  timeouts ${m.timeouts}` : '') +
    (health ? `  | server delay ${health.loopP99}ms cpu ${health.cpu}%` : ''));
  const roundOver = PASS && startedAt && (m.results >= N || Date.now() > startedAt + (5 + SECS + 12) * 1000);
  if (roundOver || tick >= HARD_STOP) finish();
}, 5000);

function finish() {
  clearInterval(iv);
  const p50 = pct(m.rtt, 0.5), p95 = pct(m.rtt, 0.95), p99 = pct(m.rtt, 0.99), max = m.rtt.length ? Math.max(...m.rtt) : 0;
  console.log('\n================ RESULT ================');
  console.log(`Players connected : ${m.connected}/${N}   joined OK: ${m.joined}   join failures: ${m.joinFail}   connect errors: ${m.connectErr}`);
  console.log(`Connect time      : p50 ${pct(m.connectMs, 0.5)}ms  p95 ${pct(m.connectMs, 0.95)}ms  slowest ${m.connectMs.length ? Math.max(...m.connectMs) : 0}ms`);
  console.log(`Join answer time  : p50 ${pct(m.joinMs, 0.5)}ms  p95 ${pct(m.joinMs, 0.95)}ms  slowest ${m.joinMs.length ? Math.max(...m.joinMs) : 0}ms`);
  console.log(`Ping (round trip) : p50 ${p50}ms  p95 ${p95}ms  p99 ${p99}ms  max ${max}ms   (timeouts: ${m.timeouts})`);
  console.log(`Disconnects       : ${m.disconnects}   reconnects: ${m.reconnects}`);
  console.log(`Phases seen       : ${Object.entries(m.phases).map(([k, v]) => k + ' x' + v).join(', ') || 'none'}   (a finished round shows "finished" about ${N} times)`);
  console.log(`Round             : ${m.roundStarted ? 'ran, ' + m.results + '/' + N + ' players received final results, ' + m.packets + ' progress packets sent' : 'DID NOT RUN (start one from /admin or pass --pass)'}`);
  if (PASS) console.log(`Server's own view : worst stall ${maxHealth.loopMax}ms, worst p99 delay ${maxHealth.loopP99}ms, peak CPU ${maxHealth.cpu}% of one core`);

  const problems = [];
  if (m.connected < N) problems.push(`only ${m.connected}/${N} connected`);
  if (m.joinFail) problems.push(`${m.joinFail} joins failed`);
  if (m.disconnects) problems.push(`${m.disconnects} players got disconnected`);
  if (m.timeouts) problems.push(`${m.timeouts} pings timed out`);
  const c95 = pct(m.connectMs, 0.95);
  if (c95 > 8000) problems.push(`joining took up to ${Math.round(c95 / 1000)}s for some players (very slow)`);
  else if (c95 > 3000) problems.push(`joining took ${Math.round(c95 / 1000)}s for slower players (sluggish)`);
  if (p95 > 800) problems.push(`p95 ping ${p95}ms is very slow`);
  else if (p95 > 300) problems.push(`p95 ping ${p95}ms is sluggish`);
  if (m.roundStarted && m.results < N * 0.98) problems.push(`only ${m.results}/${N} got final results`);
  if (PASS && maxHealth.loopMax > 1000) problems.push(`server froze for ${maxHealth.loopMax}ms`);

  const bad = c95 > 8000 || m.disconnects || m.timeouts || p95 > 800 || m.connected < N || m.joinFail || (m.roundStarted && m.results < N * 0.98) || (PASS && maxHealth.loopMax > 1000);
  console.log('\nVERDICT: ' + (problems.length ? (bad ? 'LAGGING / FAILING - ' : 'BORDERLINE - ') + problems.join('; ') : 'SMOOTH - no drops, no timeouts, fast replies'));
  if (!problems.length) console.log('Note: this simulates the network side only. Slow phones or bad WiFi are not visible here; open the player page with ?debug to see a real device\'s ping.');
  process.exit(problems.length ? 1 : 0);
}
process.on('SIGINT', finish);
