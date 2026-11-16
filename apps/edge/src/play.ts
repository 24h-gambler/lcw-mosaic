/**
 * Play modes on the server (docs/01 6장 경영자; docs/03 D2 채굴·환전, D3 장부, D4 커리어; docs/04 4.2). Everything worth
 * something — ores, coins, a job, a day's pay — is decided here from server state and the stars the converse
 * scorer granted (AGENTS 4.7). The client shows `PlayState` and sends sentences, swings and heartbeats.
 *
 * State lives next to the errand (platform db); coins and items live in the child's WorldDO (ledger, items).
 *   play_clock  — the child's own play time in that world (docs/03 D4 "소유자가 접속해 있을 때만")
 *   play_job    — rank, promotion counters, the interview in progress, today's shift
 *   play_mine   — when each vein was last taken (on play time)
 *   play_market — the world's price index per ore (docs/03 D2 평균 회귀, docs/09 P7 월드별)
 *   play_sales  — one exchange sale per dialog (a better retry tops up the difference, never pays twice)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  CUSTOMER_SCENARIOS,
  EXCHANGE_ORES,
  INTERVIEW_TURNS,
  NEGOTIATION,
  type InterviewTurn
} from '@lcw/content';
import {
  TUNING,
  clockIn,
  clockOf,
  customerScenarioIndex,
  exchangePayout,
  heartbeatAddMs,
  hhmm,
  interviewOutcome,
  marketAfterSale,
  marketRecovered,
  mineCheck,
  mineVeins,
  newJob,
  officeHours,
  oreMarketPrice,
  promoteIfReady,
  promotionProgress,
  serveCustomer,
  shiftPay,
  toolTierOf,
  veinById,
  type JobRank,
  type JobState,
  type OfficeHours,
  type ShiftState,
  type Stars
} from '@lcw/sim-core';
import type { EdgePlatformDb, WorldDO } from './storage.js';

/** Converse contexts the play module answers (docs/04 4.2). Any other context never reaches this file. */
export const PLAY_CTXS: ReadonlySet<string> = new Set(['exchange', 'interview', 'boss', 'customer']);

export function ensurePlaySchema(db: EdgePlatformDb): void {
  db.sql.exec(`
create table if not exists play_clock (player_id text not null, world_id text not null, play_ms integer not null default 0, last_beat_at integer, last_swing_at integer, primary key (player_id, world_id));
create table if not exists play_job (player_id text not null, world_id text not null, rank text, days_worked integer not null default 0, three_star_customers integer not null default 0, on_time_streak integer not null default 0, negotiations integer not null default 0, promo_points integer not null default 0, interview_stars text not null default '[]', shift text, hired_at integer, updated_at integer not null, primary key (player_id, world_id));
create table if not exists play_mine (player_id text not null, world_id text not null, vein_id text not null, last_play_ms integer not null, primary key (player_id, world_id, vein_id));
create table if not exists play_market (world_id text not null, ore text not null, idx real not null, updated_at integer not null, primary key (world_id, ore));
create table if not exists play_sales (dialog_id text not null, player_id text not null, world_id text not null, ore text not null, units integer not null, idx real not null, stars integer not null, coins integer not null, at integer not null, primary key (dialog_id, ore));
`);
}

/* ------------------------------------------------------------------ clock */

function clockRow(db: EdgePlatformDb, playerId: string, worldId: string): { play_ms: number; last_beat_at: number | null; last_swing_at: number | null } {
  ensurePlaySchema(db);
  db.sql.run('insert or ignore into play_clock (player_id, world_id, play_ms) values (?, ?, 0)', [playerId, worldId]);
  const r = db.sql.get<{ play_ms: number; last_beat_at: number | null; last_swing_at: number | null }>(
    'select play_ms, last_beat_at, last_swing_at from play_clock where player_id = ? and world_id = ?',
    [playerId, worldId]
  )!;
  return { play_ms: Number(r.play_ms), last_beat_at: r.last_beat_at === null ? null : Number(r.last_beat_at), last_swing_at: r.last_swing_at === null ? null : Number(r.last_swing_at) };
}

