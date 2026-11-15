import { describe, expect, it } from 'vitest';
import {
  BiomeManifestSchema,
  ClientRoomMessageSchema,
  ItemSpecV2Schema,
  LegacyItemSpecSchema,
  LlmConverseInputSchema,
  migrateSpecToV2,
  ScoreRequestSchema,
  ScoreResponseSchema,
  ServerRoomMessageSchema,
  UnderstandRequestSchema,
  UnderstandResponseSchema
} from '../index.js';

describe('@lcw/schemas WP-002 acceptance', () => {
  it('validates the biome manifest JSON example from docs/03 3.4', () => {
    const london = {
      id: 'biome.london_rain',
      climate: { type: 'rain', temp: 'mild', gauge_mods: { thirst: 0.8 } },
      requires_gear: ['umbrella|raincoat'],
      penalty_without_gear: { move_speed: 0.85 },
      services: ['boutique', 'cafe'],
      service_skins: { boutique: 'prefab.savile_tailor', cafe: 'prefab.tea_room' },
      side_job: 'job.umbrella_delivery',
      ore_table: { coal: 0.5, iron: 0.35, gold: 0.1, ruby: 0.05 },
      underground_setpiece: 'set.victorian_sewer',
      sky_feature: 'sky.airship_dock',
      vocab_themes: ['weather', 'clothing', 'politeness'],
      ambient: { skybox: 'sky.overcast', bgm: 'bgm.london' }
    };
    expect(BiomeManifestSchema.parse(london)).toEqual(london);
  });

  it('validates the legacy ItemSpec JSON example from docs/03 D2', () => {
    const jetpack = {
      base_mesh: 'item_jetpack_01',
      socket: 'Back_Socket',
      tier: 2,
      shader_params: {
        primary_color: '#C0392B',
        pattern: 'tex_plain',
        emission_glow: 0.2,
        scale_multiplier: 1.0
      },
      physics_tags: ['flight_jetpack', 'fuel_x2'],
      power_budget: { limit: 10, used: 9 },
      durability_max: 100,
      memory_card_id: 'mc_01HZX...'
    };
    expect(LegacyItemSpecSchema.parse(jetpack)).toEqual(jetpack);
  });

  it('validates all conversation JSON examples from docs/04 4.5', () => {
    const understandReq = {
      dialog_id: 'dlg_01J...',
      npc_ctx: 'makers_lab',
      level: 'L3',
      transcript: 'I want 빨간색 jetpack',
      stt: { source: 'device', confidence: 0.81 }
    };
    expect(UnderstandRequestSchema.parse(understandReq)).toEqual(understandReq);

    const understandRes = {
      normalized: 'I want a red jetpack!',
      intent: 'order_item',
      slots: { item: 'jetpack', color: 'red', modifiers: [], reason: null },
      offers: [
        { stars: 1, text: "I'd like a red jetpack, please.", price: 2000, bonus: null },
        {
          stars: 2,
          text: 'Could you build a fast red jetpack with a big fuel tank?',
          price: 1600,
          bonus: null
        },
        {
          stars: 3,
          text: "I'm looking for a fuel-efficient red jetpack so that I can fly to the space station.",
          price: 1000,
          bonus: 'fuel_x2'
        }
      ],
      hint_tags: ['fuel-efficient', 'so that', 'space station'],
      item_spec_preview: {
        base_mesh: 'item_jetpack_01',
        socket: 'Back_Socket',
        shader_params: { primary_color: '#C0392B' }
      },
      source: 'bank'
    };
    expect(UnderstandResponseSchema.parse(understandRes)).toEqual(understandRes);

    const scoreReq = {
      dialog_id: 'dlg_01J...',
      chosen_stars: 3,
      hint_level: 'full',
      transcript:
        "I'm looking for a fuel efficient red jetpack so I can fly to the space station",
      audio_key: 'u/abc/2026/11/15/dlg_01J.opus'
    };
    expect(ScoreRequestSchema.parse(scoreReq)).toEqual(scoreReq);

    const scoreRes = {
      pass: true,
      score: 0.88,
      missed: ['that'],
      granted: { item_id: 'itm_...', slot_or_socket: 'Back_Socket', coins_delta: -1000 },
      memory_card: { id: 'mc_...', next_review_at: '2026-11-15T10:42:00Z' }
    };
    expect(ScoreResponseSchema.parse(scoreRes)).toEqual(scoreRes);
  });

  it('validates both ItemSpec v2 examples from docs/05 1.1 and rejects unknown fields', () => {
    const pumpkinHelmet = {
      kind: 'item',
      v: 2,
      name: 'Pumpkin Helmet',
      socket: 'Head_Socket',
      parts: [
        { id: 'sphere_ridged', pos: [0, 0, 0], scale: [1.1, 1.0, 1.1], color: '#E67E22' },
        { id: 'stem_short', pos: [0, 0.55, 0], color: '#3E7D32' },
        { id: 'eye_tri', pos: [-0.2, 0.05, 0.5], color: '#FFE066', glow: 0.8 },
        { id: 'eye_tri', pos: [0.2, 0.05, 0.5], color: '#FFE066', glow: 0.8 }
      ],
      tags: ['armor_1', 'night_light'],
      tier: 2,
      power: { limit: 10, used: 6 }
    };
    expect(ItemSpecV2Schema.parse(pumpkinHelmet)).toEqual(pumpkinHelmet);

    const waterBalloon = {
      kind: 'item',
      v: 2,
      name: 'Long-range Water Balloon',
      socket: 'RightHand_Socket',
      parts: [
        { id: 'sphere_smooth', pos: [0, 0, 0], scale: [0.6, 0.7, 0.6], color: '#3FA9F5' },
        { id: 'knot_small', pos: [0, 0.4, 0], color: '#2B7BC0' }
      ],
      tags: ['throwable', 'water_burst', 'range_up'],
      tier: 1,
      power: { limit: 6, used: 5 },
      stack: 5
    };
    expect(ItemSpecV2Schema.parse(waterBalloon)).toEqual(waterBalloon);

    // Reject unknown fields (AGENTS.md 4.3)
    expect(() =>
      ItemSpecV2Schema.parse({ ...waterBalloon, maliciousScript: 'alert(1)' })
    ).toThrow();
  });

  it('migrates v1 ItemSpec cleanly to v2 and rejects PII in LLM input', () => {
    const migrated = migrateSpecToV2({
      kind: 'item',
      v: 1,
      name: 'Starter Hat',
      socket: 'Head_Socket',
      parts: [{ id: 'sphere_smooth', pos: [0, 0, 0], color: '#3FA9F5' }],
      tags: [],
      tier: 1,
      power_limit: 6,
      power_used: 2
    });
    expect(migrated.v).toBe(2);
    expect(migrated.power).toEqual({ limit: 6, used: 2 });

    expect(() =>
      LlmConverseInputSchema.parse({
        npc_ctx: 'cafe',
        level: 'L1',
        normalized: 'water please',
        slots: { item: 'water', modifiers: [] },
        allowed_meshes: ['item_cup_01'],
        allowed_tags: [],
        player_id: 'player_123'
      })
    ).toThrow();
  });

  it('validates WorldDO room messages from docs/02 9.3', () => {
    expect(
      ClientRoomMessageSchema.parse({
        type: 'block.edit',
        seq: 1,
        edits: [{ x: 10, y: 2, z: 10, block_id: 4 }]
      }).type
    ).toBe('block.edit');

    expect(
      ServerRoomMessageSchema.parse({
        type: 'ledger.patch',
        delta: -100,
        balance: 900,
        reason: 'cafe_order'
      }).type
    ).toBe('ledger.patch');
  });
});
