const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'innovista'; // change this: set ADMIN_PASS=yourpassword
const COUNTDOWN_MS = 5000; // 5-4-3-2-1 before the race
const GRACE_MS = 1200; // wait for last progress packets after time is up
const MAX_CPS = 20; // anti-cheat: more than 20 chars/sec (~240 WPM) is rejected

const DEFAULT_TEXT =
  'Every great project begins with a small idea and a stubborn habit of trying again. ' +
  'Code that works on the first run is rare, so we learn to read errors, test our assumptions, and fix one thing at a time. ' +
  'Teamwork matters as much as talent, because a clear message to a teammate can save hours of confusion. ' +
  'At a tech fest, curiosity is the real prize, and every stall, demo, and contest is a chance to learn something new. ' +
  'Keep your hands relaxed, your eyes on the screen, and your mind on the next word. ' +
  'Speed comes from rhythm, accuracy comes from calm, and champions are built by practice that nobody sees. ' +
  'When the timer starts, forget the crowd, trust your fingers, and type like the cursor is racing you.';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/screen', (_, res) => res.sendFile(path.join(__dirname, 'public', 'projector.html')));

function urls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) out.push(`http://${i.address}:${PORT}`);
    }
  }
  return out;
}
app.get('/api/info', (_, res) => res.json({ urls: urls() }));

// ---------- game state ----------
const makeCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let c = ''; for (let i = 0; i < 5; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return c;
};
const game = { phase: 'lobby', text: DEFAULT_TEXT, duration: 60, round: 1, startAt: 0, endAt: 0, code: makeCode() };
const players = new Map(); // pid -> player
const history = []; // rows of every finished round (for CSV)
let lastResults = null;
let timers = [];

const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const activePlayers = () => [...players.values()].filter((p) => p.active);

