import {
  ClientRoomMessageSchema,
  type AnySpecV2,
  type ClientRoomMessage,
  type HintLevel,
  type Interlocutor,
  type Level,
  type NpcContext,
  type ServerRoomMessage,
  type SessionKind,
  type UtteranceMode
} from '@lcw/schemas';
import {
  CHUNK_SIZE,
  CubicChunk,
  VoxelWorld,
  calculateTradeSettlement,
  populateInitialWorld
} from '@lcw/sim-core';
import { GuardedWorldObjects, inspectSpecG1ToG5, type StoredL3Object } from '@lcw/guard';

export interface SqliteExecutor {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  get<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T extends Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  close?(): void;
}

export interface ObjectStore {
  put(key: string, value: string | Uint8Array): Promise<void> | void;
  get(key: string): Promise<string | Uint8Array | null> | string | Uint8Array | null;
  delete(key: string): Promise<void> | void;
}

export class InMemoryR2Store implements ObjectStore {
  private readonly store = new Map<string, string | Uint8Array>();

  put(key: string, value: string | Uint8Array): void {
    this.store.set(key, value);
  }

  get(key: string): string | Uint8Array | null {
    return this.store.get(key) ?? null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

export const WORLD_DO_SCHEMA_SQL = `
create table if not exists meta (k text primary key, v text not null);
create table if not exists chunks (cx integer not null, cy integer not null, cz integer not null, rev integer not null, data blob not null, primary key (cx, cy, cz));
create table if not exists objects (id text primary key, kind text not null, spec text not null, spec_version integer not null, owner text not null, state text not null, pos text not null, created_at integer not null);
create table if not exists items (id text primary key, owner text not null, spec text not null, location text not null, durability integer not null, card_id text);
create table if not exists ledger (id integer primary key autoincrement, player text not null, delta integer not null, reason text not null, ref text not null, at integer not null);
create table if not exists journal (seq integer primary key autoincrement, at integer not null, actor text not null, op text not null, payload text not null, inverse text not null);
create table if not exists snapshots (id text primary key, at integer not null, reason text not null, r2_key text not null, journal_seq integer not null);
`;

export const D1_SCHEMA_SQL = `
create table if not exists families (id text primary key, created_at integer not null);
create table if not exists guardians (id text primary key, family_id text not null, oauth_sub text unique, locale text not null default 'ko');
create table if not exists players (id text primary key, family_id text not null, kind text not null, nickname text not null, birth_year integer, l1 text not null default 'ko', target_lang text not null default 'en', level text not null default 'L1', level_locked integer not null default 0, tutor_student integer not null default 0);
create table if not exists consents (player_id text not null, guardian_id text not null, scope text not null, granted_at integer, revoked_at integer, primary key (player_id, scope));
create table if not exists seats (id text primary key, payer_id text not null, player_id text not null, plan text not null, period text not null, starts_at integer not null, ends_at integer not null, status text not null);
create table if not exists guest_passes (id text primary key, seat_id text not null, code text unique not null, used_by text, expires_at integer not null);
create table if not exists friends (a text not null, b text not null, approved_by_guardian integer not null default 0, primary key (a, b));
create table if not exists worlds (id text primary key, owner_id text not null, name text not null, seed text not null, gen_version integer not null, mode text not null, lang text not null, visibility text not null default 'private', pvp integer not null default 0, max_players integer not null default 8, archived integer not null default 0, last_played integer);
create table if not exists world_members (world_id text not null, player_id text not null, role text not null, primary key (world_id, player_id));
create table if not exists server_list (world_id text primary key, title text not null, tags text not null, audience text not null, online integer not null default 0, updated_at integer not null);
create table if not exists world_reports (world_id text not null, reporter_id text not null, reason text not null, created_at integer not null, primary key (world_id, reporter_id));
create table if not exists utterances (id text primary key, player_id text not null, world_id text not null, session_id text not null, session_kind text not null, ctx text not null, mode text not null, interlocutor text not null, first_text text not null, target_text text not null, final_text text not null, words integer not null, l1_words integer not null, dur_ms integer not null, latency_ms integer not null, stars integer not null, hint_level text not null, attempts integer not null, score real not null, confidence real not null default 1.0, source text not null, audio_first text, audio_final text, created_at integer not null);
create table if not exists memory_cards (id text primary key, player_id text not null, utterance_id text not null, item_id text not null, origin text not null, box integer not null, next_review_at integer not null, lapses integer not null, mastered_at integer);
create table if not exists expressions (id text primary key, player_id text not null, lemma_key text not null, first_seen_at integer not null, born_in text not null, lesson_id text, reuse_solo integer not null default 0, last_used_at integer);
create table if not exists lessons (id text primary key, player_id text not null, world_id text not null, started_at integer not null, ended_at integer, plan text not null, campaign_note text);
create table if not exists lesson_minutes (lesson_id text not null, minute integer not null, student_ms integer not null, teacher_ms integer not null, exchanges integer not null, activity text not null, primary key (lesson_id, minute));
create table if not exists pins (id text primary key, lesson_id text not null, at_ms integer not null, kind text not null, note text not null, before_clip text, after_clip text);
create table if not exists anchor_tasks (id text primary key, lesson_id text not null, prompt_id text not null, utterance_ids text not null, metrics text not null);
create table if not exists metrics_weekly (player_id text not null, week text not null, m text not null, primary key (player_id, week));
create table if not exists reports (id text primary key, player_id text not null, kind text not null, ref_id text not null, facts text not null, body text not null, clips text not null, share_token text unique, opened_at integer, created_at integer not null);
create table if not exists report_deliveries (report_id text primary key, player_id text not null, guardian_id text not null, kind text not null, share_token text not null, share_url text not null, status text not null, teacher_comment text, next_lesson_at text, sent_at integer not null, opened_at integer, reminder_sent_at integer);
create table if not exists phrase_bank (id text primary key, lang text not null, ctx text not null, intent text not null, slots_key text not null, level text not null, offers text not null, tts text, status text not null);
create table if not exists cache_entries (key_hash text primary key, lang text not null, offers text not null, status text not null, distinct_users integer not null default 0, created_at integer not null);
create table if not exists quota_daily (day text not null, k text not null, used integer not null, primary key (day, k));
`;

export type ConsentScope = 'voice_store' | 'ai_report_draft' | 'peer_multiplayer' | 'clip_share';

export interface UtteranceLogRow {
  id: string;
  player_id: string;
  world_id: string;
  session_id: string;
  session_kind: SessionKind;
  ctx: NpcContext | string;
  mode: UtteranceMode;
  interlocutor: Interlocutor;
  first_text: string;
  target_text: string;
  final_text: string;
  words: number;
  l1_words: number;
  dur_ms: number;
  latency_ms: number;
  stars: number;
  hint_level: HintLevel;
  attempts: number;
  score: number;
  confidence: number;
  source: string;
  audio_first: string | null;
  audio_final: string | null;
  created_at: number;
}

export class EdgePlatformDb {
  readonly sql: SqliteExecutor;

  constructor(sql: SqliteExecutor, schemaSql = D1_SCHEMA_SQL) {
    this.sql = sql;
    this.sql.exec(schemaSql);
  }

  ensureFamilyAndPlayer(params: {
    familyId: string;
    guardianId: string;
    playerId: string;
    nickname: string;
    birthYear?: number;
    level?: Level;
    nowMs: number;
  }): void {
    this.sql.run('insert or ignore into families (id, created_at) values (?, ?)', [
      params.familyId,
      params.nowMs
    ]);
    this.sql.run(
      'insert or ignore into guardians (id, family_id, locale) values (?, ?, ?)',
      [params.guardianId, params.familyId, 'ko']
    );
    this.sql.run(
      'insert or ignore into players (id, family_id, kind, nickname, birth_year, level) values (?, ?, ?, ?, ?, ?)',
      [
        params.playerId,
        params.familyId,
        'child',
        params.nickname,
        params.birthYear ?? 2016,
        params.level ?? 'L2'
      ]
    );
  }

  setConsent(params: {
    playerId: string;
    guardianId: string;
    scope: ConsentScope;
    granted: boolean;
    nowMs: number;
  }): { scope: ConsentScope; active: boolean } {
    if (params.granted) {
      this.sql.run(
        `insert into consents (player_id, guardian_id, scope, granted_at, revoked_at)
         values (?, ?, ?, ?, null)
         on conflict(player_id, scope) do update set guardian_id = excluded.guardian_id, granted_at = excluded.granted_at, revoked_at = null`,
        [params.playerId, params.guardianId, params.scope, params.nowMs]
      );
      return { scope: params.scope, active: true };
    }

    this.sql.run(
      `insert into consents (player_id, guardian_id, scope, granted_at, revoked_at)
       values (?, ?, ?, null, ?)
       on conflict(player_id, scope) do update set guardian_id = excluded.guardian_id, revoked_at = excluded.revoked_at`,
      [params.playerId, params.guardianId, params.scope, params.nowMs]
    );

    // Revoking voice_store strips previously attached raw audio references (AGENTS.md 4.5, docs/16)
    if (params.scope === 'voice_store') {
      this.sql.run('update utterances set audio_first = null, audio_final = null where player_id = ?', [
        params.playerId
      ]);
    }
    return { scope: params.scope, active: false };
  }

  hasActiveConsent(playerId: string, scope: ConsentScope): boolean {
    const row = this.sql.get<{ granted_at: number | null; revoked_at: number | null }>(
      'select granted_at, revoked_at from consents where player_id = ? and scope = ?',
      [playerId, scope]
    );
    return Boolean(row && row.granted_at !== null && row.revoked_at === null);
  }

  listConsents(playerId: string): Record<ConsentScope, boolean> {
    return {
      voice_store: this.hasActiveConsent(playerId, 'voice_store'),
      ai_report_draft: this.hasActiveConsent(playerId, 'ai_report_draft'),
      peer_multiplayer: this.hasActiveConsent(playerId, 'peer_multiplayer'),
      clip_share: this.hasActiveConsent(playerId, 'clip_share')
    };
  }

  /**
   * Logs utterance to D1 while strictly blocking minor audio keys unless voice_store consent is active.
   */
  logUtterance(row: UtteranceLogRow): { storedAudio: boolean } {
    const allowAudio = this.hasActiveConsent(row.player_id, 'voice_store');
    const audioFirst = allowAudio ? row.audio_first : null;
    const audioFinal = allowAudio ? row.audio_final : null;

    this.sql.run(
      `insert into utterances (
        id, player_id, world_id, session_id, session_kind, ctx, mode, interlocutor,
        first_text, target_text, final_text, words, l1_words, dur_ms, latency_ms,
        stars, hint_level, attempts, score, confidence, source, audio_first, audio_final, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.player_id,
        row.world_id,
        row.session_id,
        row.session_kind,
        row.ctx,
        row.mode,
        row.interlocutor,
        row.first_text,
        row.target_text,
        row.final_text,
        row.words,
        row.l1_words,
        row.dur_ms,
        row.latency_ms,
        row.stars,
        row.hint_level,
        row.attempts,
        row.score,
        row.confidence,
        row.source,
        audioFirst,
        audioFinal,
        row.created_at
      ]
    );
    return { storedAudio: allowAudio && Boolean(audioFirst || audioFinal) };
  }

  listUtterancesForPlayer(playerId: string): UtteranceLogRow[] {
    return this.sql.all<Record<string, unknown>>(
      'select * from utterances where player_id = ? order by created_at asc',
      [playerId]
    ) as unknown as UtteranceLogRow[];
  }

  registerPublicWorld(params: {
    worldId: string;
    ownerId: string;
    title: string;
    tags: string[];
    audience: 'friends' | 'public';
    nowMs: number;
  }): void {
    this.sql.run(
      `insert or replace into worlds (id, owner_id, name, seed, gen_version, mode, lang, visibility)
       values (?, ?, ?, 'seed-default', 1, 'survival', 'en', ?)`,
      [params.worldId, params.ownerId, params.title, params.audience]
    );
    this.sql.run(
      `insert or replace into server_list (world_id, title, tags, audience, online, updated_at)
       values (?, ?, ?, ?, 1, ?)`,
      [params.worldId, params.title, JSON.stringify(params.tags), params.audience, params.nowMs]
    );
  }

  /**
   * Community safety report (docs/16): >= 3 distinct reporters auto-suspends public server_list visibility.
   */
  reportWorldAbuse(params: {
    worldId: string;
    reporterId: string;
    reason: string;
    nowMs: number;
  }): { distinctReporters: number; suspended: boolean } {
    this.sql.run(
      `insert or ignore into world_reports (world_id, reporter_id, reason, created_at)
       values (?, ?, ?, ?)`,
      [params.worldId, params.reporterId, params.reason, params.nowMs]
    );
    const row = this.sql.get<{ cnt: number }>(
      'select count(distinct reporter_id) as cnt from world_reports where world_id = ?',
      [params.worldId]
    );
    const distinctReporters = Number(row?.cnt ?? 0);
    const suspended = distinctReporters >= 3;
    if (suspended) {
      this.sql.run('delete from server_list where world_id = ?', [params.worldId]);
      this.sql.run("update worlds set visibility = 'suspended' where id = ?", [params.worldId]);
    }
    return { distinctReporters, suspended };
  }

  saveReport(params: {
    id: string;
    playerId: string;
    kind: 'weekly' | 'lesson';
    refId: string;
    facts: unknown;
    body: string;
    clips: unknown[];
    shareToken: string;
    nowMs: number;
  }): void {
    this.sql.run(
      `insert or replace into reports (id, player_id, kind, ref_id, facts, body, clips, share_token, opened_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, null, ?)`,
      [
        params.id,
        params.playerId,
        params.kind,
        params.refId,
        JSON.stringify(params.facts),
        params.body,
        JSON.stringify(params.clips),
        params.shareToken,
        params.nowMs
      ]
    );
  }

  registerLessonExpression(params: {
    id: string;
    playerId: string;
    lemmaKey: string;
    lessonId: string;
    nowMs: number;
  }): void {
    this.sql.run(
      `insert or ignore into expressions (id, player_id, lemma_key, first_seen_at, born_in, lesson_id, reuse_solo, last_used_at)
       values (?, ?, ?, ?, 'lesson', ?, 0, ?)`,
      [params.id, params.playerId, params.lemmaKey.toLowerCase(), params.nowMs, params.lessonId, params.nowMs]
    );
  }

  recordSoloExpressionReuse(
    playerId: string,
    text: string,
    nowMs: number
  ): { updatedCount: number; matchedLemmas: string[] } {
    const rows = this.sql.all<{ id: string; lemma_key: string; reuse_solo: number }>(
      "select id, lemma_key, reuse_solo from expressions where player_id = ? and born_in = 'lesson'",
      [playerId]
    );
    const normalizedText = text.toLowerCase();
    const textTokens = new Set(normalizedText.match(/[a-z0-9']+/g) ?? []);
    const matchedLemmas: string[] = [];

    for (const row of rows) {
      const lemmaTokens = row.lemma_key.toLowerCase().match(/[a-z0-9']+/g) ?? [];
      if (lemmaTokens.length === 0) continue;
      const allMatched =
        normalizedText.includes(row.lemma_key.toLowerCase()) ||
        lemmaTokens.every((tok) => textTokens.has(tok));
      if (allMatched) {
        this.sql.run('update expressions set reuse_solo = reuse_solo + 1, last_used_at = ? where id = ?', [
          nowMs,
          row.id
        ]);
        matchedLemmas.push(row.lemma_key);
      }
    }

    return { updatedCount: matchedLemmas.length, matchedLemmas };
  }

  listExpressionsForPlayer(playerId: string): Array<{
    id: string;
    player_id: string;
    lemma_key: string;
    first_seen_at: number;
    born_in: string;
    lesson_id: string | null;
    reuse_solo: number;
    last_used_at: number | null;
  }> {
    return this.sql.all('select * from expressions where player_id = ? order by first_seen_at asc', [
      playerId
    ]);
  }

  listLessonMinutes(lessonId: string): Array<{
    lesson_id: string;
    minute: number;
    student_ms: number;
    teacher_ms: number;
    exchanges: number;
    activity: string;
  }> {
    return this.sql.all('select * from lesson_minutes where lesson_id = ? order by minute asc', [
      lessonId
    ]);
  }

  createAndDeliverParentReport(params: {
    id: string;
    playerId: string;
    guardianId: string;
    kind: 'weekly' | 'lesson';
    refId: string;
    facts: unknown;
    body: string;
    clips: unknown[];
    shareToken: string;
    shareUrl: string;
    teacherComment?: string;
    nextLessonAt?: string;
    nowMs: number;
  }): ReportDeliveryRow {
    this.saveReport({
      id: params.id,
      playerId: params.playerId,
      kind: params.kind,
      refId: params.refId,
      facts: params.facts,
      body: params.body,
      clips: params.clips,
      shareToken: params.shareToken,
      nowMs: params.nowMs
    });
    this.sql.run(
      `insert or replace into report_deliveries (
        report_id, player_id, guardian_id, kind, share_token, share_url, status,
        teacher_comment, next_lesson_at, sent_at, opened_at, reminder_sent_at
      ) values (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, null, null)`,
      [
        params.id,
        params.playerId,
        params.guardianId,
        params.kind,
        params.shareToken,
        params.shareUrl,
        params.teacherComment ?? null,
        params.nextLessonAt ?? null,
        params.nowMs
      ]
    );
    return this.getReportDeliveryByToken(params.shareToken)!;
  }

  getReportDeliveryByToken(shareToken: string): ReportDeliveryRow | null {
    return (
      this.sql.get<ReportDeliveryRow>('select * from report_deliveries where share_token = ?', [
        shareToken
      ]) ?? null
    );
  }

  listReportDeliveriesForPlayer(playerId: string): ReportDeliveryRow[] {
    return this.sql.all<ReportDeliveryRow>(
      'select * from report_deliveries where player_id = ? order by sent_at desc',
      [playerId]
    );
  }

  openSharedReport(shareToken: string, nowMs: number): Record<string, unknown> | null {
    const row = this.sql.get<Record<string, unknown>>(
      'select * from reports where share_token = ?',
      [shareToken]
    );
    if (!row) return null;
    if (row.opened_at === null || row.opened_at === undefined) {
      this.sql.run('update reports set opened_at = ? where share_token = ?', [nowMs, shareToken]);
      row.opened_at = nowMs;
    }
    this.sql.run(
      "update report_deliveries set opened_at = coalesce(opened_at, ?), status = 'opened' where share_token = ?",
      [nowMs, shareToken]
    );
    return {
      ...row,
      delivery_status: 'opened',
      nextTargetsUpdated: true
    };
  }

  /**
   * Dispatches 1 reminder after 48h when guardian has not opened the report (docs/10 §4 T5 -> T7).
   */
  processPendingReportReminders(nowMs: number): { remindedCount: number; reportIds: string[] } {
    const TWO_DAYS_MS = 2 * 86_400_000;
    const due = this.sql.all<ReportDeliveryRow>(
      `select * from report_deliveries
       where opened_at is null and reminder_sent_at is null and (? - sent_at) >= ?`,
      [nowMs, TWO_DAYS_MS]
    );
    const reportIds: string[] = [];
    for (const d of due) {
      this.sql.run(
        "update report_deliveries set status = 'reminder_sent', reminder_sent_at = ? where report_id = ?",
        [nowMs, d.report_id]
      );
      reportIds.push(d.report_id);
    }
    return { remindedCount: reportIds.length, reportIds };
  }
}

export interface ReportDeliveryRow extends Record<string, unknown> {
  report_id: string;
  player_id: string;
  guardian_id: string;
  kind: 'weekly' | 'lesson';
  share_token: string;
  share_url: string;
  status: 'sent' | 'opened' | 'reminder_sent';
  teacher_comment: string | null;
  next_lesson_at: string | null;
  sent_at: number;
  opened_at: number | null;
  reminder_sent_at: number | null;
}

export interface SerializedChunkBlob {
  palette: number[];
  indices: number[];
}

export class WorldDO {
  readonly sql: SqliteExecutor;
  readonly world: VoxelWorld;
  readonly r2: ObjectStore;
  readonly seed: string;
  readonly genVersion: number;
  readonly maxPlayers = 8;
  readonly players = new Map<
    string,
    { id: string; x: number; y: number; z: number; yaw: number; pose: string; isOwner: boolean }
  >();
  safeMode = false;
  guardedObjects = new GuardedWorldObjects();

  constructor(params: {
    sql: SqliteExecutor;
    r2: ObjectStore;
    seed?: string;
    genVersion?: number;
  }) {
    this.sql = params.sql;
    this.r2 = params.r2;
    this.seed = params.seed ?? 'lcw-world-1';
    this.genVersion = params.genVersion ?? 1;
    this.world = new VoxelWorld();
    this.sql.exec(WORLD_DO_SCHEMA_SQL);
    populateInitialWorld(this.world, this.seed, this.genVersion);
    this.sql.run('insert or ignore into meta (k, v) values (?, ?)', ['seed', this.seed]);
    this.sql.run('insert or ignore into meta (k, v) values (?, ?)', [
      'consecutive_load_failures',
      '0'
    ]);
  }

  private persistChunk(cx: number, cy: number, cz: number, chunk: CubicChunk): void {
    const serialized = chunk.serializePaletteCompressed();
    const payload = JSON.stringify({
      palette: serialized.palette,
      indices: Array.from(serialized.indices)
    } satisfies SerializedChunkBlob);
    const existing = this.sql.get<{ rev: number }>(
      'select rev from chunks where cx = ? and cy = ? and cz = ?',
      [cx, cy, cz]
    );
    const nextRev = (existing?.rev ?? 0) + 1;
    this.sql.run(
      `insert into chunks (cx, cy, cz, rev, data) values (?, ?, ?, ?, ?)
       on conflict(cx, cy, cz) do update set rev = excluded.rev, data = excluded.data`,
      [cx, cy, cz, nextRev, payload]
    );
  }

  /**
   * Authoritative chunk edit entrypoint (WP-205): validates via VoxelWorld.setBlock
   * and commits both chunks and journal inside one atomic SQLite transaction.
   */
  applyBlockEditsAtomic(params: {
    actorId: string;
    isOwner?: boolean;
    permittedOnPlot?: boolean;
    edits: Array<{ x: number; y: number; z: number; block_id: number }>;
    nowMs: number;
    simulateCrashMidTx?: boolean;
  }): { ok: boolean; reason?: string; appliedCount: number } {
    const inverse: Array<{ x: number; y: number; z: number; block_id: number }> = [];
    const touchedChunks = new Set<string>();

    // Snapshot previous blocks and verify permissions BEFORE touching SQLite
    for (const e of params.edits) {
      const prev = this.world.getBlock(e.x, e.y, e.z);
      const res = this.world.setBlock(
        {
          id: params.actorId,
          isOwner: params.isOwner ?? false,
          permittedOnPlot: params.permittedOnPlot ?? false
        },
        e.x,
        e.y,
        e.z,
        e.block_id
      );
      if (!res.ok) {
        // Revert any edits applied so far in this batch via setBlock
        for (let i = inverse.length - 1; i >= 0; i--) {
          const inv = inverse[i]!;
          this.world.setBlock(
            { id: 'rollback', isSystemGen: true },
            inv.x,
            inv.y,
            inv.z,
            inv.block_id
          );
        }
        return { ok: false, reason: res.reason, appliedCount: 0 };
      }
      inverse.push({ x: e.x, y: e.y, z: e.z, block_id: prev });
      const cx = Math.floor(e.x / CHUNK_SIZE);
      const cy = Math.floor(e.y / CHUNK_SIZE);
      const cz = Math.floor(e.z / CHUNK_SIZE);
      touchedChunks.add(`${cx},${cy},${cz}`);
    }

    this.sql.exec('BEGIN TRANSACTION');
    try {
      for (const ck of touchedChunks) {
        const [cx, cy, cz] = ck.split(',').map(Number) as [number, number, number];
        const chunk = this.world.getOrCreateChunk(cx, cy, cz);
        this.persistChunk(cx, cy, cz, chunk);
      }

      if (params.simulateCrashMidTx) {
        throw new Error('simulated_tx_abort');
      }

      this.sql.run(
        'insert into journal (at, actor, op, payload, inverse) values (?, ?, ?, ?, ?)',
        [
          params.nowMs,
          params.actorId,
          'block.edit',
          JSON.stringify(params.edits),
          JSON.stringify(inverse)
        ]
      );
      this.sql.exec('COMMIT');
      return { ok: true, appliedCount: params.edits.length };
    } catch (err) {
      this.sql.exec('ROLLBACK');
      // Restore in-memory world via setBlock as well
      for (let i = inverse.length - 1; i >= 0; i--) {
        const inv = inverse[i]!;
        this.world.setBlock(
          { id: 'rollback', isSystemGen: true },
          inv.x,
          inv.y,
          inv.z,
          inv.block_id
        );
      }
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'tx_failed',
        appliedCount: 0
      };
    }
  }

  proposeAndStoreObject(params: {
    id: string;
    playerId: string;
    rawSpec: unknown;
    pos: [number, number, number];
    nowMs: number;
  }): { approved: boolean; reason?: string } {
    const countRow = this.sql.get<{ cnt: number }>('select count(*) as cnt from objects');
    const guardRes = inspectSpecG1ToG5(params.rawSpec, {
      playerId: params.playerId,
      nowMs: params.nowMs,
      existingWorldObjectCount: Number(countRow?.cnt ?? 0)
    });
    if (!guardRes.approved || !guardRes.spec) {
      return {
        approved: false,
        reason: `${guardRes.stageFailed ?? 'G1'}:${guardRes.reason ?? 'rejected'}`
      };
    }
    const spec: AnySpecV2 = guardRes.spec;
    const commit = this.guardedObjects.commitObject({
      id: params.id,
      owner: params.playerId,
      spec,
      pos: params.pos
    });
    if (!commit.committed) {
      return { approved: false, reason: commit.reason };
    }
    this.sql.run(
      `insert or replace into objects (id, kind, spec, spec_version, owner, state, pos, created_at)
       values (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        params.id,
        spec.kind,
        JSON.stringify(spec),
        spec.v,
        params.playerId,
        JSON.stringify(params.pos),
        params.nowMs
      ]
    );
    return { approved: true };
  }

  appendLedger(player: string, delta: number, reason: string, ref: string, nowMs: number): number {
    this.sql.run(
      'insert into ledger (player, delta, reason, ref, at) values (?, ?, ?, ?, ?)',
      [player, delta, reason, ref, nowMs]
    );
    return this.getPlayerBalance(player);
  }

  getPlayerBalance(player: string): number {
    const row = this.sql.get<{ total: number | null }>(
      'select coalesce(sum(delta), 0) as total from ledger where player = ?',
      [player]
    );
    return Number(row?.total ?? 0);
  }

  grantOrSetItem(
    owner: string,
    itemId: string,
    specJson: string,
    location = 'hotbar',
    durability = 100
  ): void {
    this.sql.run(
      `insert or replace into items (id, owner, spec, location, durability, card_id)
       values (?, ?, ?, ?, ?, null)`,
      [itemId, owner, specJson, location, durability]
    );
  }

  listPlayerItems(owner: string): Array<{
    id: string;
    owner: string;
    spec: string;
    location: string;
    durability: number;
    card_id: string | null;
  }> {
    return this.sql.all('select * from items where owner = ? order by id asc', [owner]);
  }

  /**
   * Executes an atomic bilateral teacher-student or peer barter trade (WP-509, docs/03 D11).
   * Requires both sides to have spoken and verifies ownership + star-based fee in one transaction.
   */
  executeTradeAtomic(params: {
    tradeId: string;
    studentId: string;
    teacherId: string;
    studentGiveItemId: string;
    teacherGiveItemId: string;
    baseValueCoins: number;
    stars: 1 | 2 | 3;
    teacherTranscript: string;
    studentTranscript: string;
    studentScorePass: boolean;
    nowMs: number;
  }): {
    ok: boolean;
    reason?: string;
    feeCoins: number;
    bonusGranted: boolean;
    swappedItemIds: [string, string] | [];
  } {
    const teacherSpoken = params.teacherTranscript.trim().length > 0;
    const studentSpoken = params.studentTranscript.trim().length > 0;

    const settlement = calculateTradeSettlement({
      baseValueCoins: params.baseValueCoins,
      stars: params.stars,
      teacherSpoken,
      studentSpoken,
      studentPassed: params.studentScorePass,
      studentCoins: this.getPlayerBalance(params.studentId)
    });
    if (!settlement.settled) {
      return {
        ok: false,
        reason: settlement.reason,
        feeCoins: settlement.feeCoins,
        bonusGranted: false,
        swappedItemIds: []
      };
    }

    const studentItem = this.sql.get<{ id: string; owner: string }>(
      'select id, owner from items where id = ? and owner = ?',
      [params.studentGiveItemId, params.studentId]
    );
    const teacherItem = this.sql.get<{ id: string; owner: string }>(
      'select id, owner from items where id = ? and owner = ?',
      [params.teacherGiveItemId, params.teacherId]
    );
    if (!studentItem || !teacherItem) {
      return {
        ok: false,
        reason: 'missing_trade_item_ownership',
        feeCoins: settlement.feeCoins,
        bonusGranted: false,
        swappedItemIds: []
      };
    }

    this.sql.exec('BEGIN TRANSACTION');
    try {
      if (settlement.feeCoins > 0) {
        this.sql.run(
          'insert into ledger (player, delta, reason, ref, at) values (?, ?, ?, ?, ?)',
          [params.studentId, -settlement.feeCoins, 'trade:fee', params.tradeId, params.nowMs]
        );
      }
      this.sql.run('update items set owner = ? where id = ?', [
        params.teacherId,
        params.studentGiveItemId
      ]);
      this.sql.run('update items set owner = ? where id = ?', [
        params.studentId,
        params.teacherGiveItemId
      ]);
      this.sql.run(
        'insert into journal (at, actor, op, payload, inverse) values (?, ?, ?, ?, ?)',
        [
          params.nowMs,
          params.studentId,
          'trade.execute',
          JSON.stringify({
            tradeId: params.tradeId,
            teacherId: params.teacherId,
            studentGiveItemId: params.studentGiveItemId,
            teacherGiveItemId: params.teacherGiveItemId,
            stars: params.stars,
            feeCoins: settlement.feeCoins
          }),
          JSON.stringify({
            studentGiveItemId: params.studentGiveItemId,
            teacherGiveItemId: params.teacherGiveItemId,
            feeRefund: settlement.feeCoins
          })
        ]
      );
      this.sql.exec('COMMIT');
      return {
        ok: true,
        feeCoins: settlement.feeCoins,
        bonusGranted: settlement.bonusGranted,
        swappedItemIds: [params.studentGiveItemId, params.teacherGiveItemId]
      };
    } catch (err) {
      this.sql.exec('ROLLBACK');
      return {
        ok: false,
        reason: err instanceof Error ? err.message : 'trade_tx_failed',
        feeCoins: settlement.feeCoins,
        bonusGranted: false,
        swappedItemIds: []
      };
    }
  }

  async saveSnapshot(snapshotId: string, reason: string, nowMs: number): Promise<string> {
    const chunks = this.sql.all<{ cx: number; cy: number; cz: number; rev: number; data: string }>(
      'select cx, cy, cz, rev, data from chunks'
    );
    const objects = this.sql.all<Record<string, unknown>>('select * from objects');
    const seqRow = this.sql.get<{ max_seq: number | null }>(
      'select max(seq) as max_seq from journal'
    );
    const journalSeq = Number(seqRow?.max_seq ?? 0);
    const r2Key = `snapshots/${snapshotId}.json`;
    await this.r2.put(
      r2Key,
      JSON.stringify({
        snapshotId,
        seed: this.seed,
        genVersion: this.genVersion,
        chunks,
        objects
      })
    );
    this.sql.run(
      'insert into snapshots (id, at, reason, r2_key, journal_seq) values (?, ?, ?, ?, ?)',
      [snapshotId, nowMs, reason, r2Key, journalSeq]
    );
    return r2Key;
  }

  private hydrateChunkPayload(cx: number, cy: number, cz: number, dataRaw: string): void {
    const parsed = JSON.parse(dataRaw) as SerializedChunkBlob;
    if (!Array.isArray(parsed.palette) || !Array.isArray(parsed.indices) || parsed.indices.length !== 4096) {
      throw new Error('corrupted_chunk_blob');
    }
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const pIdx = parsed.indices[CubicChunk.index(lx, ly, lz)] ?? 0;
          const blockId = parsed.palette[pIdx] ?? 0;
          const wx = cx * CHUNK_SIZE + lx;
          const wy = cy * CHUNK_SIZE + ly;
          const wz = cz * CHUNK_SIZE + lz;
          if (this.world.getBlock(wx, wy, wz) !== blockId) {
            this.world.setBlock({ id: 'world-load', isSystemGen: true }, wx, wy, wz, blockId);
          }
        }
      }
    }
  }

  /**
   * Loads persisted chunks and objects cleanly; after 2 consecutive load failures enters Safe Mode (docs/05 §6, WP-205).
   */
  async loadWorldWithRecovery(opts?: { injectCorruption?: boolean }): Promise<{
    safeMode: boolean;
    quarantinedObjectIds: string[];
    restoredChunks: number;
  }> {
    const failRow = this.sql.get<{ v: string }>(
      "select v from meta where k = 'consecutive_load_failures'"
    );
    let failures = Number(failRow?.v ?? '0');

    try {
      if (opts?.injectCorruption) {
        throw new Error('injected_load_corruption');
      }

      const chunkRows = this.sql.all<{ cx: number; cy: number; cz: number; data: string }>(
        'select cx, cy, cz, data from chunks'
      );
      for (const row of chunkRows) {
        this.hydrateChunkPayload(row.cx, row.cy, row.cz, String(row.data));
      }

      const objectRows = this.sql.all<{
        id: string;
        owner: string;
        spec: string;
        state: string;
        pos: string;
      }>('select id, owner, spec, state, pos from objects');

      const loadedObjects: StoredL3Object[] = objectRows.map((o) => {
        const parsedPos = (() => {
          try {
            return JSON.parse(o.pos) as [number, number, number];
          } catch {
            return [0, 0, 0] as [number, number, number];
          }
        })();
        try {
          const spec = JSON.parse(o.spec) as AnySpecV2;
          return {
            id: o.id,
            owner: o.owner,
            spec,
            pos: parsedPos,
            state: o.state === 'quarantined' ? 'quarantined' : 'active',
            errorCount: 0
          };
        } catch {
          return {
            id: o.id,
            owner: o.owner,
            spec: {
              kind: 'item',
              v: 2,
              name: 'corrupted',
              socket: 'Head_Socket',
              parts: [{ id: 'cube_unit', pos: [0, 0, 0], color: '#FFFFFF' }],
              tags: [],
              tier: 1,
              power: { limit: 1, used: 0 }
            },
            pos: parsedPos,
            state: 'active',
            errorCount: 0,
            corruptedPayload: true
          };
        }
      });

      this.guardedObjects = new GuardedWorldObjects(loadedObjects);
      const tickRes = this.guardedObjects.openAndTickAllObjects(() => {});
      for (const qId of tickRes.quarantinedIds) {
        this.sql.run("update objects set state = 'quarantined' where id = ?", [qId]);
      }

      this.sql.run(
        "insert or replace into meta (k, v) values ('consecutive_load_failures', '0')",
        []
      );
      this.safeMode = false;
      return {
        safeMode: false,
        quarantinedObjectIds: tickRes.quarantinedIds,
        restoredChunks: chunkRows.length
      };
    } catch {
      failures += 1;
      this.sql.run('insert or replace into meta (k, v) values (?, ?)', [
        'consecutive_load_failures',
        String(failures)
      ]);
      if (failures >= 2) {
        this.safeMode = true;
        // Rehydrate from latest R2 snapshot if available while keeping world bootable
        const latest = this.sql.get<{ r2_key: string }>(
          'select r2_key from snapshots order by at desc limit 1'
        );
        if (latest) {
          const rawSnap = await this.r2.get(latest.r2_key);
          if (typeof rawSnap === 'string') {
            const snap = JSON.parse(rawSnap) as {
              chunks: Array<{ cx: number; cy: number; cz: number; data: string }>;
            };
            for (const c of snap.chunks) {
              this.hydrateChunkPayload(c.cx, c.cy, c.cz, String(c.data));
            }
          }
        }
      }
      return { safeMode: this.safeMode, quarantinedObjectIds: [], restoredChunks: 0 };
    }
  }

  async rewindToSnapshot(snapshotId: string): Promise<boolean> {
    const snap = this.sql.get<{ r2_key: string }>('select r2_key from snapshots where id = ?', [
      snapshotId
    ]);
    if (!snap) return false;
    const raw = await this.r2.get(snap.r2_key);
    if (typeof raw !== 'string') return false;
    const parsed = JSON.parse(raw) as {
      chunks: Array<{ cx: number; cy: number; cz: number; rev: number; data: string }>;
    };
    this.sql.exec('BEGIN TRANSACTION');
    try {
      this.sql.run('delete from chunks');
      for (const c of parsed.chunks) {
        this.sql.run('insert into chunks (cx, cy, cz, rev, data) values (?, ?, ?, ?, ?)', [
          c.cx,
          c.cy,
          c.cz,
          c.rev,
          c.data
        ]);
        this.hydrateChunkPayload(c.cx, c.cy, c.cz, String(c.data));
      }
      this.sql.run(
        "insert or replace into meta (k, v) values ('consecutive_load_failures', '0')",
        []
      );
      this.sql.exec('COMMIT');
      this.safeMode = false;
      return true;
    } catch {
      this.sql.exec('ROLLBACK');
      return false;
    }
  }

  joinPlayer(playerId: string, isOwner = false): { joined: boolean; reason?: string } {
    if (!this.players.has(playerId) && this.players.size >= this.maxPlayers) {
      return { joined: false, reason: 'room_full' };
    }
    this.players.set(playerId, {
      id: playerId,
      x: 144,
      y: 2,
      z: 144,
      yaw: 0,
      pose: 'idle',
      isOwner
    });
    return { joined: true };
  }

  handleRoomMessage(playerId: string, rawMsg: unknown, nowMs: number): {
    ok: boolean;
    broadcast?: ServerRoomMessage;
    reason?: string;
  } {
    const parsed = ClientRoomMessageSchema.safeParse(rawMsg);
    if (!parsed.success) {
      return { ok: false, reason: 'invalid_room_message' };
    }
    const msg: ClientRoomMessage = parsed.data;
    const player = this.players.get(playerId);
    if (!player) {
      return { ok: false, reason: 'player_not_in_room' };
    }

    if (msg.type === 'move') {
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.yaw = msg.yaw;
      player.pose = msg.pose;
      return {
        ok: true,
        broadcast: {
          type: 'snapshot',
          tick: Math.floor(nowMs / 50),
          clock_min: 720,
          weather: 'clear',
          players: [...this.players.values()].map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: p.yaw,
            pose: p.pose
          }))
        }
      };
    }

    if (msg.type === 'block.edit') {
      const res = this.applyBlockEditsAtomic({
        actorId: playerId,
        isOwner: player.isOwner,
        edits: msg.edits,
        nowMs
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: res.reason,
          broadcast: { type: 'block.reject', seq: msg.seq, reason: res.reason ?? 'rejected' }
        };
      }
      return {
        ok: true,
        broadcast: { type: 'block.confirm', seq: msg.seq, rev: 1 }
      };
    }

    if (msg.type === 'object.propose') {
      const objId = `obj-${playerId}-${nowMs}`;
      const prop = this.proposeAndStoreObject({
        id: objId,
        playerId,
        rawSpec: msg.spec,
        pos: [player.x, player.y, player.z],
        nowMs
      });
      if (!prop.approved) {
        return {
          ok: false,
          reason: prop.reason,
          broadcast: { type: 'object.reject', reason: prop.reason ?? 'rejected', stage: 'G1' }
        };
      }
      return {
        ok: true,
        broadcast: {
          type: 'object.commit',
          object_id: objId,
          state: 'active'
        }
      };
    }

    if (msg.type === 'say') {
      return {
        ok: true,
        broadcast: {
          type: 'event',
          kind: 'director_event',
          payload: { player_id: playerId, text: msg.text }
        }
      };
    }

    return { ok: true };
  }
}

