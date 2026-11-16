import { Hono } from 'hono';
import { z } from 'zod';
import { FREE_TIER_LIMITS, QuotaMeter, type QuotaStatus, type QuotaStore } from '@lcw/quota';
import type { SqliteExecutor } from './storage.js';

/**
 * The quota meter and degrade ladder on the edge (docs/02 5장, docs/09 P9, WP-112).
 *
 * - The day's counters live in the platform Durable Object's SQLite (`quota_daily`), so an evicted or restarted
 *   object keeps counting the same day. One platform object serves every request, so this is the one counter.
 * - The daily limit and a provider outage are operator settings (`quota_settings`): limit 0 or an outage puts the
 *   service in bank-only mode, and every order still completes from the phrase bank (scoring never calls AI).
 * - Lessons that are running (or started within the last 2 hours) reserve their share: the meter keeps the last
 *   3,000 neurons for lesson rooms.
 * - The hourly cron records the stage; a day that reached 85% (stage 2+) is kept as an alert day (docs/09 escalation).
 */

export const QUOTA_SETTINGS_SCHEMA = 'create table if not exists quota_settings (k text primary key, v integer not null)';

export function ensureQuotaSchema(sql: SqliteExecutor): void {
  sql.exec('create table if not exists quota_daily (day text not null, k text not null, used integer not null, primary key (day, k))');
  sql.exec(QUOTA_SETTINGS_SCHEMA);
}

/** A QuotaStore over `quota_daily` for one UTC day. */
export function sqlQuotaStore(sql: SqliteExecutor, day: string): QuotaStore {
  return {
    get: (k) => Number(sql.get<{ used: number }>('select used from quota_daily where day = ? and k = ?', [day, k])?.used ?? 0),
    add: (k, n) =>
      sql.run('insert into quota_daily (day, k, used) values (?, ?, ?) on conflict(day, k) do update set used = used + excluded.used', [day, k, n])
  };
}

export interface QuotaSettings {
  /** Daily neuron limit (the free tier's 10,000 unless the operator set another; 0 = bank only). */
  dailyNeurons: number;
  /** Operator-declared provider outage (stage 4, bank only). */
  outage: boolean;
}

export function readQuotaSettings(sql: SqliteExecutor): QuotaSettings {
  const get = (k: string) => sql.get<{ v: number }>('select v from quota_settings where k = ?', [k])?.v;
  const limit = get('daily_neurons');
  return { dailyNeurons: typeof limit === 'number' && limit >= 0 ? limit : FREE_TIER_LIMITS.dailyNeurons, outage: get('outage') === 1 };
}

/** Lessons that hold the reserve now: running, or started within the 2-hour lesson window. */
export function activeLessonStarts(sql: SqliteExecutor, nowMs: number): number[] {
  return sql
    .all<{ started_at: number }>('select started_at from lessons where ended_at is null and started_at >= ?', [nowMs - 120 * 60_000])
    .map((r) => Number(r.started_at));
}

export function createDayMeter(sql: SqliteExecutor, day: string): QuotaMeter {
  const s = readQuotaSettings(sql);
  const meter = new QuotaMeter(day, s.dailyNeurons, sqlQuotaStore(sql, day));
  meter.setProviderOutage(s.outage);
  return meter;
}

/** The operator view: status, settings and the recent days that reached the alert stage. */
export function quotaView(sql: SqliteExecutor, meter: QuotaMeter, nowMs: number): Record<string, unknown> {
  meter.setScheduledLessons(activeLessonStarts(sql, nowMs));
  const st: QuotaStatus = meter.getStatus(nowMs);
  return {
    day: st.day,
    stage: st.stage,
    neurons_used: st.neuronsUsed,
    neurons_limit: st.neuronsLimit,
    usage_ratio: st.usageRatio,
    bank_only: st.bankOnlyMode,
    ops_alert: st.opsAlert,
    lesson_reserve_active: st.lessonReservedActive,
    /** The operator and test share (OPS_SHARE, R2627): operator try/prebuild and smoke/demo students spend only this. */
    ops: meter.opsStatus(),
    settings: readQuotaSettings(sql),
    alert_days: sql
      .all<{ day: string; stage: number }>("select day, used as stage from quota_daily where k = 'alert_stage' order by day desc limit 14")
      .map((r) => ({ day: r.day, stage: Number(r.stage) }))
  };
}

