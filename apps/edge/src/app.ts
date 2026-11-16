import { Hono } from 'hono';
import { z } from 'zod';
import {
  LlmConverseInputSchema,
  ScoreRequestSchema,
  ScoreResponseSchema,
  UnderstandRequestSchema,
  type LlmConverseInput,
  type VoiceUploadOffer
} from '@lcw/schemas';
import { converseFeedbackKo, decideConverseReward, scoreUtterance, understandUtterance } from '@lcw/converse';
import { LESSON_ARC_STAGE_GUIDES, TEACHER_STUDENT_TRADE_SCENARIOS } from '@lcw/content';
import { QuotaMeter } from '@lcw/quota';
import {
  buildFactualWeeklySummary,
  computeLessonMetrics,
  computeTeacherContribution,
  computeThinkAndSpeakIndex,
  computeTwoWeekBaseline,
  computeWeeklyMetrics,
  verifyOrReplaceReportBody,
  type UtteranceMetricInput
} from '@lcw/metrics';
import { inspectSpecG1ToG5 } from '@lcw/guard';
import type { ConsentScope, EdgePlatformDb, LessonDO, WorldDO } from './storage.js';
import { indexedPrice } from './economy.js';
import { claimReadAloud, isFurnitureKind, priceWithReadAloud, readAloudStatus } from './furniture.js';
import { attemptReview, createMemoryCard, listMemoryCards, listReviewSigns, memoryCardId } from './review.js';
import { applyErrandStep, getErrand } from './errand.js';
import { applyPlayStep, PLAY_CTXS, registerPlayRoutes } from './play.js';
import { plotStoreFor } from './plot.js';
import { OPS_PER_REQUEST_MAX } from '@lcw/sim-core';

export interface EdgeRuntimeDeps {
  db: EdgePlatformDb;
  worlds: Map<string, WorldDO>;
  lessons: Map<string, LessonDO>;
  quota: QuotaMeter;
  nowMs: () => number;
  runWorkersAi?: (model: string, input: LlmConverseInput) => Promise<unknown>;
  /** docs/09 P7: the world's weekly price index (1 when absent). Multiplies that world's shop prices. */
  priceIndex?: (worldId: string) => number;
  /** Voice clips (voice.ts offerVoiceUpload): an upload token for a speech turn with voice_store on, else null. */
  offerVoiceUpload?: (p: { playerId: string; utteranceId: string; source: string; nowMs: number }) => Promise<VoiceUploadOffer | null>;
}

const ConsentUpdateBodySchema = z
  .object({
    player_id: z.string().min(1),
    guardian_id: z.string().min(1),
    scope: z.enum(['voice_store', 'ai_report_draft', 'peer_multiplayer', 'clip_share']),
    granted: z.boolean()
  })
  .strict();

const WorldEditsBodySchema = z
  .object({
    actor_id: z.string().min(1),
    is_owner: z.boolean().optional(),
    permitted_on_plot: z.boolean().optional(),
    edits: z
      .array(
        z
          .object({
            x: z.number().int(),
            y: z.number().int(),
            z: z.number().int(),
            block_id: z.number().int().min(0).max(255)
          })
          .strict()
      )
      .min(1)
      .max(16)
  })
  .strict();

const WorldObjectProposeSchema = z
  .object({
    id: z.string().min(1),
    player_id: z.string().min(1),
    spec: z.unknown(),
    pos: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  })
  .strict();

const WorldAbuseReportSchema = z
  .object({
    reporter_id: z.string().min(1),
    reason: z.string().min(3).max(200)
  })
  .strict();

const WorldTradeBodySchema = z
  .object({
    trade_id: z.string().min(1),
    student_id: z.string().min(1),
    teacher_id: z.string().min(1),
    student_give_item_id: z.string().min(1),
    teacher_give_item_id: z.string().min(1),
    base_value_coins: z.number().int().min(0),
    stars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L2'),
    target_text: z.string().min(1),
    teacher_transcript: z.string(),
    student_transcript: z.string(),
    lesson_id: z.string().min(1).optional(),
    pin_expression: z.string().min(1).optional()
  })
  .strict();