/** One heartbeat from the open world: adds the capped gap to the child's play time (nothing after a long gap). */
export function beat(db: EdgePlatformDb, playerId: string, worldId: string, nowMs: number): number {
  const r = clockRow(db, playerId, worldId);
  const add = heartbeatAddMs(r.last_beat_at, nowMs);
  db.sql.run('update play_clock set play_ms = play_ms + ?, last_beat_at = ? where player_id = ? and world_id = ?', [add, nowMs, playerId, worldId]);
  return r.play_ms + add;
}

/* ------------------------------------------------------------------ job */

type JobRow = JobState & { interviewStars: Stars[]; shift: ShiftState | null };

function jobOf(db: EdgePlatformDb, playerId: string, worldId: string): JobRow {
  ensurePlaySchema(db);
  const r = db.sql.get<Record<string, unknown>>('select * from play_job where player_id = ? and world_id = ?', [playerId, worldId]);
  if (!r) return { ...newJob(), interviewStars: [], shift: null };
  return {
    rank: (r.rank as JobRank | null) ?? null,
    daysWorked: Number(r.days_worked),
    threeStarCustomers: Number(r.three_star_customers),
    onTimeStreak: Number(r.on_time_streak),
    negotiations: Number(r.negotiations),
    promoPoints: Number(r.promo_points),
    interviewStars: JSON.parse(String(r.interview_stars ?? '[]')) as Stars[],
    shift: r.shift ? (JSON.parse(String(r.shift)) as ShiftState) : null
  };
}

function saveJob(db: EdgePlatformDb, playerId: string, worldId: string, j: JobRow, nowMs: number, hired = false): void {
  db.sql.run(
    `insert into play_job (player_id, world_id, rank, days_worked, three_star_customers, on_time_streak, negotiations, promo_points, interview_stars, shift, hired_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(player_id, world_id) do update set rank = excluded.rank, days_worked = excluded.days_worked,
       three_star_customers = excluded.three_star_customers, on_time_streak = excluded.on_time_streak,
       negotiations = excluded.negotiations, promo_points = excluded.promo_points, interview_stars = excluded.interview_stars,
       shift = excluded.shift, hired_at = coalesce(play_job.hired_at, excluded.hired_at), updated_at = excluded.updated_at`,
    [playerId, worldId, j.rank, j.daysWorked, j.threeStarCustomers, j.onTimeStreak, j.negotiations, j.promoPoints, JSON.stringify(j.interviewStars), j.shift ? JSON.stringify(j.shift) : null, hired ? nowMs : null, nowMs]
  );
}

/* ------------------------------------------------------------------ items (WorldDO) */

interface ItemRow {
  id: string;
  spec: string;
  location: string;
}

function itemKeyOf(spec: string): { kind: string; item: string } | null {
  try {
    const s = JSON.parse(spec) as { kind?: unknown; item?: unknown };
    return typeof s.item === 'string' ? { kind: typeof s.kind === 'string' ? s.kind : '', item: s.item } : null;
  } catch {
    return null;
  }
}

/** What the child carries or wears: everything not sold, given away or traded. */
function ownedKeys(world: WorldDO | undefined, playerId: string): string[] {
  if (!world) return [];
  return world
    .listPlayerItems(playerId)
    .filter((r) => r.location !== 'sold' && r.location !== 'given' && r.location !== 'traded')
    .map((r) => itemKeyOf(r.spec)?.item)
    .filter((k): k is string => typeof k === 'string');
}

function oresInBag(world: WorldDO | undefined, playerId: string): Map<string, ItemRow[]> {
  const out = new Map<string, ItemRow[]>();
  if (!world) return out;
  for (const r of world.listPlayerItems(playerId)) {
    if (r.location !== 'bag') continue;
    const k = itemKeyOf(r.spec);
    if (!k || k.kind !== 'ore') continue;
    const list = out.get(k.item) ?? [];
    list.push(r);
    out.set(k.item, list);
  }
  return out;
}

/* ------------------------------------------------------------------ market */

function marketIndex(db: EdgePlatformDb, worldId: string, ore: string, nowMs: number): number {
  ensurePlaySchema(db);
  const r = db.sql.get<{ idx: number; updated_at: number }>('select idx, updated_at from play_market where world_id = ? and ore = ?', [worldId, ore]);
  return r ? marketRecovered(Number(r.idx), nowMs - Number(r.updated_at)) : 1;
}

