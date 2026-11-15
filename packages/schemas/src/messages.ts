import { z } from 'zod';
import { AnySpecV2Schema } from './specs.js';

export const ClientMoveMsgSchema = z
  .object({
    type: z.literal('move'),
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    vx: z.number().finite(),
    vy: z.number().finite(),
    vz: z.number().finite(),
    yaw: z.number().finite(),
    pitch: z.number().finite(),
    pose: z.enum(['idle', 'walk', 'run', 'jump', 'fall', 'talk'])
  })
  .strict();

export const ClientBlockEditMsgSchema = z
  .object({
    type: z.literal('block.edit'),
    seq: z.number().int().nonnegative(),
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

export const ClientUseSlotMsgSchema = z
  .object({
    type: z.literal('use.slot'),
    slot: z.number().int().min(0).max(4),
    target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional()
  })
  .strict();

export const ClientCombatHitMsgSchema = z
  .object({
    type: z.literal('combat.hit'),
    target_id: z.string().min(1),
    weapon_id: z.string().min(1),
    at_ms: z.number().int().nonnegative()
  })
  .strict();

export const ClientObjectProposeMsgSchema = z
  .object({
    type: z.literal('object.propose'),
    spec: AnySpecV2Schema,
    guard_summary: z
      .object({
        stages_passed: z.array(z.string()),
        sim_ticks: z.number().int().min(0)
      })
      .strict()
  })
  .strict();

export const ClientSayMsgSchema = z
  .object({
    type: z.literal('say'),
    text: z.string().min(1).max(200),
    target_lang_ratio: z.number().finite().min(0.7).max(1)
  })
  .strict();

export const ClientRoomMessageSchema = z.discriminatedUnion('type', [
  ClientMoveMsgSchema,
  ClientBlockEditMsgSchema,
  ClientUseSlotMsgSchema,
  ClientCombatHitMsgSchema,
  ClientObjectProposeMsgSchema,
  ClientSayMsgSchema
]);
export type ClientRoomMessage = z.infer<typeof ClientRoomMessageSchema>;

export const ServerSnapshotMsgSchema = z
  .object({
    type: z.literal('snapshot'),
    tick: z.number().int().nonnegative(),
    clock_min: z.number().int().min(0).max(1439),
    weather: z.enum(['clear', 'rain', 'snow', 'wind', 'neon_mist']),
    players: z.array(
      z
        .object({
          id: z.string().min(1),
          x: z.number().finite(),
          y: z.number().finite(),
          z: z.number().finite(),
          yaw: z.number().finite()
        })
        .strict()
    )
  })
  .strict();

export const ServerBlockConfirmMsgSchema = z
  .object({
    type: z.literal('block.confirm'),
    seq: z.number().int().nonnegative(),
    rev: z.number().int().nonnegative()
  })
  .strict();

export const ServerBlockRejectMsgSchema = z
  .object({
    type: z.literal('block.reject'),
    seq: z.number().int().nonnegative(),
    reason: z.string().min(1)
  })
  .strict();

export const ServerInventoryPatchMsgSchema = z
  .object({
    type: z.literal('inventory.patch'),
    slot: z.number().int().min(0).max(4),
    item_id: z.string().nullable(),
    count: z.number().int().min(0)
  })
  .strict();

export const ServerLedgerPatchMsgSchema = z
  .object({
    type: z.literal('ledger.patch'),
    delta: z.number().int(),
    balance: z.number().int(),
    reason: z.string().min(1)
  })
  .strict();

export const ServerObjectCommitMsgSchema = z
  .object({
    type: z.literal('object.commit'),
    object_id: z.string().min(1),
    state: z.enum(['active', 'quarantined'])
  })
  .strict();

export const ServerObjectRejectMsgSchema = z
  .object({
    type: z.literal('object.reject'),
    reason: z.string().min(1),
    stage: z.string().min(1)
  })
  .strict();

export const ServerEventMsgSchema = z
  .object({
    type: z.literal('event'),
    kind: z.enum(['siren', 'summon', 'review_due', 'director_event']),
    payload: z.record(z.string(), z.unknown())
  })
  .strict();

export const ServerRoomMessageSchema = z.discriminatedUnion('type', [
  ServerSnapshotMsgSchema,
  ServerBlockConfirmMsgSchema,
  ServerBlockRejectMsgSchema,
  ServerInventoryPatchMsgSchema,
  ServerLedgerPatchMsgSchema,
  ServerObjectCommitMsgSchema,
  ServerObjectRejectMsgSchema,
  ServerEventMsgSchema
]);
export type ServerRoomMessage = z.infer<typeof ServerRoomMessageSchema>;

/**
 * Text-only status line for the parent lesson window (docs/08 P04, WP-307).
 * No video or audio frames: LessonDO sends these few strings every ~10 seconds.
 */
export const LESSON_WINDOW_SCENE_ICONS = ['cafe', 'plaza', 'boutique', 'makers_lab', 'dungeon', 'home', 'shop', 'hill', 'build'] as const;

export const LessonWindowStatusSchema = z
  .object({
    type: z.literal('lesson.window_status'),
    lesson_id: z.string().min(1),
    place: z.string().min(1).max(40),
    situation: z.string().min(1).max(80),
    target_sentence: z.string().max(200).nullable(),
    scene_icon: z.enum(LESSON_WINDOW_SCENE_ICONS),
    sent_at: z.number().int().nonnegative()
  })
  .strict();
export type LessonWindowStatus = z.infer<typeof LessonWindowStatusSchema>;