function cleanText(t) {
  return String(t || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function stats(p) {
  const t = game.text;
  const n = Math.min(p.typed.length, t.length);
  let correct = 0;
  for (let i = 0; i < n; i++) if (p.typed[i] === t[i]) correct++;
  const end = Math.min(p.finishedAt || Date.now(), game.endAt);
  const secs = Math.max((end - game.startAt) / 1000, 5);
  const wpm = Math.round(((correct / 5) / (secs / 60)) * 10) / 10; // net WPM
  const acc = p.keys ? Math.max(0, Math.round(((p.keys - p.mistakes) / p.keys) * 1000) / 10) : 0;
  return { correct, wpm, acc, progress: correct / t.length, finishedAt: p.finishedAt || 0 };
}

// Winner rule: higher WPM, then higher accuracy, then earlier finish
function ranking() {
  return activePlayers()
    .map((p) => ({ p, s: stats(p) }))
    .sort((a, b) =>
      b.s.wpm - a.s.wpm ||
      b.s.acc - a.s.acc ||
      (a.s.finishedAt || 1e15) - (b.s.finishedAt || 1e15));
}

const toRow = (r, i) => ({
  rank: i + 1, name: r.p.name, roll: r.p.roll, wpm: r.s.wpm, acc: r.s.acc,
  correct: r.s.correct, progress: r.s.progress, done: !!r.s.finishedAt,
  blurs: r.p.blurs || 0, flags: r.p.flags || 0,
});

function stateFor() {
  const s = {
    phase: game.phase, round: game.round, duration: game.duration,
    startAt: game.startAt, endAt: game.endAt, serverNow: Date.now(), count: activePlayers().length,
  };
  // the paragraph is only sent once the countdown starts, so nobody can peek early
  if (game.phase === 'countdown' || game.phase === 'running') s.text = game.text;
  return s;
}
const pushState = () => io.emit('state', stateFor());

function startGame() {
  if (game.phase !== 'lobby') return 'A round is already in progress';
  const act = activePlayers();
  if (!act.length) return 'No players have joined yet';
  for (const p of act) { p.typed = ''; p.keys = 0; p.mistakes = 0; p.finishedAt = 0; p.blurs = 0; p.flags = 0; p.lastAt = 0; p.lastLen = 0; }
  game.phase = 'countdown';
  game.startAt = Date.now() + COUNTDOWN_MS;
  game.endAt = game.startAt + game.duration * 1000;
  lastResults = null;
  clearTimers();
  pushState();
  timers.push(setTimeout(() => { if (game.phase === 'countdown') { game.phase = 'running'; pushState(); } }, COUNTDOWN_MS));
  timers.push(setTimeout(finishGame, COUNTDOWN_MS + game.duration * 1000 + GRACE_MS));
  return null;
}

function finishGame() {
  if (game.phase !== 'running' && game.phase !== 'countdown') return;
  clearTimers();
  game.phase = 'finished';
  const rk = ranking();
  const rows = rk.map(toRow);
  rows.forEach((r) => history.push({ ...r, round: game.round }));
  const winner = rows[0] || null;
  const top = rows.slice(0, 10);
  const byPid = new Map(rk.map((r, i) => [r.p.pid, rows[i]]));
  lastResults = { winner, top, rows, total: rows.length, byPid };
  pushState();
  rk.forEach((r, i) => { if (r.p.sid) io.to(r.p.sid).emit('results', { winner, top, me: rows[i], total: rows.length }); });
  io.to('admin').emit('adminResults', { rows, round: game.round });
  io.to('screen').emit('results', { winner, top, total: rows.length });
}

// keepTop > 0: only the best N players stay in for the next round (heats -> final)
function resetLobby(keepTop, advance) {
  clearTimers();
  if (keepTop > 0 && game.phase === 'finished') {
    const keep = new Set(ranking().slice(0, keepTop).map((r) => r.p.pid));
    for (const p of players.values()) if (!keep.has(p.pid)) p.active = false;
  }
  for (const p of players.values()) {
    p.typed = ''; p.keys = 0; p.mistakes = 0; p.finishedAt = 0;
    if (p.sid) io.to(p.sid).emit('status', { active: p.active });
  }
  if (advance) game.round++;
  game.phase = 'lobby';
  lastResults = null;
  pushState();
}

// live leaderboard + personal rank, 2 times per second-ish
setInterval(() => {
  if (game.phase !== 'running') return;
  const rk = ranking();
  const rows = rk.map(toRow);
  io.emit('board', { count: rows.length, done: rows.filter((r) => r.done).length, top: rows.slice(0, 10) });
  rk.forEach((r, i) => { if (r.p.sid) io.to(r.p.sid).emit('me', { ...rows[i], total: rows.length }); });
  if (rows.length && rows.every((r) => r.done)) finishGame();
}, 700);

// ---------- sockets ----------
io.on('connection', (socket) => {
  const isAdmin = () => !!socket.data.admin;
  const deny = (cb) => typeof cb === 'function' && cb({ ok: false, error: 'Not logged in as admin' });

  socket.on('join', (d, cb) => {
    if (typeof cb !== 'function') return;
    d = d || {};
    const name = String(d.name || '').trim().slice(0, 24);
    const roll = String(d.roll || '').trim().slice(0, 20);
    if (!name) return cb({ ok: false, error: 'Please enter your name' });
    const pid = String(d.pid || '').slice(0, 40) || Math.random().toString(36).slice(2);
    let p = players.get(pid);
    if (!p) {
      // new players must enter the join code the admin shares; returning players (refresh/reconnect) skip it
      if (String(d.code || '').trim().toUpperCase() !== game.code) return cb({ ok: false, error: 'Wrong join code. Ask the host for the current code.' });
      if (game.phase !== 'lobby') return cb({ ok: false, error: 'A round is already running. Wait for the next round.' });
      p = { pid, name, roll, sid: null, active: true, typed: '', keys: 0, mistakes: 0, finishedAt: 0, blurs: 0, flags: 0, lastAt: 0, lastLen: 0 };
      players.set(pid, p);
    } else { p.name = name; p.roll = roll; }
    p.sid = socket.id;
    socket.data.pid = pid;
    const inRound = game.phase === 'countdown' || game.phase === 'running';
    cb({
      ok: true, pid, eliminated: !p.active,
      resume: inRound && p.active ? { typed: p.typed, keys: p.keys, mistakes: p.mistakes } : null,
    });
    socket.emit('status', { active: p.active });
    pushState();
    if (game.phase === 'finished' && lastResults && p.active && lastResults.byPid.has(pid)) {
      socket.emit('results', { winner: lastResults.winner, top: lastResults.top, me: lastResults.byPid.get(pid), total: lastResults.total });
    }
  });

  socket.on('progress', (d) => {
    const p = players.get(socket.data.pid);
    if (!p || !p.active || p.finishedAt || game.phase !== 'running' || !d) return;
    const now = Date.now();
    if (now < game.startAt || now > game.endAt + GRACE_MS) return;
    const typed = String(d.typed || '').slice(0, game.text.length);
    const elapsed = (now - game.startAt) / 1000;
    if (typed.length > elapsed * MAX_CPS + 10) { p.flags++; return; } // impossible speed -> ignore + flag
    // a big jump since the previous packet means pasted / injected text -> ignore + flag
    const dt = (now - (p.lastAt || game.startAt)) / 1000;
    if (typed.length > (p.lastLen || 0) + dt * MAX_CPS + 8) { p.flags++; return; }
    p.lastAt = now; p.lastLen = typed.length;
    p.typed = typed;
    p.keys = Math.max(0, Math.min(parseInt(d.keys, 10) || 0, 10000));
    p.mistakes = Math.max(0, Math.min(parseInt(d.mistakes, 10) || 0, p.keys));
    if (typed.length >= game.text.length) p.finishedAt = now;
  });

  socket.on('away', () => { // player left the page / switched tab during a round
    const p = players.get(socket.data.pid);
    if (p && p.active && (game.phase === 'running' || game.phase === 'countdown')) p.blurs++;
  });

  socket.on('watch', () => { // projector screen
    socket.join('screen');
    socket.emit('code', game.code);
    socket.emit('state', stateFor());
    if (game.phase === 'finished' && lastResults) {
      socket.emit('results', { winner: lastResults.winner, top: lastResults.top, total: lastResults.total });
    }
  });

  // ----- admin -----
  socket.on('admin:login', (pass, cb) => {
    if (typeof cb !== 'function') return;
    if (pass !== ADMIN_PASS) return cb({ ok: false, error: 'Wrong password' });
    socket.data.admin = true;
    socket.join('admin');
    cb({ ok: true, text: game.text, duration: game.duration, urls: urls(), code: game.code });
    socket.emit('state', stateFor());
    if (game.phase === 'finished' && lastResults) socket.emit('adminResults', { rows: lastResults.rows, round: game.round });
  });

  socket.on('admin:newcode', (cb) => {
    if (!isAdmin()) return deny(cb);
    game.code = makeCode();
    io.to('admin').emit('adminCode', game.code);
    io.to('screen').emit('code', game.code);
    cb({ ok: true, code: game.code });
  });

  socket.on('admin:setup', (d, cb) => {
    if (!isAdmin()) return deny(cb);
    if (game.phase !== 'lobby') return cb({ ok: false, error: 'Settings can only be changed in the lobby' });
    const text = cleanText(d && d.text);
    const dur = Math.round(Number(d && d.duration));
    if (text.length < 30) return cb({ ok: false, error: 'Paragraph is too short' });
    if (!(dur >= 15 && dur <= 7200)) return cb({ ok: false, error: 'Duration must be 15 to 7200 seconds (up to 2 hours)' });
    game.text = text; game.duration = dur;
    cb({ ok: true, text, duration: dur });
  });

  socket.on('admin:start', (cb) => {
    if (!isAdmin()) return deny(cb);
    const err = startGame();
    cb(err ? { ok: false, error: err } : { ok: true });
  });

  socket.on('admin:abort', (cb) => {
    if (!isAdmin()) return deny(cb);
    resetLobby(0, false);
    cb({ ok: true });
  });

  socket.on('admin:next', (d, cb) => {
    if (!isAdmin()) return deny(cb);
    const keepTop = Math.max(0, parseInt(d && d.keepTop, 10) || 0);
    resetLobby(keepTop, game.phase === 'finished');
    cb({ ok: true });
  });

  socket.on('admin:clear', (cb) => {
    if (!isAdmin()) return deny(cb);
    players.clear();
    game.round = 1;
    resetLobby(0, false);
    io.emit('kicked');
    cb({ ok: true });
  });
});

app.get('/results.csv', (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).send('Forbidden');
  const esc = (v) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = history.map((r) =>
    [r.round, r.rank, esc(r.name), esc(r.roll), r.wpm, r.acc, r.correct, r.done ? 'yes' : 'no', r.blurs, r.flags].join(','));
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="results.csv"' });
  res.send(['round,rank,name,roll,net_wpm,accuracy_pct,correct_chars,finished_paragraph,tab_switches,flagged_packets', ...lines].join('\n'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nInnovista TypeSprint is running\n');
  console.log('  Players  : http://localhost:' + PORT);
  console.log('  Admin    : http://localhost:' + PORT + '/admin   (password: ' + ADMIN_PASS + ')');
  console.log('  Big screen: http://localhost:' + PORT + '/screen');
  console.log('  Join code : ' + game.code + '   (also shown in the admin page and on the big screen)');
  const u = urls();
  if (u.length) console.log('\nShare this with participants (same WiFi/LAN):\n  ' + u.join('\n  '));
  console.log('');
});
