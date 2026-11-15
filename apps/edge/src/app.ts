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
import { QuotaMeter } from '@lcw/quota';
import {
  buildFactualWeeklySummary,
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

  app.get('/v1/reports/:token', (c) => {
    const report = deps.db.openSharedReport(c.req.param('token'), deps.nowMs());
    if (!report) return c.json({ error: 'report_not_found' }, 404);
    return c.json(report);
  });

  return app;
}
