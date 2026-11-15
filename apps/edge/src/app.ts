import { Hono } from 'hono';
import { z } from 'zod';
import {
  LlmConverseInputSchema,
  ScoreRequestSchema,
  ScoreResponseSchema,
  UnderstandRequestSchema,
  type LlmConverseInput
} from '@lcw/schemas';
import { scoreUtterance, understandUtterance } from '@lcw/converse';
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

export interface EdgeRuntimeDeps {
  db: EdgePlatformDb;
  worlds: Map<string, WorldDO>;
  lessons: Map<string, LessonDO>;
  quota: QuotaMeter;
  nowMs: () => number;
  runWorkersAi?: (model: string, input: LlmConverseInput) => Promise<unknown>;
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
    share_token: z.string().min(4),
    share_url: z.string().min(1).optional(),
    clips: z.array(z.unknown()).default([])
  })
  .strict();

const ScoreExtendedRequestSchema = ScoreRequestSchema.extend({
  player_id: z.string().min(1),
  world_id: z.string().min(1),
  session_id: z.string().min(1),
  session_kind: z.enum(['solo', 'multi', 'lesson']).default('solo'),
  npc_ctx: z.string().min(1),
  level: z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']).default('L2'),
  target_text: z.string().min(1),
  mode: z.enum(['free', 'guided', 'read', 'recall']).default('free'),
  interlocutor: z.enum(['npc', 'teacher', 'peer', 'self']).default('npc'),
  price: z.number().int().min(0).default(20),
  item_id: z.string().min(1).default('honey_tea'),
  latency_ms: z.number().int().min(0).default(1500),
  dur_ms: z.number().int().min(0).default(3000),
  confidence: z.number().finite().min(0).max(1).default(0.95)
}).strict();

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
    const raw = await c.req.json();
    const parsed = ScoreExtendedRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_score_request', issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;
    const nowMs = deps.nowMs();

    const scored = scoreUtterance({
      targetText: req.target_text,
      spokenTranscript: req.transcript,
      level: req.level,
      hintLevel: req.hint_level
    });

    let coinsDelta = 0;
    let grantedItem: string | null = null;
    const worldDo = deps.worlds.get(req.world_id);
    if (scored.pass && worldDo) {
      const bal = worldDo.getPlayerBalance(req.player_id);
      if (bal >= req.price) {
        coinsDelta = -req.price;
        worldDo.appendLedger(
          req.player_id,
          coinsDelta,
          `purchase:${req.npc_ctx}`,
          req.dialog_id,
          nowMs
        );
        grantedItem = req.item_id;
      }
    }

    const uttId = `utt-${req.dialog_id}-${nowMs}`;
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
      target_text: req.target_text,
      final_text: req.transcript,
      words: req.transcript.trim().split(/\s+/).filter(Boolean).length,
      l1_words: 0,
      dur_ms: req.dur_ms,
      latency_ms: req.latency_ms,
      stars: scored.pass ? req.chosen_stars : 0,
      hint_level: req.hint_level,
      attempts: 1,
      score: scored.score,
      confidence: req.confidence,
      source: 'workers',
      audio_first: req.audio_key ?? null,
      audio_final: req.audio_key ?? null,
      created_at: nowMs
    });

    if (scored.pass && req.session_kind !== 'lesson') {
      deps.db.recordSoloExpressionReuse(req.player_id, req.transcript, nowMs);
    }

    const out = ScoreResponseSchema.parse({
      pass: scored.pass,
      score: scored.score,
      missed: scored.missed,
      granted:
        scored.pass && grantedItem
          ? {
              item_id: grantedItem,
              slot_or_socket: 'slot_0',
              coins_delta: coinsDelta
            }
          : null,
      memory_card: scored.pass
        ? {
            id: `card-${req.dialog_id}`,
            next_review_at: new Date(nowMs + 86_400_000).toISOString()
          }
        : null
    });

    return c.json(out);
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
      [],
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
      )
    };
    const verified = verifyOrReplaceReportBody(facts, req.draft_body);
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
