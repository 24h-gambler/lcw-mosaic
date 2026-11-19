import { z } from 'zod';
import { HexColorSchema, ItemSpecV2Schema, SocketIdSchema } from './specs.js';

export const LevelSchema = z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
export type Level = z.infer<typeof LevelSchema>;

export const UtteranceModeSchema = z.enum(['free', 'guided', 'read', 'recall']);
export type UtteranceMode = z.infer<typeof UtteranceModeSchema>;

export const InterlocutorSchema = z.enum(['npc', 'teacher', 'peer', 'self']);
export type Interlocutor = z.infer<typeof InterlocutorSchema>;

export const SessionKindSchema = z.enum(['solo', 'multi', 'lesson']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const HintLevelSchema = z.enum(['full', 'keyword', 'initial', 'picture', 'none']);
export type HintLevel = z.infer<typeof HintLevelSchema>;

export const NpcContextSchema = z.enum([
  'cafe',
  'boutique',
  'makers_lab',
  'exchange',
  'interview',
  'boss',
  'customer',
  'lottery',
  'court',
  'repair_shop',
  'resident',
  'trade_shop',
  'guide',
  'errand'
]);
export type NpcContext = z.infer<typeof NpcContextSchema>;

export const SttMetaSchema = z
  .object({
    source: z.enum(['device', 'workers_ai', 'browser', 'keyboard', 'board']),
    confidence: z.number().finite().min(0).max(1)
  })
  .strict();

export const UnderstandRequestSchema = z
  .object({
    dialog_id: z.string().min(1).max(64),
    npc_ctx: NpcContextSchema,
    level: LevelSchema,
    transcript: z.string().max(1000),
    stt: SttMetaSchema
  })
  .strict();
export type UnderstandRequest = z.infer<typeof UnderstandRequestSchema>;

export const OfferSchema = z
  .object({
    stars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().min(1).max(300),
    price: z.number().int().min(0),
    bonus: z.string().min(1).max(64).nullable()
  })
  .strict();
export type Offer = z.infer<typeof OfferSchema>;

export const LegacyItemPreviewSchema = z
  .object({
    base_mesh: z.string().min(1).max(64),
    socket: SocketIdSchema,
    shader_params: z
      .object({
        primary_color: HexColorSchema
      })
      .strict()
  })
  .strict();

/** docs/04 4.5: preview is a v2 assembly draft; the legacy bank-mesh preview stays accepted for the bank path. */
export const ItemPreviewSchema = z.union([ItemSpecV2Schema, LegacyItemPreviewSchema]);

export const SlotsSchema = z
  .object({
    item: z.string().min(1).max(64),
    color: z.string().min(1).max(32).nullable().optional(),
    modifiers: z.array(z.string().min(1).max(32)).default([]),
    quantity: z.number().int().min(1).max(99).optional(),
    reason: z.string().min(1).max(120).nullable().optional()
  })
  .strict();
export type Slots = z.infer<typeof SlotsSchema>;

export const UnderstandResponseSchema = z
  .object({
    normalized: z.string().min(1).max(300),
    intent: z.string().min(1).max(64),
    slots: SlotsSchema,
    offers: z.array(OfferSchema).length(3),
    hint_tags: z.array(z.string().min(1).max(48)).max(8),
    item_spec_preview: ItemPreviewSchema.nullable(),
    source: z.enum(['bank', 'cache', 'llm', 'rule', 'board'])
  })
  .strict();
export type UnderstandResponse = z.infer<typeof UnderstandResponseSchema>;

export const ScoreRequestSchema = z
  .object({
    dialog_id: z.string().min(1).max(64),
    chosen_stars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    hint_level: HintLevelSchema,
    transcript: z.string().max(1000),
    audio_key: z.string().min(1).max(200).optional()
  })
  .strict();
export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;

export const VoiceUploadOfferSchema = z
  .object({
    token: z.string().regex(/^[0-9a-f]{48}$/),
    max_bytes: z.number().int().positive(),
    expires_at: z.number().int().positive()
  })
  .strict();
export type VoiceUploadOffer = z.infer<typeof VoiceUploadOfferSchema>;

export const ScoreResponseSchema = z
  .object({
    pass: z.boolean(),
    score: z.number().finite().min(0).max(1),
    missed: z.array(z.string()),
    granted: z
      .object({
        item_id: z.string().min(1),
        slot_or_socket: z.string().min(1),
        coins_delta: z.number().int(),
        /** Where the thing landed: the bag while it has a free slot, else the home chest (docs/03 D13). */
        location: z.enum(['bag', 'chest']).optional()
      })
      .strict()
      .nullable(),
    memory_card: z
      .object({
        id: z.string().min(1),
        next_review_at: z.string().min(1)
      })
      .strict()
      .nullable(),
    // Server-decided values the dialog shows (docs/19 DialogResult); optional for older callers.
    stars: z.number().int().min(0).max(3).optional(),
    target_stars: z.number().int().min(1).max(3).optional(),
    feedback_ko: z.string().min(1).max(200).optional(),
    coins_total: z.number().int().optional(),
    /** Coins this answer earned (a passed solo sentence, shop.ts creditSoloEarn); absent when none. */
    coins_earned: z.number().int().positive().optional(),
    /** Price-0 sentences: what the child asked for (barter good, place to show); nothing is sold or granted. */
    asked_key: z.string().min(1).optional(),
    /** Furniture bought with today's read-aloud discount of its kind (docs/03 D13): the discount that was applied. */
    read_aloud_discount_pct: z.number().min(0).max(1).optional(),
    /** First-visit errand (docs/03 D1): its state after this sentence, and the coins it paid (hand-over only). */
    errand: z.object({ state: z.enum(['offered', 'accepted', 'carrying', 'done']), reward_coins: z.number().int().optional() }).optional(),
    /** Free talk without a chosen sentence: the bank sentence the server matched and scored. */
    target_text: z.string().min(1).optional(),
    /**
     * Voice clip upload (docs/19 3, edge voice.ts): only for a speech turn of a child whose guardian turned
     * voice_store on. POST the recorded turn to /v1/voice/upload/<token> once, before expires_at.
     */
    audio_upload: VoiceUploadOfferSchema.optional()
  })
  .strict();
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;

/**
 * Contract for external/Workers AI LLM invocation (AGENTS.md 4.6 & docs/04 4.7).
 * Strictly forbids player_id, account_id, nickname, oauth_sub, or audio data.
 */
export const LlmConverseInputSchema = z
  .object({
    npc_ctx: NpcContextSchema,
    level: LevelSchema,
    normalized: z.string().min(1).max(300),
    slots: SlotsSchema,
    allowed_meshes: z.array(z.string().min(1)).max(64),
    allowed_tags: z.array(z.string().min(1)).max(64)
  })
  .strict();
export type LlmConverseInput = z.infer<typeof LlmConverseInputSchema>;