function setMarketIndex(db: EdgePlatformDb, worldId: string, ore: string, idx: number, nowMs: number): void {
  db.sql.run(
    'insert into play_market (world_id, ore, idx, updated_at) values (?, ?, ?, ?) on conflict(world_id, ore) do update set idx = excluded.idx, updated_at = excluded.updated_at',
    [worldId, ore, idx, nowMs]
  );
}

function exchangeTotal(world: WorldDO | undefined, playerId: string): number {
  if (!world) return 0;
  const r = world.sql.get<{ s: number }>("select coalesce(sum(delta), 0) as s from ledger where player = ? and reason like 'play:exchange:%'", [playerId]);
  return Number(r?.s ?? 0);
}

/* ------------------------------------------------------------------ state for the client */

export interface PlayState {
  clock: { day: number; minute: number; hhmm: string; hours: OfficeHours };
  job: {
    rank: JobRank | null;
    progress: { have: number; need: number; next: JobRank | null };
    has_suit: boolean;
    interview_turn: InterviewTurn | null;
    pay: number | null;
  };
  shift: { day: number; late: boolean; served: number; need: number; tips: number; paid: boolean } | null;
  /** The sentence set the office expects next (the client opens the dialog on it). */
  next: { ctx: 'interview' | 'boss' | 'customer'; key: string } | null;
  ores: Record<string, number>;
  market: Record<string, number>;
  tool_tier: number;
  /** Veins still growing back: id -> ms of play time left. */
  resting: Record<string, number>;
  exchange_total: number;
  coins: number | null;
}

function expectedNext(job: JobRow, clock: { day: number; minute: number }): PlayState['next'] {
  const hours = officeHours(clock.minute);
  if (!job.rank) return { ctx: 'interview', key: INTERVIEW_TURNS[Math.min(job.interviewStars.length, INTERVIEW_TURNS.length - 1)]! };
  if (hours === 'before_open' || hours === 'closed') return null;
  const shift = job.shift && job.shift.day === clock.day ? job.shift : null;
  if (!shift) return { ctx: 'boss', key: hours === 'late' ? 'boss_late' : 'boss_report' };
  if (shift.paid || shift.customersServed >= TUNING.play.shift.customersPerShift) return null;
  return { ctx: 'customer', key: customerKeyFor(job.rank, clock.day, shift.customersServed) };
}

/** The n-th customer of the day: a claim from the office.customer set; a director's second visitor negotiates. */
function customerKeyFor(rank: JobRank, day: number, n: number): string {
  if (rank === 'director' && n === TUNING.play.shift.customersPerShift - 1) return NEGOTIATION.key;
  return (CUSTOMER_SCENARIOS[customerScenarioIndex(day, n, CUSTOMER_SCENARIOS.length)] ?? CUSTOMER_SCENARIOS[0]).key;
}

export function playState(db: EdgePlatformDb, world: WorldDO | undefined, playerId: string, worldId: string, nowMs: number): PlayState {
  const c = clockRow(db, playerId, worldId);
  const clock = clockOf(c.play_ms);
  const job = jobOf(db, playerId, worldId);
  const owned = ownedKeys(world, playerId);
  const shift = job.shift && job.shift.day === clock.day ? job.shift : null;
  const ores: Record<string, number> = {};
  for (const [k, v] of oresInBag(world, playerId)) ores[k] = v.length;
  const market: Record<string, number> = {};
  for (const o of EXCHANGE_ORES) market[o.key] = oreMarketPrice(o.key, marketIndex(db, worldId, o.key, nowMs));
  const resting: Record<string, number> = {};
  const mined = db.sql.all<{ vein_id: string; last_play_ms: number }>('select vein_id, last_play_ms from play_mine where player_id = ? and world_id = ?', [playerId, worldId]);
  for (const m of mined) {
    const left = Number(m.last_play_ms) + TUNING.play.mine.veinRespawnPlayMs - c.play_ms;
    if (left > 0) resting[m.vein_id] = left;
  }
  return {
    clock: { ...clock, hhmm: hhmm(clock.minute), hours: officeHours(clock.minute) },
    job: {
      rank: job.rank,
      progress: promotionProgress(job),
      has_suit: owned.includes('suit'),
      interview_turn: job.rank ? null : INTERVIEW_TURNS[Math.min(job.interviewStars.length, INTERVIEW_TURNS.length - 1)]!,
      pay: job.rank ? TUNING.career.ranks[job.rank].dailyPay : null
    },
    shift: shift ? { day: shift.day, late: shift.late, served: shift.customersServed, need: TUNING.play.shift.customersPerShift, tips: shift.tips, paid: shift.paid } : null,
    next: expectedNext(job, clock),
    ores,
    market,
    tool_tier: toolTierOf(owned),
    resting,
    exchange_total: exchangeTotal(world, playerId),
    coins: world ? world.getPlayerBalance(playerId) : null
  };
}

