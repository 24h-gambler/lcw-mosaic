import { z } from 'zod';

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected #RRGGBB hex color');

export const SocketIdSchema = z.enum([
  'Head_Socket',
  'Body_Socket',
  'Back_Socket',
  'Feet_Socket',
  'RightHand_Socket',
  'Mount_Socket'
]);
export type SocketId = z.infer<typeof SocketIdSchema>;

export const Vec3TupleSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3Tuple = z.infer<typeof Vec3TupleSchema>;

export const ScaleTupleSchema = z.tuple([
  z.number().finite().min(0.5).max(1.5),
  z.number().finite().min(0.5).max(1.5),
  z.number().finite().min(0.5).max(1.5)
]);

export const PartPlacementSchema = z
  .object({
    id: z.string().min(1).max(64),
    pos: z.tuple([
      z.number().finite().min(-2).max(2),
      z.number().finite().min(-2).max(2),
      z.number().finite().min(-2).max(2)
    ]),
    scale: ScaleTupleSchema.optional(),
    color: HexColorSchema,
    glow: z.number().finite().min(0).max(1).optional()
  })
  .strict();
export type PartPlacement = z.infer<typeof PartPlacementSchema>;

export const PowerBudgetSchema = z
  .object({
    limit: z.number().int().min(1).max(10),
    used: z.number().int().min(0).max(10)
  })
  .strict()
  .refine((p) => p.used <= p.limit, {
    message: 'power.used must not exceed power.limit'
  });

export const ItemSpecV2Schema = z
  .object({
    kind: z.literal('item'),
    v: z.literal(2),
    name: z.string().min(1).max(64),
    socket: SocketIdSchema,
    parts: z.array(PartPlacementSchema).min(1).max(6),
    tags: z.array(z.string().min(1).max(48)).max(8),
    tier: z.number().int().min(1).max(4),
    power: PowerBudgetSchema,
    stack: z.number().int().min(1).max(64).optional()
  })
  .strict();
export type ItemSpecV2 = z.infer<typeof ItemSpecV2Schema>;

export const ItemSpecV1Schema = z
  .object({
    kind: z.literal('item'),
    v: z.literal(1),
    name: z.string().min(1).max(64),
    socket: SocketIdSchema,
    parts: z.array(PartPlacementSchema).min(1).max(6),
    tags: z.array(z.string().min(1).max(48)).max(8).default([]),
    tier: z.number().int().min(1).max(4).default(1),
    power_limit: z.number().int().min(1).max(10).default(6),
    power_used: z.number().int().min(0).max(10).default(0)
  })
  .strict();
export type ItemSpecV1 = z.infer<typeof ItemSpecV1Schema>;

export const LegacyItemSpecSchema = z
  .object({
    base_mesh: z.string().min(1).max(64),
    socket: SocketIdSchema,
    tier: z.number().int().min(1).max(4),
    shader_params: z
      .object({
        primary_color: HexColorSchema,
        pattern: z.string().min(1).max(64).optional(),
        emission_glow: z.number().finite().min(0).max(1).optional(),
        scale_multiplier: z.number().finite().min(0.5).max(1.5).optional()
      })
      .strict(),
    physics_tags: z.array(z.string().min(1).max(48)).max(8),
    power_budget: PowerBudgetSchema,
    durability_max: z.number().int().min(1).max(1000),
    memory_card_id: z.string().min(1).max(64).optional()
  })
  .strict();
export type LegacyItemSpec = z.infer<typeof LegacyItemSpecSchema>;

export const SkinLayerSchema = z
  .object({
    slot: z.enum(['base', 'pattern', 'decal', 'trim']),
    color: HexColorSchema,
    pattern: z.string().min(1).max(64).optional(),
    decal: z.string().min(1).max(64).optional(),
    length: z.enum(['short', 'medium', 'long']).optional()
  })
  .strict();

export const SkinSpecSchema = z
  .object({
    kind: z.literal('skin'),
    v: z.literal(2),
    name: z.string().min(1).max(64),
    base_costume: z.string().min(1).max(64),
    layers: z.array(SkinLayerSchema).min(1).max(4)
  })
  .strict();