/**
 * The quota block of the operator health (`/v1/admin/health`, `/v1/ops/health`), the fields the ops keeper reads:
 * `alert` is the docs/09 P9 escalation (today reached stage 2+, i.e. 85% of the day's neurons, or the ladder is
 * at bank only / outage now); `over_85` is the usage itself; `alert_today` = the hourly rollup already recorded it.
 */
export function quotaHealth(sql: SqliteExecutor, meter: QuotaMeter, nowMs: number): Record<string, unknown> {
  const v = quotaView(sql, meter, nowMs) as {
    day: string;
    stage: number;
    usage_ratio: number;
    neurons_used: number;
    neurons_limit: number;
    bank_only: boolean;
    lesson_reserve_active: boolean;
    settings: QuotaSettings;
    alert_days: Array<{ day: string; stage: number }>;
  };
  const recorded = v.alert_days.find((d) => d.day === v.day);
  const over85 = v.neurons_limit > 0 ? v.neurons_used / v.neurons_limit >= 0.85 : false;
  return {
    day: v.day,
    stage: v.stage,
    usage_ratio: v.usage_ratio,
    neurons_used: v.neurons_used,
    neurons_limit: v.neurons_limit,
    over_85: over85,
    bank_only: v.bank_only,
    outage: v.settings.outage,
    lesson_reserve_active: v.lesson_reserve_active,
    alert_today: Boolean(recorded),
    max_stage_today: Math.max(v.stage, recorded?.stage ?? 0),
    alert: v.stage >= 2 || Boolean(recorded)
  };
}

/** Hourly rollup: remember the highest stage a day reached (stage 2+ = docs/09 "85% 초과한 날"). */
export function rollupQuota(sql: SqliteExecutor, meter: QuotaMeter, nowMs: number): { stage: number; used: number; limit: number; alert: boolean } {
  meter.setScheduledLessons(activeLessonStarts(sql, nowMs));
  const st = meter.getStatus(nowMs);
  const alert = st.stage >= 2;
  if (alert) {
    sql.run(
      "insert into quota_daily (day, k, used) values (?, 'alert_stage', ?) on conflict(day, k) do update set used = max(used, excluded.used)",
      [st.day, st.stage]
    );
  }
  return { stage: st.stage, used: st.neuronsUsed, limit: st.neuronsLimit, alert };
}

const QuotaSettingsBody = z
  .object({
    /** null = back to the free tier default. */
    daily_neurons: z.number().int().min(0).max(10_000_000).nullable().optional(),
    outage: z.boolean().optional()
  })
  .strict();

/** Operator routes (behind the operator token like every /v1/admin route). */
export function buildQuotaAdminApp(deps: { sql: SqliteExecutor; meter: () => QuotaMeter; nowMs: () => number; onSettings: () => void }): Hono {
  const app = new Hono();
  app.get('/v1/admin/quota', (c) => c.json(quotaView(deps.sql, deps.meter(), deps.nowMs())));
  app.post('/v1/admin/quota', async (c) => {
    const p = QuotaSettingsBody.safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'invalid', issues: p.error.issues }, 400);
    const set = (k: string, v: number) =>
      deps.sql.run('insert into quota_settings (k, v) values (?, ?) on conflict(k) do update set v = excluded.v', [k, v]);
    if (p.data.daily_neurons === null) deps.sql.run("delete from quota_settings where k = 'daily_neurons'");
    else if (typeof p.data.daily_neurons === 'number') set('daily_neurons', p.data.daily_neurons);
    if (typeof p.data.outage === 'boolean') set('outage', p.data.outage ? 1 : 0);
    deps.onSettings();
    return c.json(quotaView(deps.sql, deps.meter(), deps.nowMs()));
  });
  return app;
}
