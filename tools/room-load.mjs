// Multi room load check (docs/02 §11): N WebSocket bots in one room, each walking and sending poses at the client
// rate (TUNING.multi.poseHz), measuring how long a pose takes to reach the others (p50/p95/max), room round trip,
// frames, disconnects and errors, and that the (capacity + 1)th bot is refused with {"t":"full"}.
//
//   LCW_OPERATOR_TOKEN=… node tools/room-load.mjs http://127.0.0.1:8900 smoke-load 1,2,4,8,16,32 20
//   LCW_TOKEN_FILE=<path> node tools/room-load.mjs https://lcw.worldwidesomething.com smoke-load 1,2,4,8 20
//
// Only smoke- rooms are used; the room keeps nothing on disk, so closing the sockets is the clean-up.
// Capacity above the server cap is measured on a local `wrangler dev --var LCW_ROOM_CAPACITY:64` (room.ts).
// Prints one JSON line per N and a summary table. Exit 1 when any N below the cap lost a socket or saw an error.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const base = (process.argv[2] ?? 'http://127.0.0.1:8900').replace(/\/$/, '');
const roomBase = process.argv[3] ?? 'smoke-load';
const counts = (process.argv[4] ?? '1,2,4,8').split(',').map(Number);
const seconds = Number(process.argv[5] ?? 20);
const token = process.env.LCW_OPERATOR_TOKEN ?? (process.env.LCW_TOKEN_FILE ? readFileSync(process.env.LCW_TOKEN_FILE, 'utf8').trim() : '');
if (!token) throw new Error('set LCW_OPERATOR_TOKEN or LCW_TOKEN_FILE');
if (!roomBase.startsWith('smoke-')) throw new Error('load checks use smoke- rooms only');
const POSE_HZ = Number(process.env.BOT_HZ ?? 5); // TUNING.multi.poseHz (a walking client); BOT_HZ=10 for a stress run
const wsBase = base.replace(/^http/, 'ws');
const op = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

function pct(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
}