/* ------------------------------------------------------------------ sentences (called by /v1/converse/score) */

export interface PlayStepResult {
  kind: 'interview' | 'shift' | 'customer' | 'exchange';
  /** Why the sentence moved nothing (the client says it kindly): wrong_turn, no_suit, before_open, closed, no_shift, done, no_ore. */
  blocked?: string;
  /** Coins this sentence earned (contract bonus, tip, day pay, exchange money). */
  coins?: number;
  hired?: JobRank;
  promoted?: JobRank;
  pay?: number;
  tip?: number;
  units?: number;
  ore?: string;
  late?: boolean;
  interview_turn?: InterviewTurn | null;
  served?: number;
}

export function applyPlayStep(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  s: { playerId: string; worldId: string; dialogId: string; ctx: string; pass: boolean; stars: number; askedKey?: string; nowMs: number }
): PlayStepResult | undefined {
  if (!PLAY_CTXS.has(s.ctx) || !s.pass || s.stars < 1 || !s.askedKey) return undefined;
  const stars = Math.min(3, s.stars) as Stars;
  const c = clockRow(db, s.playerId, s.worldId);
  const clock = clockOf(c.play_ms);
  const hours = officeHours(clock.minute);
  const job = jobOf(db, s.playerId, s.worldId);
  const pay = (delta: number, reason: string, ref: string): number => {
    if (!world || delta <= 0) return 0;
    const done = world.sql.get<{ n: number }>('select count(*) as n from ledger where player = ? and ref = ?', [s.playerId, ref]);
    if (Number(done?.n ?? 0) > 0) return 0;
    world.appendLedger(s.playerId, delta, reason, ref, s.nowMs);
    return delta;
  };

  if (s.ctx === 'exchange') return sellOre(db, world, s, stars);

  if (s.ctx === 'interview') {
    if (job.rank) return { kind: 'interview', blocked: 'done', hired: job.rank };
    if (!ownedKeys(world, s.playerId).includes('suit')) return { kind: 'interview', blocked: 'no_suit' };
    if (hours === 'before_open' || hours === 'closed') return { kind: 'interview', blocked: hours };
    const want = INTERVIEW_TURNS[job.interviewStars.length]!;
    if (s.askedKey !== want) return { kind: 'interview', blocked: 'wrong_turn', interview_turn: want };
    job.interviewStars = [...job.interviewStars, stars];
    if (job.interviewStars.length < INTERVIEW_TURNS.length) {
      saveJob(db, s.playerId, s.worldId, job, s.nowMs);
      return { kind: 'interview', interview_turn: INTERVIEW_TURNS[job.interviewStars.length]! };
    }
    const out = interviewOutcome(job.interviewStars);
    job.rank = out.rank;
    saveJob(db, s.playerId, s.worldId, job, s.nowMs, true);
    const coins = pay(out.contractBonus, 'play:contract', `play:contract:${s.worldId}`);
    return { kind: 'interview', hired: out.rank, coins, interview_turn: null };
  }

  if (!job.rank) return { kind: s.ctx === 'boss' ? 'shift' : 'customer', blocked: 'not_hired' };
  if (hours === 'before_open' || hours === 'closed') return { kind: s.ctx === 'boss' ? 'shift' : 'customer', blocked: hours };
  const today = job.shift && job.shift.day === clock.day ? job.shift : null;

  if (s.ctx === 'boss') {
    if (today) return { kind: 'shift', blocked: 'done', late: today.late };
    const want = hours === 'late' ? 'boss_late' : 'boss_report';
    if (s.askedKey !== want) return { kind: 'shift', blocked: 'wrong_turn' };
    const r = clockIn(clock.day, hours, stars);
    job.shift = r.shift;
    if (r.promoPoint) job.promoPoints += 1;
    saveJob(db, s.playerId, s.worldId, job, s.nowMs);
    return { kind: 'shift', late: r.shift.late };
  }

  // customer
  if (!today) return { kind: 'customer', blocked: 'no_shift' };
  if (today.paid || today.customersServed >= TUNING.play.shift.customersPerShift) return { kind: 'customer', blocked: 'done', served: today.customersServed };
  const want = customerKeyFor(job.rank, clock.day, today.customersServed);
  if (s.askedKey !== want) return { kind: 'customer', blocked: 'wrong_turn' };
  const served = serveCustomer(today, stars);
  let shift = served.shift;
  if (served.regular) job.threeStarCustomers += 1;
  if (want === NEGOTIATION.key && stars >= 2) job.negotiations += 1;
  const tip = pay(served.tip, 'play:tip', `play:tip:${s.worldId}:${clock.day}:${today.customersServed}`);
  let dayPay = 0;
  let promoted: JobRank | undefined;
  const wage = shiftPay(job.rank, shift);
  if (wage > 0) {
    dayPay = pay(wage, `play:pay:${job.rank}`, `play:pay:${s.worldId}:${clock.day}`);
    shift = { ...shift, paid: true };
    job.daysWorked += 1;
    job.onTimeStreak = shift.late ? 0 : job.onTimeStreak + 1;
    const p = promoteIfReady({ ...job });
    if (p.promotedTo) {
      Object.assign(job, p.job);
      promoted = p.promotedTo;
    }
  }
  job.shift = shift;
  saveJob(db, s.playerId, s.worldId, job, s.nowMs);
  return { kind: 'customer', tip, pay: dayPay || undefined, coins: tip + dayPay, promoted, served: shift.customersServed };
}