export type SkinSpec = z.infer<typeof SkinSpecSchema>;

export const PetArchetypeSchema = z.enum([
  'slime',
  'fox',
  'owl',
  'robot',
  'turtle',
  'cloud_puff',
  'pony',
  'drone'
]);

export const PetSpecSchema = z
  .object({
    kind: z.literal('pet'),
    v: z.literal(2),
    name: z.string().min(1).max(64),
    archetype: PetArchetypeSchema,
    scale: z.number().finite().min(0.5).max(1.5),
    color: HexColorSchema,
    behavior_tags: z.array(z.string().min(1).max(48)).min(1).max(4)
  })
  .strict();
export type PetSpec = z.infer<typeof PetSpecSchema>;

export const QuestTemplateSchema = z.enum([
  'delivery',
  'collect',
  'explore',
  'build_challenge',
  'persuade',
  'subjugate'
]);

export const QuestSpecSchema = z
  .object({
    kind: z.literal('quest'),
    v: z.literal(2),
    name: z.string().min(1).max(80),
    template: QuestTemplateSchema,
    target: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(50),
    location: z.string().min(1).max(64),
    reward_coins: z.number().int().min(10).max(500)
  })
  .strict();
export type QuestSpec = z.infer<typeof QuestSpecSchema>;

export const RuleSpecSchema = z
  .object({
    kind: z.literal('rule'),
    v: z.literal(2),
    name: z.string().min(1).max(64),
    scope: z.enum(['plot', 'arena', 'world', 'plaza', 'city']),
    target_bounds: z
      .object({
        x0: z.number().int(),
        x1: z.number().int(),
        z0: z.number().int(),
        z1: z.number().int()
      })
      .strict()
      .optional(),
    gravity: z.number().finite().min(0.5).max(1.5).default(1.0),
    pvp: z.boolean().default(false),
    time_speed: z.number().finite().min(0.5).max(2.0).default(1.0)
  })
  .strict();
export type RuleSpec = z.infer<typeof RuleSpecSchema>;

export const AnySpecV2Schema = z.discriminatedUnion('kind', [
  ItemSpecV2Schema,
  SkinSpecSchema,
  PetSpecSchema,
  QuestSpecSchema,
  RuleSpecSchema
]);
export type AnySpecV2 = z.infer<typeof AnySpecV2Schema>;

export function migrateSpecToV2(raw: unknown): ItemSpecV2 {
  const v2 = ItemSpecV2Schema.safeParse(raw);
  if (v2.success) return v2.data;

  const v1 = ItemSpecV1Schema.parse(raw);
  return ItemSpecV2Schema.parse({
    kind: 'item',
    v: 2,
    name: v1.name,
    socket: v1.socket,
    parts: v1.parts,
    tags: v1.tags,
    tier: v1.tier,
    power: {
      limit: v1.power_limit,
      used: Math.min(v1.power_used, v1.power_limit)
    }
  });
}

export const BiomeManifestSchema = z
  .object({
    id: z.string().min(1),
    climate: z
      .object({
        type: z.enum(['rain', 'hot', 'cold', 'temperate', 'humid', 'neon']),
        temp: z.enum(['hot', 'mild', 'warm', 'cold']),
        gauge_mods: z.record(z.string(), z.number().finite().positive())
      })
      .strict(),
    requires_gear: z.array(z.string().min(1)),
    penalty_without_gear: z.record(z.string(), z.number().finite().positive()),
    services: z.array(z.enum(['cafe', 'boutique', 'makers_lab', 'exchange'])).min(1),
    service_skins: z.record(z.string(), z.string()),
    side_job: z.string().min(1),
    ore_table: z.record(z.string(), z.number().finite().min(0).max(1)),
    underground_setpiece: z.string().min(1),
    sky_feature: z.string().min(1),
    vocab_themes: z.array(z.string().min(1)).min(1),
    ambient: z
      .object({
        skybox: z.string().min(1),
        bgm: z.string().min(1)
      })
      .strict()
  })
  .strict();
export type BiomeManifest = z.infer<typeof BiomeManifestSchema>;