/** CPU seconds of the local workerd processes (wrangler dev), null when not local or not found. */
function workerdCpu() {
  if (!/127\.0\.0\.1|localhost/.test(base) || process.platform !== 'win32') return null;
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-Process workerd -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum"', { encoding: 'utf8', timeout: 30000 });
    const v = Number(out.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function ticket(room, i) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${base}/v1/room/ticket`, { method: 'POST', headers: op, body: JSON.stringify({ room, name: `bot-${i}`, key: `bot-${i}` }) });
      if (!r.ok) throw new Error(`ticket ${r.status} ${await r.text()}`);
      const j = await r.json();
      // a wrong operator token now answers 200 {room:null} (room.ts), not 401
      if (!j.ticket) throw new Error(`no ticket: ${JSON.stringify(j)} (operator token?)`);
      return j.ticket;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
}

/** Tickets 8 at a time (a local wrangler dev proxy resets 64 parallel posts). */
async function tickets(room, n) {
  const out = [];
  for (let i = 0; i < n; i += 8) out.push(...(await Promise.all(Array.from({ length: Math.min(8, n - i) }, (_, k) => ticket(room, i + k)))));
  return out;
}

async function stats(room) {
  const r = await fetch(`${base}/v1/admin/rooms/${room}`, { headers: op });
  return r.ok ? r.json() : { error: r.status };
}

function openBot(room, i, t, shared) {
  return new Promise((resolve) => {
    const bot = { i, id: null, ws: null, sent: new Map(), seq: 0, framesIn: 0, bytesIn: 0, closed: null, errors: 0, full: false, rtt: [] };
    const ws = new WebSocket(`${wsBase}/v1/room/connect?t=${t}`);
    bot.ws = ws;
    const timer = setTimeout(() => resolve(bot), 10000);
    ws.onmessage = (ev) => {
      const now = performance.now();
      bot.framesIn++;
      bot.bytesIn += ev.data.length;
      if (ev.data === 'pong') return;
      const f = JSON.parse(ev.data);
      if (f.t === 'hello') {
        bot.id = f.you;
        shared.byId.set(f.you, bot);
        clearTimeout(timer);
        resolve(bot);
      } else if (f.t === 'full') {
        bot.full = true;
        clearTimeout(timer);
        resolve(bot);
      } else if (f.t === 'poses') {
        for (const [id, , , , , , seq] of f.p) {
          if (id === bot.id) continue;
          const from = shared.byId.get(id);
          const at = from?.sent.get(seq);
          if (at !== undefined) shared.lat.push(now - at);
        }
      } else if (f.t === 'pong') {
        bot.rtt.push(now - f.c);
      }
    };
    ws.onerror = () => {
      bot.errors++;
    };
    ws.onclose = (ev) => {
      bot.closed = { code: ev.code, reason: ev.reason, at: performance.now() };
      clearTimeout(timer);
      resolve(bot);
    };
  });
}

async function runN(n) {
  const room = `${roomBase}-${n}-${Date.now().toString(36)}`;
  const shared = { byId: new Map(), lat: [] };
  const list = await tickets(room, n);
  const t0 = performance.now();
  const bots = await Promise.all(list.map((t, i) => openBot(room, i, t, shared)));
  const joinMs = Math.round(performance.now() - t0);
  const inRoom = bots.filter((b) => b.id);
  const refused = bots.filter((b) => b.full).length;
  const cpu0 = workerdCpu();
  const s0 = await stats(room);
  const start = performance.now();
  const loops = inRoom.map((b, k) => {
    let step = 0;
    const iv = setInterval(() => {
      if (b.ws.readyState !== 1) return;
      step++;
      const a = (step / 20) + k;
      b.seq++;
      b.sent.set(b.seq, performance.now());
      if (b.sent.size > 200) b.sent.delete(b.seq - 200);
      b.ws.send(JSON.stringify({ t: 'p', p: [Math.round(Math.cos(a) * 1000) / 100, 2, Math.round(Math.sin(a) * 1000) / 100, Math.round(a * 1000) / 1000, 1, b.seq] }));
      if (step % POSE_HZ === 0) b.ws.send(JSON.stringify({ t: 'ping', c: performance.now() }));
    }, 1000 / POSE_HZ);
    return iv;
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  loops.forEach(clearInterval);
  await new Promise((r) => setTimeout(r, 400));
  const elapsed = (performance.now() - start) / 1000;
  const s1 = await stats(room);
  const cpu1 = workerdCpu();
  const lost = inRoom.filter((b) => b.closed).length;
  const errors = bots.reduce((a, b) => a + b.errors, 0);
  // over the cap: one more must be refused
  let overflow = null;
  if (s1.cap && n === s1.cap) {
    const extra = await openBot(room, n, await ticket(room, n), shared);
    overflow = extra.full ? 'full' : extra.id ? 'admitted' : `other:${extra.closed?.code}`;
  }
  for (const b of bots) {
    try {
      b.ws.close(1000);
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 300));
  const rtt = inRoom.flatMap((b) => b.rtt);
  const msgsIn = (s1.msgsIn ?? 0) - (s0.msgsIn ?? 0);
  const framesOut = (s1.framesOut ?? 0) - (s0.framesOut ?? 0);
  const res = {
    n,
    admitted: inRoom.length,
    refused,
    overflow,
    join_ms: joinMs,
    seconds: Math.round(elapsed * 10) / 10,
    lat_p50: pct(shared.lat, 50),
    lat_p95: pct(shared.lat, 95),
    lat_max: pct(shared.lat, 100),
    rtt_p50: pct(rtt, 50),
    rtt_p95: pct(rtt, 95),
    room_msgs_in_per_s: Math.round(msgsIn / elapsed),
    room_frames_out_per_s: Math.round(framesOut / elapsed),
    bot_frames_in_per_s: Math.round(inRoom.reduce((a, b) => a + b.framesIn, 0) / elapsed),
    bytes_out_per_s: Math.round(((s1.bytesOut ?? 0) - (s0.bytesOut ?? 0)) / elapsed),
    cpu_ms_per_s: cpu0 !== null && cpu1 !== null ? Math.round(((cpu1 - cpu0) * 1000) / elapsed) : null,
    cpu_us_per_msg: cpu0 !== null && cpu1 !== null && msgsIn > 0 ? Math.round(((cpu1 - cpu0) * 1e6) / msgsIn) : null,
    lost,
    errors,
    room_dropped: (s1.dropped ?? 0) - (s0.dropped ?? 0),
    room_closed_rate: (s1.closedRate ?? 0) - (s0.closedRate ?? 0)
  };
  console.log(JSON.stringify(res));
  return res;
}

const rows = [];
for (const n of counts) rows.push(await runN(n));
console.log('\n| N | admitted | refused | over cap | p50 ms | p95 ms | max ms | rtt p95 | msgs in/s | frames out/s | CPU ms/s | µs/msg | lost | errors |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows)
  console.log(
    `| ${r.n} | ${r.admitted} | ${r.refused} | ${r.overflow ?? '-'} | ${r.lat_p50} | ${r.lat_p95} | ${r.lat_max} | ${r.rtt_p95} | ${r.room_msgs_in_per_s} | ${r.room_frames_out_per_s} | ${r.cpu_ms_per_s ?? '-'} | ${r.cpu_us_per_msg ?? '-'} | ${r.lost} | ${r.errors} |`
  );
const bad = rows.some((r) => r.n <= (r.admitted || 0) && (r.lost > 0 || r.errors > 0));
process.exit(bad ? 1 : 0);