/** docs/04 4.2 환전소: sells every unit of that ore in the bag; a better retry in the same dialog pays the difference. */
function sellOre(
  db: EdgePlatformDb,
  world: WorldDO | undefined,
  s: { playerId: string; worldId: string; dialogId: string; askedKey?: string; nowMs: number },
  stars: Stars
): PlayStepResult {
  const ore = s.askedKey!;
  if (!world) return { kind: 'exchange', blocked: 'no_world', ore };
  const prior = db.sql.get<{ units: number; idx: number; stars: number; coins: number }>('select units, idx, stars, coins from play_sales where dialog_id = ? and ore = ?', [s.dialogId, ore]);
  if (prior) {
    if (stars <= Number(prior.stars)) return { kind: 'exchange', ore, units: Number(prior.units), coins: 0 };
    const better = exchangePayout(ore, Number(prior.units), Number(prior.idx), stars);
    const diff = better - Number(prior.coins);
    if (diff > 0) world.appendLedger(s.playerId, diff, `play:exchange:${ore}:${stars}:better_stars`, `play:sale:${s.dialogId}:${ore}:${stars}`, s.nowMs);
    db.sql.run('update play_sales set stars = ?, coins = ? where dialog_id = ? and ore = ?', [stars, better, s.dialogId, ore]);
    return { kind: 'exchange', ore, units: Number(prior.units), coins: Math.max(0, diff) };
  }
  const rows = oresInBag(world, s.playerId).get(ore) ?? [];
  if (rows.length === 0) return { kind: 'exchange', blocked: 'no_ore', ore, units: 0 };
  const idx = marketIndex(db, s.worldId, ore, s.nowMs);
  const coins = exchangePayout(ore, rows.length, idx, stars);
  for (const r of rows) world.sql.run("update items set location = 'sold' where id = ?", [r.id]);
  world.appendLedger(s.playerId, coins, `play:exchange:${ore}:${stars}`, `play:sale:${s.dialogId}:${ore}`, s.nowMs);
  setMarketIndex(db, s.worldId, ore, marketAfterSale(idx, rows.length), s.nowMs);
  db.sql.run('insert into play_sales (dialog_id, player_id, world_id, ore, units, idx, stars, coins, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    s.dialogId,
    s.playerId,
    s.worldId,
    ore,
    rows.length,
    idx,
    stars,
    coins,
    s.nowMs
  ]);
  return { kind: 'exchange', ore, units: rows.length, coins };
}

/* ------------------------------------------------------------------ mining */