const CompleteLessonSendReportSchema = z
  .object({
    report_id: z.string().min(1),
    player_id: z.string().min(1),
    guardian_id: z.string().min(1),
    ref_id: z.string().min(1).default('lesson'),
    draft_body: z.string().default(''),
    teacher_comment: z.string().max(400).default(''),
    next_lesson_at: z.string().min(1).default('일요일 오전 10:00'),
    share_token: z.string().min(16),
    share_url: z.string().min(1).optional(),
    clips: z.array(z.unknown()).default([]),
    /** Lesson-only progress numbers built by lesson mode (docs/18 §3), stored with the facts. No transcript text. */
    lesson_extra: z.object({ progress: z.record(z.union([z.number(), z.record(z.number())])) }).strict().optional(),
    /** Parent-facing facts for this one lesson (parent-report.ts); shown on /r/<token> as facts.lesson. */
    lesson_facts: z.record(z.unknown()).optional()
  })
  .strict();

const ScoreExtendedRequestSchema = ScoreRequestSchema.extend({
  player_id: z.string().min(1),
  world_id: z.string().min(1),
  session_id: z.string().min(1),
  session_kind: z.enum(['solo', 'multi', 'lesson']).default('solo'),
  npc_ctx: z.string().min(1),
  level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L2'),
  /** Empty only on the student solo path (strict_bank): free talk is then matched to the closest bank sentence. */
  target_text: z.string(),
  mode: z.enum(['free', 'guided', 'read', 'recall']).default('free'),
  interlocutor: z.enum(['npc', 'teacher', 'peer', 'self']).default('npc'),
  /**
   * Ignored (AGENTS 4.7). Older clients sent the 3-star price and item here and the server charged it even when it
   * granted fewer stars; price and item now come from the server bank for the stars actually granted.
   */
  price: z.number().int().min(0).optional(),
  item_id: z.string().min(1).optional(),
  stt_source: z.enum(['device', 'workers_ai', 'browser', 'keyboard', 'board']).default('browser'),
  /**
   * Client claim that this is the ECHO step. Honoured only when the server already logged two misses for the same
   * dialog (docs/04 4.1: ECHO from the 3rd miss).
   */
  echo: z.boolean().default(false),
  /** Set by the platform on the student solo path: only bank sentences count; empty target = free talk. */
  strict_bank: z.boolean().default(false),
  attempts: z.number().int().min(1).max(20).default(1),
  latency_ms: z.number().int().min(0).default(1500),
  dur_ms: z.number().int().min(0).default(3000),
  confidence: z.number().finite().min(0).max(1).default(0.95)
}).strict();

const ReadAloudBodySchema = z
  .object({
    player_id: z.string().min(1),
    world_id: z.string().min(1),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L1'),
    kind: z.string().min(1).max(20),
    transcript: z.string().max(400),
    stt_source: z.enum(['device', 'workers_ai', 'browser', 'keyboard', 'board']).default('browser'),
    confidence: z.number().finite().min(0).max(1).default(0.9),
    dur_ms: z.number().int().min(0).max(60_000).default(3000)
  })
  .strict();

const ReviewAttemptBodySchema = z
  .object({
    player_id: z.string().min(1),
    world_id: z.string().min(1),
    level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L1'),
    card_id: z.string().min(1).max(120),
    transcript: z.string().max(400),
    stt_source: z.enum(['device', 'workers_ai', 'browser', 'keyboard', 'board']).default('browser'),
    confidence: z.number().finite().min(0).max(1).default(0.9),
    dur_ms: z.number().int().min(0).max(60_000).default(3000),
    latency_ms: z.number().int().min(0).max(600_000).default(1500)
  })
  .strict();

/**
 * Strips all player identifiers and raw voice fields before passing context to Workers AI (AGENTS.md 4.6).
 */
export function buildSanitizedWorkersAiConverseInput(
  raw: Record<string, unknown>
): LlmConverseInput {
  return LlmConverseInputSchema.parse({
    npc_ctx: raw.npc_ctx,
    level: raw.level,
    normalized: raw.normalized,
    slots: raw.slots,
    allowed_meshes: raw.allowed_meshes ?? ['tea_cup', 'fedora_hat', 'thruster_pack'],
    allowed_tags: raw.allowed_tags ?? ['drink', 'sweet', 'night_light']
  });
}

