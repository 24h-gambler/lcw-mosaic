import { z } from 'zod';
import { HexColorSchema, SocketIdSchema } from './specs.js';

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
  'resident'
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
    transcript: z.string().max(400),
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

export const ItemPreviewSchema = z
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
    transcript: z.string().max(400),
    audio_key: z.string().min(1).max(200).optional()
  })
  .strict();
export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;

export const ScoreResponseSchema = z
  .object({
    pass: z.boolean(),
    score: z.number().finite().min(0).max(1),
    missed: z.array(z.string()),
    granted: z
      .object({
        item_id: z.string().min(1),
        slot_or_socket: z.string().min(1),
        coins_delta: z.number().int()
      })
      .strict()
      .nullable(),
    memory_card: z
      .object({
        id: z.string().min(1),
        next_review_at: z.string().min(1)
      })
      .strict()
      .nullable()
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