export type MineResult =
  | { ok: true; ore: string; vein_id: string; count: number; coins_total: number | null }
  | { ok: false; reason: 'unknown_vein' | 'no_world' | 'tool' | 'resting' | 'too_fast'; wait_ms?: number; need_tier?: number };

/** One swing at a vein (docs/03 D2 채굴): server checks tool tier and regrowth on play time, then gives one ore. */
export function mine(db: EdgePlatformDb, world: WorldDO | undefined, p: { playerId: string; worldId: string; veinId: string; nowMs: number }): MineResult {
  const vein = veinById(p.veinId);
  if (!vein) return { ok: false, reason: 'unknown_vein' };
  if (!world) return { ok: false, reason: 'no_world' };
  const c = clockRow(db, p.playerId, p.worldId);
  const last = db.sql.get<{ last_play_ms: number }>('select last_play_ms from play_mine where player_id = ? and world_id = ? and vein_id = ?', [p.playerId, p.worldId, vein.id]);
  const check = mineCheck({
    ore: vein.ore,
    toolTier: toolTierOf(ownedKeys(world, p.playerId)),
    playMs: c.play_ms,
    lastMinedPlayMs: last ? Number(last.last_play_ms) : null,
    lastSwingAtMs: c.last_swing_at,
    nowMs: p.nowMs
  });
  if (!check.ok) {
    return { ok: false, reason: check.reason, wait_ms: check.waitMs, need_tier: check.reason === 'tool' ? TUNING.mining.ores[vein.ore]?.requiredToolTier : undefined };
  }
  db.sql.run('update play_clock set last_swing_at = ? where player_id = ? and world_id = ?', [p.nowMs, p.playerId, p.worldId]);
  db.sql.run(
    'insert into play_mine (player_id, world_id, vein_id, last_play_ms) values (?, ?, ?, ?) on conflict(player_id, world_id, vein_id) do update set last_play_ms = excluded.last_play_ms',
    [p.playerId, p.worldId, vein.id, c.play_ms]
  );
  world.grantOrSetItem(p.playerId, `ore-${vein.id}-${c.play_ms}-${p.nowMs}`, JSON.stringify({ kind: 'ore', item: vein.ore, vein: vein.id }), 'bag');
  const count = oresInBag(world, p.playerId).get(vein.ore)?.length ?? 1;
  return { ok: true, ore: vein.ore, vein_id: vein.id, count, coins_total: world.getPlayerBalance(p.playerId) };
}

/* ------------------------------------------------------------------ routes (inner app; the platform fills ids) */

const IdsQuery = z.object({ player_id: z.string().min(1), world_id: z.string().min(1) });
const MineBody = z.object({ player_id: z.string().min(1), world_id: z.string().min(1), vein_id: z.string().min(1).max(40) }).passthrough();

export function registerPlayRoutes(
  app: Hono,
  deps: { db: EdgePlatformDb; worlds: Map<string, WorldDO>; nowMs: () => number }
): void {
  app.get('/v1/play/state', (c) => {
    const q = IdsQuery.safeParse({ player_id: c.req.query('player_id'), world_id: c.req.query('world_id') });
    if (!q.success) return c.json({ error: 'invalid_play_request' }, 400);
    return c.json(playState(deps.db, deps.worlds.get(q.data.world_id), q.data.player_id, q.data.world_id, deps.nowMs()));
  });
  app.post('/v1/play/beat', async (c) => {
    const body = IdsQuery.passthrough().safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_play_request' }, 400);
    const now = deps.nowMs();
    beat(deps.db, body.data.player_id, body.data.world_id, now);
    return c.json(playState(deps.db, deps.worlds.get(body.data.world_id), body.data.player_id, body.data.world_id, now));
  });
  app.post('/v1/play/mine', async (c) => {
    const body = MineBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_mine_request' }, 400);
    const r = mine(deps.db, deps.worlds.get(body.data.world_id), {
      playerId: body.data.player_id,
      worldId: body.data.world_id,
      veinId: body.data.vein_id,
      nowMs: deps.nowMs()
    });
    return c.json(r, r.ok || r.reason !== 'unknown_vein' ? 200 : 400);
  });
}

/** Every vein id the server knows (the client draws the same list from sim-core). */
export function knownVeinIds(): string[] {
  return mineVeins().map((v) => v.id);
}