export type LessonPinKind = 'expression' | 'coaching' | 'highlight';
export type DirectorEventKind =
  | 'weather_shift'
  | 'blackout'
  | 'npc_prompt'
  | 'mentor_dungeon_gate'
  | 'review_chest'
  | 'star_celebration';

export class LessonDO {
  readonly lessonId: string;
  readonly db: EdgePlatformDb;
  possessedNpcCtx: NpcContext | null = null;
  readonly directorEvents: Array<{ kind: DirectorEventKind; atMs: number; detail: string }> = [];
  windowSubscribers = 0;

  constructor(lessonId: string, db: EdgePlatformDb, playerId: string, worldId: string, nowMs: number) {
    this.lessonId = lessonId;
    this.db = db;
    this.db.sql.run(
      'insert or ignore into lessons (id, player_id, world_id, started_at, plan) values (?, ?, ?, ?, ?)',
      [lessonId, playerId, worldId, nowMs, 'weekly_120m']
    );
  }

  recordMinute(params: {
    minute: number;
    studentMs: number;
    teacherMs: number;
    exchanges: number;
    activity: string;
  }): void {
    this.db.sql.run(
      `insert or replace into lesson_minutes (lesson_id, minute, student_ms, teacher_ms, exchanges, activity)
       values (?, ?, ?, ?, ?, ?)`,
      [
        this.lessonId,
        params.minute,
        params.studentMs,
        params.teacherMs,
        params.exchanges,
        params.activity
      ]
    );
  }

  addPin(params: {
    id: string;
    atMs: number;
    kind: LessonPinKind;
    note: string;
    beforeClip?: string | null;
    afterClip?: string | null;
  }): void {
    this.db.sql.run(
      `insert into pins (id, lesson_id, at_ms, kind, note, before_clip, after_clip)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        this.lessonId,
        params.atMs,
        params.kind,
        params.note,
        params.beforeClip ?? null,
        params.afterClip ?? null
      ]
    );
  }

  triggerDirectorEvent(kind: DirectorEventKind, detail: string, nowMs: number): void {
    this.directorEvents.push({ kind, atMs: nowMs, detail });
  }

  setNpcPossession(npcCtx: NpcContext | null): void {
    this.possessedNpcCtx = npcCtx;
  }

  /**
   * Parent Lesson Window is strictly listen-only (docs/10 §3, docs/12 §8, WP-304).
   * Guardian audio uplink MUST be rejected at the DO boundary.
   */
  handleLessonWindowAudioUplink(): { accepted: false; status: 403; reason: 'listen_only_window' } {
    return { accepted: false, status: 403, reason: 'listen_only_window' };
  }
}