export function createEdgeApp(deps: EdgeRuntimeDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: 'lcw-edge' }));
  registerPlayRoutes(app, deps);

  app.post('/v1/converse/understand', async (c) => {
    const raw = await c.req.json();
    const parsed = UnderstandRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_understand_request', issues: parsed.error.issues }, 400);
    }

    const req = parsed.data;
    const nowMs = deps.nowMs();
    const res = understandUtterance({
      ctx: req.npc_ctx,
      level: req.level,
      transcript: req.transcript,
      quotaMeter: deps.quota,
      nowMs
    });

    if (res.source === 'llm' && deps.runWorkersAi) {
      const sanitized = buildSanitizedWorkersAiConverseInput({
        npc_ctx: req.npc_ctx,
        level: req.level,
        normalized: res.normalized,
        slots: res.slots
      });
      await deps.runWorkersAi('@cf/meta/llama-3.1-8b-instruct-fast', sanitized);
      deps.quota.consumeNeurons('anon', 10, 'llm');
    }

    return c.json(res);
  });

  app.post('/v1/converse/score', async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    const parsed = ScoreExtendedRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_score_request', issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;
    if (!req.strict_bank && req.target_text.trim() === '') {
      return c.json({ error: 'invalid_score_request', issues: [{ path: ['target_text'], message: 'required' }] }, 400);
    }
    const nowMs = deps.nowMs();
    const uttPrefix = `utt-${req.dialog_id}-`;

    // ECHO lowers the pass line, so the server checks the dialog really missed twice before (docs/04 4.1).
    let echo = false;
    if (req.echo) {
      const misses = deps.db.sql.get<{ n: number }>(
        'select count(*) as n from utterances where player_id = ? and stars = 0 and substr(id, 1, ?) = ?',
        [req.player_id, uttPrefix.length, uttPrefix]
      );
      echo = Number(misses?.n ?? 0) >= 2;
    }

    // Stars, price and item are decided here from the server bank (AGENTS 4.7, docs/04 4.2/4.6).
    const decision = decideConverseReward({
      ctx: req.npc_ctx,
      level: req.level,
      targetText: req.target_text,
      chosenStars: req.chosen_stars,
      transcript: req.transcript,
      hintLevel: req.hint_level,
      inputSource: req.stt_source,
      echo,
      strictBank: req.strict_bank
    });

    // One purchase per (dialog, item): trying again for more stars only lowers the price to the best grade
    // reached (the difference is refunded), and a resent request after a network error is not charged twice.
    // The item itself is written to the world's items table, keyed by the same purchase, so it cannot multiply.
    // Sentences with price 0 (barter, asking the way) sell nothing: the swap is the /trades settlement.
    let coinsDelta = 0;
    let grantedItem: string | null = null;
    let askedKey: string | undefined;
    let shortOfCoins = false;
    let readAloudPct = 0;
    let coinsTotal: number | undefined;
    const worldDo = deps.worlds.get(req.world_id);
    if (decision.stars > 0 && decision.bank) {
      const listPrice = decision.bank.entry.offers[0]!.price;
      if (listPrice <= 0) {
        askedKey = decision.bank.itemKey;
      } else if (worldDo) {
        const itemKey = decision.bank.itemKey;
        const ref = `${req.dialog_id}|${itemKey}`;
        const paidRow = worldDo.sql.get<{ paid: number; n: number }>(
          'select coalesce(-sum(delta), 0) as paid, count(*) as n from ledger where player = ? and ref = ?',
          [req.player_id, ref]
        );
        const alreadyBought = Number(paidRow?.n ?? 0) > 0;
        const paid = Number(paidRow?.paid ?? 0);
        // The world's own weekly price index (docs/09 P7), then for furniture today's read-aloud discount of its kind (docs/03 D13), bound to this purchase.
        const listedPrice = indexedPrice(decision.priceCoins, deps.priceIndex?.(req.world_id) ?? 1);
        const priced = priceWithReadAloud(deps.db, {
          playerId: req.player_id,
          itemKey,
          price: listedPrice,
          ref,
          nowMs,
          commit: false
        });
        const price = priced.price;
        readAloudPct = priced.discountPct;
        const reason = `purchase:${req.npc_ctx}:${itemKey}:${decision.stars}`;
        if (!alreadyBought) {
          if (worldDo.getPlayerBalance(req.player_id) >= price) {
            if (priced.discountPct > 0) {
              priceWithReadAloud(deps.db, { playerId: req.player_id, itemKey, price: listedPrice, ref, nowMs, commit: true });
            }
            coinsDelta = -price;
            worldDo.appendLedger(req.player_id, coinsDelta, reason, ref, nowMs);
            grantedItem = itemKey;
          } else {
            shortOfCoins = true;
          }
        } else {
          if (price < paid) {
            coinsDelta = paid - price;
            worldDo.appendLedger(req.player_id, coinsDelta, `${reason}:better_stars`, ref, nowMs);
          }
          grantedItem = itemKey;
        }
        if (grantedItem) {
          worldDo.grantOrSetItem(
            req.player_id,
            `buy-${ref}`,
            JSON.stringify({ kind: 'converse_purchase', item: itemKey, ctx: req.npc_ctx, stars: decision.stars }),
            'bag'
          );
        }
      }
    }
    // First-visit errand (docs/03 D1, WP-111): accept / buy the asked drink / hand it over, paid from the ledger.
    const errand =
      req.session_kind !== 'lesson'
        ? applyErrandStep(deps.db, worldDo, {
            playerId: req.player_id,
            ctx: req.npc_ctx,
            pass: decision.pass,
            askedKey,
            grantedItem,
            nowMs
          })
        : undefined;
    // Play modes (play.ts, docs/03 D2·D4, docs/04 4.2): exchange, interview, boss, customer. Other contexts never enter.
    const play = PLAY_CTXS.has(req.npc_ctx) && req.session_kind !== 'lesson'
      ? applyPlayStep(deps.db, worldDo, {
          playerId: req.player_id,
          worldId: req.world_id,
          dialogId: req.dialog_id,
          ctx: req.npc_ctx,
          pass: decision.pass,
          stars: decision.stars,
          askedKey,
          nowMs
        })
      : undefined;
    if (worldDo) coinsTotal = worldDo.getPlayerBalance(req.player_id);

    // A dialog can be scored several times in the same millisecond (retries, ECHO); the suffix keeps ids unique.
    const uttId = `${uttPrefix}${nowMs}-${crypto.randomUUID().slice(0, 8)}`;
    deps.db.logUtterance({
      id: uttId,
      player_id: req.player_id,
      world_id: req.world_id,
      session_id: req.session_id,
      session_kind: req.session_kind,
      ctx: req.npc_ctx,
      mode: req.mode,
      interlocutor: req.interlocutor,
      first_text: req.transcript,
      target_text: decision.targetText,
      final_text: req.transcript,
      words: req.transcript.trim().split(/\s+/).filter(Boolean).length,
      l1_words: 0,
      dur_ms: req.dur_ms,
      latency_ms: req.latency_ms,
      stars: decision.stars,
      hint_level: req.hint_level,
      attempts: req.attempts,
      score: decision.score,
      confidence: req.confidence,
      source: req.stt_source,
      // Audio is attached only by the server after an upload (voice.ts); a client-chosen key is never stored.
      audio_first: null,
      audio_final: null,
      created_at: nowMs
    });
    const audioUpload = deps.offerVoiceUpload
      ? await deps.offerVoiceUpload({ playerId: req.player_id, utteranceId: uttId, source: req.stt_source, nowMs })
      : null;

    if (decision.pass && req.session_kind !== 'lesson') {
      deps.db.recordSoloExpressionReuse(req.player_id, req.transcript, nowMs);
    }

    // docs/03 D8: a 2+ star sentence becomes a memory card bound to what it got (the bought item, or for price-0
    // sentences the thing it named). Nothing bought (short of coins) → nothing to wear out → no card.
    const cardItemId = grantedItem
      ? `buy-${req.dialog_id}|${grantedItem}`
      : askedKey && req.npc_ctx !== 'errand'
        ? `ask-${req.dialog_id}|${askedKey}`
        : null;
    const card =
      decision.pass && cardItemId && req.session_kind !== 'lesson'
        ? createMemoryCard(deps.db, {
            cardId: memoryCardId(req.dialog_id),
            playerId: req.player_id,
            utteranceId: uttId,
            itemId: cardItemId,
            origin: 'solo',
            stars: decision.stars,
            nowMs,
            world: worldDo
          })
        : null;

    const out = ScoreResponseSchema.parse({
      pass: decision.pass,
      score: decision.score,
      missed: decision.missed,
      granted: grantedItem
        ? {
            item_id: grantedItem,
            slot_or_socket: decision.bank?.entry.socket ?? 'slot_0',
            coins_delta: coinsDelta
          }
        : null,
      stars: decision.stars,
      target_stars: decision.targetStars,
      feedback_ko: converseFeedbackKo({ ...decision, inputSource: req.stt_source, shortOfCoins }),
      coins_total: coinsTotal,
      asked_key: askedKey,
      read_aloud_discount_pct: grantedItem && readAloudPct > 0 ? readAloudPct : undefined,
      errand,
      play,
      target_text: decision.targetText !== req.target_text ? decision.targetText : undefined,
      memory_card: card ? { id: card.id, next_review_at: new Date(card.next_review_at).toISOString() } : null,
      audio_upload: audioUpload ?? undefined
    });

    return c.json(out);
  });

  // Review signs (docs/09 P4) and review attempts (docs/03 D8). The platform fills player_id/world_id from the
  // student or device token; with the operator token they are read from the request.
  app.get('/v1/review/due', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    const worldId = c.req.query('world_id') ?? '';
    if (!playerId) return c.json({ error: 'player_id_required' }, 400);
    return c.json(listReviewSigns(deps.db, deps.worlds.get(worldId), playerId, deps.nowMs()));
  });

  // Read-aloud furniture discount (docs/03 D13): the build screen sends what the child read for one missing kind.
  app.post('/v1/furniture/read-aloud', async (c) => {
    const parsed = ReadAloudBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_read_aloud_request', issues: parsed.error.issues }, 400);
    const b = parsed.data;
    if (!isFurnitureKind(b.kind)) return c.json({ error: 'not_a_furniture_kind' }, 400);
    return c.json(
      claimReadAloud(deps.db, {
        playerId: b.player_id,
        worldId: b.world_id,
        kind: b.kind,
        transcript: b.transcript,
        sttSource: b.stt_source,
        confidence: b.confidence,
        durMs: b.dur_ms,
        level: b.level,
        nowMs: deps.nowMs()
      })
    );
  });

  // The child's first errand and activation clock (docs/03 D1, docs/09 첫 문장까지 시간). Created on first ask.
  app.get('/v1/errand', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    if (!playerId) return c.json({ error: 'player_id_required' }, 400);
    return c.json(getErrand(deps.db, playerId, deps.nowMs()));
  });

  app.get('/v1/furniture/discounts', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    if (!playerId) return c.json({ error: 'player_id_required' }, 400);
    return c.json(readAloudStatus(deps.db, playerId, deps.nowMs()));
  });

  // My plot (WP-201/205/207, docs/03 D13): the platform fills player_id/world_id from the child's token. The ops are
  // re-judged here by the same sim-core rules; the reply carries the authoritative inventory and a result per op.
  app.get('/v1/plot', (c) => {
    const playerId = c.req.query('player_id') ?? '';
    const world = deps.worlds.get(c.req.query('world_id') ?? '');
    if (!playerId || !world) return c.json({ error: 'plot_not_found' }, 404);
    return c.json(plotStoreFor(world, world.sql, playerId, deps.nowMs()).snapshot());
  });
  app.post('/v1/plot/ops', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { player_id?: unknown; world_id?: unknown; ops?: unknown; batch?: unknown } | null;
    const playerId = typeof body?.player_id === 'string' ? body.player_id : '';
    const world = deps.worlds.get(typeof body?.world_id === 'string' ? body.world_id : '');
    if (!playerId || !world) return c.json({ error: 'plot_not_found' }, 404);
    if (!Array.isArray(body?.ops) || body.ops.length === 0 || body.ops.length > OPS_PER_REQUEST_MAX) {
      return c.json({ error: 'invalid_plot_ops' }, 400);
    }
    const batch = typeof body.batch === 'string' ? body.batch : undefined;
    return c.json(plotStoreFor(world, world.sql, playerId, deps.nowMs()).applyOps(body.ops, deps.nowMs(), { batch }));
  });

  app.post('/v1/review/attempt', async (c) => {
    const parsed = ReviewAttemptBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid_review_request', issues: parsed.error.issues }, 400);
    const b = parsed.data;
    const r = attemptReview(deps.db, deps.worlds.get(b.world_id), {
      playerId: b.player_id,
      worldId: b.world_id,
      cardId: b.card_id,
      transcript: b.transcript,
      sttSource: b.stt_source,
      confidence: b.confidence,
      durMs: b.dur_ms,
      latencyMs: b.latency_ms,
      level: b.level,
      nowMs: deps.nowMs()
    });
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const { ok: _ok, ...body } = r;
    return c.json(body);
  });

  app.post('/v1/consents', async (c) => {
    const raw = await c.req.json();
    const parsed = ConsentUpdateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_consent_request', issues: parsed.error.issues }, 400);
    }
    const res = deps.db.setConsent({
      playerId: parsed.data.player_id,
      guardianId: parsed.data.guardian_id,
      scope: parsed.data.scope as ConsentScope,
      granted: parsed.data.granted,
      nowMs: deps.nowMs()
    });
    return c.json(res);
  });

  app.post('/v1/worlds/:id/edits', async (c) => {
    const worldDo = deps.worlds.get(c.req.param('id'));
    if (!worldDo) return c.json({ error: 'world_not_found' }, 404);

    const parsed = WorldEditsBodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_edits', issues: parsed.error.issues }, 400);

    const res = worldDo.applyBlockEditsAtomic({
      actorId: parsed.data.actor_id,
      isOwner: parsed.data.is_owner,
      permittedOnPlot: parsed.data.permitted_on_plot,
      edits: parsed.data.edits,
      nowMs: deps.nowMs()
    });
    return c.json(res, res.ok ? 200 : 403);
  });

  app.post('/v1/worlds/:id/objects/propose', async (c) => {
    const worldDo = deps.worlds.get(c.req.param('id'));
    if (!worldDo) return c.json({ error: 'world_not_found' }, 404);

    const parsed = WorldObjectProposeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_proposal' }, 400);

    const guardRes = inspectSpecG1ToG5(parsed.data.spec, {
      playerId: parsed.data.player_id,
      nowMs: deps.nowMs()
    });
    if (!guardRes.approved) {
      return c.json({ approved: false, stage: guardRes.stageFailed, reason: guardRes.reason }, 422);
    }

    const stored = worldDo.proposeAndStoreObject({
      id: parsed.data.id,
      playerId: parsed.data.player_id,
      rawSpec: parsed.data.spec,
      pos: parsed.data.pos,
      nowMs: deps.nowMs()
    });
    return c.json(stored, stored.approved ? 200 : 422);
  });

  app.post('/v1/worlds/:id/report-abuse', async (c) => {
    const worldId = c.req.param('id');
    const parsed = WorldAbuseReportSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_report' }, 400);

    const res = deps.db.reportWorldAbuse({
      worldId,
      reporterId: parsed.data.reporter_id,
      reason: parsed.data.reason,
      nowMs: deps.nowMs()
    });
    return c.json(res);
  });

  app.post('/v1/lessons/:id/window/audio', (c) => {
    const lessonDo = deps.lessons.get(c.req.param('id'));
    if (!lessonDo) return c.json({ error: 'lesson_not_found' }, 404);
    const res = lessonDo.handleLessonWindowAudioUplink();
    return c.json(res, 403);
  });

  app.get('/v1/dashboard/:playerId', (c) => {
    const playerId = c.req.param('playerId');
    const rows = deps.db.listUtterancesForPlayer(playerId);
    const metricInputs: UtteranceMetricInput[] = rows.map((r) => ({
      id: r.id,
      player_id: r.player_id,
      session_id: r.session_id,
      session_kind: r.session_kind,
      ctx: r.ctx,
      mode: r.mode,
      interlocutor: r.interlocutor,
      final_text: r.final_text,
      words: r.words,
      l1_words: r.l1_words,
      dur_ms: r.dur_ms,
      latency_ms: r.latency_ms,
      stars: r.stars,
      hint_level: r.hint_level,
      attempts: r.attempts,
      score: r.score,
      confidence: r.confidence,
      created_at: r.created_at
    }));
    const weekly = computeWeeklyMetrics(metricInputs);
    const baseline = computeTwoWeekBaseline([weekly]);
    const thinkSpeak = computeThinkAndSpeakIndex(metricInputs, baseline);
    const summary = buildFactualWeeklySummary({
      free_utterances: weekly.free_utterance_count,
      total_valid_utterances: weekly.total_valid_utterances,
      weekly_free_ratio: weekly.weekly_free_ratio,
      active_speaking_minutes: weekly.active_speaking_minutes,
      mean_words_per_utterance: weekly.mean_words_per_utterance,
      think_speak_index: thinkSpeak.index
    });
    return c.json({
      player_id: playerId,
      weekly,
      think_and_speak: thinkSpeak,
      summary,
      consents: deps.db.listConsents(playerId)
    });
  });

  app.post('/v1/reports/weekly', async (c) => {
    const body = (await c.req.json()) as {
      id: string;
      player_id: string;
      week: string;
      draft_body?: string;
      share_token: string;
    };
    const rows = deps.db.listUtterancesForPlayer(body.player_id);
    const metricInputs: UtteranceMetricInput[] = rows.map((r) => ({
      id: r.id,
      player_id: r.player_id,
      session_id: r.session_id,
      session_kind: r.session_kind,
      ctx: r.ctx,
      mode: r.mode,
      interlocutor: r.interlocutor,
      final_text: r.final_text,
      words: r.words,
      l1_words: r.l1_words,
      dur_ms: r.dur_ms,
      latency_ms: r.latency_ms,
      stars: r.stars,
      hint_level: r.hint_level,
      attempts: r.attempts,
      score: r.score,
      confidence: r.confidence,
      created_at: r.created_at
    }));
    const weekly = computeWeeklyMetrics(metricInputs);
    const thinkSpeak = computeThinkAndSpeakIndex(metricInputs, computeTwoWeekBaseline([]));
    const facts = {
      free_utterances: weekly.free_utterance_count,
      total_valid_utterances: weekly.total_valid_utterances,
      weekly_free_ratio: weekly.weekly_free_ratio,
      active_speaking_minutes: weekly.active_speaking_minutes,
      mean_words_per_utterance: weekly.mean_words_per_utterance,
      think_speak_index: thinkSpeak.index
    };
    const verified = verifyOrReplaceReportBody(facts, body.draft_body ?? '');
    deps.db.saveReport({
      id: body.id,
      playerId: body.player_id,
      kind: 'weekly',
      refId: body.week,
      facts,
      body: verified.body,
      clips: [],
      shareToken: body.share_token,
      nowMs: deps.nowMs()
    });
    return c.json({ ok: true, replaced: verified.replaced, reasons: verified.reasons, body: verified.body });
  });

  app.get('/v1/trades/scenarios', (c) =>
    c.json({
      scenarios: TEACHER_STUDENT_TRADE_SCENARIOS,
      lesson_stages: LESSON_ARC_STAGE_GUIDES
    })
  );

  app.post('/v1/worlds/:id/trades', async (c) => {
    const worldDo = deps.worlds.get(c.req.param('id'));
    if (!worldDo) return c.json({ error: 'world_not_found' }, 404);

    const parsed = WorldTradeBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: 'invalid_trade_request', issues: parsed.error.issues }, 400);
    }

    const req = parsed.data;
    const nowMs = deps.nowMs();
    const scored = scoreUtterance({
      targetText: req.target_text,
      spokenTranscript: req.student_transcript,
      level: req.level,
      hintLevel: req.stars === 3 ? 'none' : 'full'
    });

    const tx = worldDo.executeTradeAtomic({
      tradeId: req.trade_id,
      studentId: req.student_id,
      teacherId: req.teacher_id,
      studentGiveItemId: req.student_give_item_id,
      teacherGiveItemId: req.teacher_give_item_id,
      baseValueCoins: req.base_value_coins,
      stars: req.stars,
      teacherTranscript: req.teacher_transcript,
      studentTranscript: req.student_transcript,
      studentScorePass: scored.pass,
      nowMs
    });

    if (!tx.ok) {
      return c.json(
        {
          ok: false,
          reason: tx.reason ?? 'trade_rejected',
          score: scored.score,
          missed: scored.missed
        },
        422
      );
    }

    deps.db.logUtterance({
      id: `utt-trade-${req.trade_id}-${nowMs}`,
      player_id: req.student_id,
      world_id: c.req.param('id'),
      session_id: req.lesson_id ?? `trade-${req.trade_id}`,
      session_kind: req.lesson_id ? 'lesson' : 'multi',
      ctx: 'trade',
      mode: req.stars === 3 ? 'free' : 'read',
      interlocutor: 'teacher',
      first_text: req.student_transcript,
      target_text: req.target_text,
      final_text: req.student_transcript,
      words: req.student_transcript.trim().split(/\s+/).filter(Boolean).length,
      l1_words: 0,
      dur_ms: 3000,
      latency_ms: 1200,
      stars: req.stars,
      hint_level: req.stars === 3 ? 'none' : 'full',
      attempts: 1,
      score: scored.score,
      confidence: 0.96,
      source: 'trade',
      audio_first: null,
      audio_final: null,
      created_at: nowMs
    });

    if (req.lesson_id) {
      deps.db.registerLessonExpression({
        id: `expr-${req.trade_id}`,
        playerId: req.student_id,
        lemmaKey: req.pin_expression ?? req.target_text,
        lessonId: req.lesson_id,
        nowMs
      });
    }

    return c.json({
      ok: true,
      fee_coins: tx.feeCoins,
      bonus_granted: tx.bonusGranted,
      swapped_item_ids: tx.swappedItemIds,
      score: scored.score
    });
  });

  app.post('/v1/lessons/:id/complete-and-send-report', async (c) => {
    const lessonId = c.req.param('id');
    const parsed = CompleteLessonSendReportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: 'invalid_lesson_report_request', issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;
    const nowMs = deps.nowMs();

    const rows = deps.db.listUtterancesForPlayer(req.player_id);
    const metricInputs: UtteranceMetricInput[] = rows.map((r) => ({
      id: r.id,
      player_id: r.player_id,
      session_id: r.session_id,
      session_kind: r.session_kind,
      ctx: r.ctx,
      mode: r.mode,
      interlocutor: r.interlocutor,
      final_text: r.final_text,
      words: r.words,
      l1_words: r.l1_words,
      dur_ms: r.dur_ms,
      latency_ms: r.latency_ms,
      stars: r.stars,
      hint_level: r.hint_level,
      attempts: r.attempts,
      score: r.score,
      confidence: r.confidence,
      created_at: r.created_at
    }));
    const weekly = computeWeeklyMetrics(metricInputs);
    const thinkSpeak = computeThinkAndSpeakIndex(metricInputs, computeTwoWeekBaseline([weekly]));
    const minutes = deps.db.listLessonMinutes(lessonId);
    const lessonStats = computeLessonMetrics(lessonId, minutes, metricInputs);
    const expressions = deps.db.listExpressionsForPlayer(req.player_id);
    const contribution = computeTeacherContribution(
      expressions.map((e) => ({
        id: e.id,
        player_id: e.player_id,
        lemma_key: e.lemma_key,
        first_seen_at: e.first_seen_at,
        born_in: e.born_in,
        lesson_id: e.lesson_id,
        reuse_solo: e.reuse_solo,
        last_used_at: e.last_used_at
      })),
      // Lesson-born memory cards feed the 35-day retention rate (WP-310).
      listMemoryCards(deps.db, req.player_id).map((m) => ({
        id: m.id,
        player_id: m.player_id,
        origin: m.origin,
        lesson_id: null,
        box: Number(m.box),
        next_review_at: Number(m.next_review_at),
        lapses: Number(m.lapses),
        created_at: Number(
          deps.db.sql.get<{ at: number }>('select created_at as at from utterances where id = ?', [m.utterance_id])?.at ?? 0
        ),
        mastered_at: m.mastered_at === null ? null : Number(m.mastered_at)
      })),
      nowMs
    );

    const facts = {
      free_utterances: weekly.free_utterance_count,
      total_valid_utterances: weekly.total_valid_utterances,
      weekly_free_ratio: weekly.weekly_free_ratio,
      active_speaking_minutes: weekly.active_speaking_minutes,
      mean_words_per_utterance: weekly.mean_words_per_utterance,
      think_speak_index: thinkSpeak.index,
      new_expressions: contribution.lesson_born_expressions,
      solo_reused_expressions: Math.round(
        contribution.lesson_born_expressions * contribution.solo_transfer_14d_rate
      ),
      ...(req.lesson_extra ?? {}),
      ...(req.lesson_facts ? { lesson: req.lesson_facts } : {})
    };
    const checked = verifyOrReplaceReportBody(facts, req.draft_body);
    // A lesson report's fallback sentence is about this lesson (parent-report.ts lessonSummaryKo, same numbers as
    // facts.lesson), not the weekly template.
    const lessonSummary = typeof req.lesson_facts?.summary_ko === 'string' ? req.lesson_facts.summary_ko : null;
    const verified = checked.replaced && lessonSummary ? { ...checked, body: lessonSummary } : checked;
    const shareUrl = req.share_url ?? `/report?token=${req.share_token}`;

    const delivery = deps.db.createAndDeliverParentReport({
      id: req.report_id,
      playerId: req.player_id,
      guardianId: req.guardian_id,
      kind: 'lesson',
      refId: lessonId,
      facts,
      body: verified.body,
      clips: req.clips,
      shareToken: req.share_token,
      shareUrl,
      teacherComment: req.teacher_comment,
      nextLessonAt: req.next_lesson_at,
      nowMs
    });

    return c.json({
      ok: true,
      delivery_status: delivery.status,
      share_token: delivery.share_token,
      share_url: delivery.share_url,
      replaced: verified.replaced,
      reasons: verified.reasons,
      facts,
      lesson_metrics: lessonStats,
      teacher_contribution: contribution,
      body: verified.body,
      teacher_comment: delivery.teacher_comment,
      next_lesson_at: delivery.next_lesson_at
    });
  });

  app.post('/v1/reports/reminders/run', (c) => {
    const res = deps.db.processPendingReportReminders(deps.nowMs());
    return c.json(res);
  });

  app.get('/v1/reports/:token', (c) => {
    const report = deps.db.openSharedReport(c.req.param('token'), deps.nowMs());
    if (!report) return c.json({ error: 'report_not_found' }, 404);
    return c.json(report);
  });

  return app;
}
