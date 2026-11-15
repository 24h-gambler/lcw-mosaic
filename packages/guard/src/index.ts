import {
  ABILITY_TAG_MAP,
  CONTENT_FILTERS,
  PART_ID_SET,
  PART_REGISTRY
} from '@lcw/content';
import { B, CFG, PLOT, World, Z } from '@lcw/destruction';
import {
  AnySpecV2Schema,
  ItemSpecV1Schema,
  type AnySpecV2,
  type ItemSpecV2,
  type RuleSpec,
  migrateSpecToV2
} from '@lcw/schemas';

export interface GuardCheckContext {
  playerId: string;
  nowMs: number;
  recentCreationTimestampsMs?: number[];
  existingWorldObjectCount?: number;
  playerPlotBounds?: { x0: number; x1: number; z0: number; z1: number };
  arenaBounds?: { x0: number; x1: number; z0: number; z1: number };
}

export interface GuardResult {
  approved: boolean;
  stageFailed?: 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
  reason?: string;
  spec?: AnySpecV2;
  fallbackPreset?: ItemSpecV2;
  truncatedTags?: string[];
  simTicksRun?: number;
  sandboxStats?: {
    maxPower: number;
    maxExpBlocks: number;
    maxFluid: number;
    maxProj: number;
  };
}

export const STOCK_ITEM_PRESET: ItemSpecV2 = {
  kind: 'item',
  v: 2,
  name: 'Standard Explorer Cap',
  socket: 'Head_Socket',
  parts: [{ id: 'sphere_smooth', pos: [0, 0, 0], scale: [1, 1, 1], color: '#3FA9F5' }],
  tags: ['night_light'],
  tier: 1,
  power: { limit: 6, used: 2 }
};

function findNearestPartId(badId: string): string {
  const lower = badId.toLowerCase();
  const hit = PART_REGISTRY.find((p) => p.id.includes(lower) || lower.includes(p.id.split('_')[0]!));
  return hit?.id ?? 'cube_unit';
}

function containsUnsafeText(text: string): string | null {
  for (const pat of CONTENT_FILTERS.piiPatterns) {
    if (pat.test(text)) return 'pii_detected';
  }
  for (const pat of CONTENT_FILTERS.promptInjectionPatterns) {
    if (pat.test(text)) return 'prompt_injection_detected';
  }
  const lower = text.toLowerCase();
  for (const word of CONTENT_FILTERS.profanity) {
    if (lower.includes(word)) return 'profanity_detected';
  }
  return null;
}

function isBoundsWithin(
  inner: { x0: number; x1: number; z0: number; z1: number },
  outer: { x0: number; x1: number; z0: number; z1: number }
): boolean {
  return (
    inner.x0 >= outer.x0 &&
    inner.x1 <= outer.x1 &&
    inner.z0 >= outer.z0 &&
    inner.z1 <= outer.z1
  );
}

/**
 * Executes G1 -> G5 inspection pipeline (docs/05 4, WP-601, WP-604, WP-605).
 * Never throws unhandled exceptions even on malformed input.
 */
export function inspectSpecG1ToG5(rawInput: unknown, ctx: GuardCheckContext): GuardResult {
  try {
    if (!rawInput || typeof rawInput !== 'object') {
      return { approved: false, stageFailed: 'G1', reason: 'not_an_object', fallbackPreset: STOCK_ITEM_PRESET };
    }

    // G1: Schema validation (with v1 -> v2 migration support)
    let spec: AnySpecV2;
    const rawRec = rawInput as Record<string, unknown>;
    if (rawRec.kind === 'item' && rawRec.v === 1) {
      const v1Parsed = ItemSpecV1Schema.safeParse(rawInput);
      if (!v1Parsed.success) {
        return {
          approved: false,
          stageFailed: 'G1',
          reason: 'schema_v1_invalid',
          fallbackPreset: STOCK_ITEM_PRESET
        };
      }
      spec = migrateSpecToV2(v1Parsed.data);
    } else {
      const parsed = AnySpecV2Schema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          approved: false,
          stageFailed: 'G1',
          reason: 'schema_invalid',
          fallbackPreset: STOCK_ITEM_PRESET
        };
      }
      spec = structuredClone(parsed.data);
    }

    // G4 early safety check on name/target/location
    const unsafeName = containsUnsafeText(spec.name);
    if (unsafeName) {
      return { approved: false, stageFailed: 'G4', reason: unsafeName, fallbackPreset: STOCK_ITEM_PRESET };
    }
    if (spec.kind === 'quest') {
      const unsafeTarget = containsUnsafeText(spec.target) || containsUnsafeText(spec.location);
      if (unsafeTarget) {
        return { approved: false, stageFailed: 'G4', reason: unsafeTarget };
      }
    }

    // G2 & G3: Registry and Budget enforcement
    const truncatedTags: string[] = [];
    if (spec.kind === 'item') {
      for (const part of spec.parts) {
        if (!PART_ID_SET.has(part.id)) {
          part.id = findNearestPartId(part.id);
        }
      }

      const validTags: string[] = [];
      let powerUsed = 0;
      for (const tag of spec.tags) {
        const def = ABILITY_TAG_MAP.get(tag);
        if (!def) continue; // unknown tag removed at G2
        if (powerUsed + def.powerCost <= spec.power.limit) {
          validTags.push(tag);
          powerUsed += def.powerCost;
        } else {
          truncatedTags.push(tag); // excess budget trimmed at G3
        }
      }
      spec.tags = validTags;
      spec.power = { limit: spec.power.limit, used: powerUsed };
    }

    // Per-world object limit (300) and per-minute creation rate (3/min)
    if ((ctx.existingWorldObjectCount ?? 0) >= 300) {
      return { approved: false, stageFailed: 'G3', reason: 'world_object_limit_300' };
    }
    const recent1Min = (ctx.recentCreationTimestampsMs ?? []).filter(
      (t) => ctx.nowMs - t < 60_000
    );
    if (recent1Min.length >= 3) {
      return { approved: false, stageFailed: 'G3', reason: 'rate_limit_3_per_min' };
    }

    // G5: RuleSpec scope check + isolated 200-tick sandbox simulation
    if (spec.kind === 'rule') {
      const rule: RuleSpec = spec;
      if (rule.scope !== 'plot' && rule.scope !== 'arena') {
        return { approved: false, stageFailed: 'G5', reason: 'rule_scope_outside_plot_or_arena' };
      }
      if (rule.target_bounds) {
        const allowedOuter =
          rule.scope === 'plot'
            ? (ctx.playerPlotBounds ?? PLOT)
            : (ctx.arenaBounds ?? { x0: 200, x1: 232, z0: 200, z1: 232 });
        if (!isBoundsWithin(rule.target_bounds, allowedOuter)) {
          return { approved: false, stageFailed: 'G5', reason: 'rule_bounds_exceed_allowed_zone' };
        }
      }
    }

    // Isolated 16x16x16 simulation sandbox using ONLY the 4 kernel functions (WP-604)
    const sandbox = new World(99);
    sandbox.players.push({ id: 0, x: 200.5, y: 20, z: 200.5, vx: 0, vy: 0, vz: 0, owner: true });

    if (spec.kind === 'item') {
      for (const tagId of spec.tags) {
        const def = ABILITY_TAG_MAP.get(tagId);
        if (!def) continue;
        switch (def.kernelCall) {
          case 'explode':
            sandbox.explode(0, 200.5, 20, 200.5, tagId === 'blast_medium' ? 6 : 4);
            break;
          case 'waterBomb':
            sandbox.waterBomb(0, 200.5, 22, 200.5);
            break;
          case 'rocket':
            sandbox.rocket(0, 200.5, 21, 200.5, 0, 0, 1, 2);
            break;
          case 'impulse':
            sandbox.impulse(0, 0, 1.2, 0.5);
            break;
          case 'passive':
            break;
        }
      }
    }

    for (let t = 0; t < 200; t++) {
      sandbox.step();
    }

    if (
      sandbox.stats.maxPower > CFG.MAX_POWER ||
      sandbox.stats.maxExpBlocks > CFG.MAX_BLOCKS_PER_EXPLOSION ||
      sandbox.stats.maxFluid > CFG.MAX_FLUID ||
      sandbox.stats.maxProj > CFG.MAX_PROJECTILES
    ) {
      return { approved: false, stageFailed: 'G5', reason: 'kernel_cap_exceeded' };
    }

    return {
      approved: true,
      spec,
      truncatedTags,
      simTicksRun: 200,
      sandboxStats: {
        maxPower: sandbox.stats.maxPower,
        maxExpBlocks: sandbox.stats.maxExpBlocks,
        maxFluid: sandbox.stats.maxFluid,
        maxProj: sandbox.stats.maxProj
      }
    };
  } catch {
    return {
      approved: false,
      stageFailed: 'G1',
      reason: 'unexpected_parse_error',
      fallbackPreset: STOCK_ITEM_PRESET
    };
  }
}

export interface StoredL3Object {
  id: string;
  owner: string;
  spec: AnySpecV2;
  state: 'active' | 'quarantined' | 'removed';
  errorCount: number;
  pos: [number, number, number];
  corruptedPayload?: boolean;
}

/**
 * G7 Atomic Commit & G8 Isolation Monitor for L3 objects (docs/05 3, 4, 8).
 */
export class GuardedWorldObjects {
  private objects = new Map<string, StoredL3Object>();
  private serializedBytes: string;

  constructor(initial: StoredL3Object[] = []) {
    for (const o of initial) this.objects.set(o.id, o);
    this.serializedBytes = this.serializeState();
  }

  private serializeState(): string {
    return JSON.stringify([...this.objects.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  getBytes(): string {
    return this.serializedBytes;
  }

  listObjects(): StoredL3Object[] {
    return [...this.objects.values()];
  }

  /**
   * G7 Atomic Commit: if an interruption occurs mid-commit, rolls back so bytes match pre-commit state (05 8 test 4).
   */
  commitObject(
    obj: Omit<StoredL3Object, 'state' | 'errorCount'>,
    opts?: { simulateCrashMidCommit?: boolean }
  ): { committed: boolean; reason?: string } {
    const prevSnapshot = new Map(
      [...this.objects.entries()].map(([k, v]) => [k, structuredClone(v)])
    );
    const prevBytes = this.serializedBytes;

    try {
      this.objects.set(obj.id, {
        ...structuredClone(obj),
        state: 'active',
        errorCount: 0
      });
      if (opts?.simulateCrashMidCommit) {
        throw new Error('simulated_mid_commit_crash');
      }
      this.serializedBytes = this.serializeState();
      return { committed: true };
    } catch (err) {
      this.objects = prevSnapshot;
      this.serializedBytes = prevBytes;
      return {
        committed: false,
        reason: err instanceof Error ? err.message : 'commit_aborted'
      };
    }
  }

  /**
   * G8 Runtime Monitor: opens world objects independently; after 2 exceptions, isolates broken object (05 8 test 5).
   */
  openAndTickAllObjects(tickEvaluator: (obj: StoredL3Object) => void): {
    activeCount: number;
    quarantinedIds: string[];
  } {
    const quarantinedIds: string[] = [];
    let activeCount = 0;

    for (const obj of this.objects.values()) {
      if (obj.state !== 'active') {
        if (obj.state === 'quarantined') quarantinedIds.push(obj.id);
        continue;
      }

      try {
        if (obj.corruptedPayload) throw new Error('corrupted_l3_object');
        tickEvaluator(obj);
        activeCount++;
      } catch {
        obj.errorCount++;
        if (obj.errorCount >= 2 || obj.corruptedPayload) {
          obj.state = 'quarantined';
          quarantinedIds.push(obj.id);
        }
      }
    }

    this.serializedBytes = this.serializeState();
    return { activeCount, quarantinedIds };
  }
}

export function exportSpecShareCode(spec: AnySpecV2): string {
  const json = JSON.stringify(spec);
  return `LCW2:${encodeURIComponent(json)}`;
}

export function importSpecShareCode(code: string, ctx: GuardCheckContext): GuardResult {
  if (!code.startsWith('LCW2:')) {
    return { approved: false, stageFailed: 'G1', reason: 'invalid_share_code_prefix' };
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(code.slice(5)));
    return inspectSpecG1ToG5(parsed, ctx);
  } catch {
    return { approved: false, stageFailed: 'G1', reason: 'corrupted_share_code' };
  }
}

export function verifyWorldInvariants(
  world: World,
  objects: StoredL3Object[],
  ledgerDeltaSum: number,
  playerBalance: number
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const [sx, sy, sz] = CFG.SPAWN;

  // I1: Spawn has solid ground and 2 empty blocks above
  if (
    world.get(sx, sy - 1, sz) === B.AIR ||
    world.get(sx, sy, sz) !== B.AIR ||
    world.get(sx, sy + 1, sz) !== B.AIR
  ) {
    failures.push('I1');
  }

  // I4: Entity & object limits
  if (objects.length > 300) failures.push('I4');

  // I7: Ledger matches balance
  if (ledgerDeltaSum !== playerBalance) failures.push('I7');

  // I8: No L2/L4 edits inside L1 core
  for (const k of world.delta.keys()) {
    if (world.zone(...world.unkey(k)) === Z.CORE) {
      failures.push('I8');
      break;
    }
  }
  for (const k of world.temp.keys()) {
    if (world.zone(...world.unkey(k)) === Z.CORE) {
      failures.push('I8');
      break;
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Deterministic rule-based item spec builder for simple requests without calling an LLM (WP-603).
 */
export function buildRuleItemSpecFromSlots(params: {
  item: string;
  colorHex?: string;
}): ItemSpecV2 {
  const color = params.colorHex ?? '#C0392B';
  if (params.item === 'water_balloon') {
    return {
      kind: 'item',
      v: 2,
      name: 'Water Balloon',
      socket: 'RightHand_Socket',
      parts: [
        { id: 'sphere_smooth', pos: [0, 0, 0], scale: [0.6, 0.7, 0.6], color },
        { id: 'knot_small', pos: [0, 0.4, 0], color }
      ],
      tags: ['throwable', 'water_burst', 'range_up'],
      tier: 1,
      power: { limit: 6, used: 5 },
      stack: 5
    };
  }
  return {
    kind: 'item',
    v: 2,
    name: `${params.item} Gear`,
    socket: 'Back_Socket',
    parts: [
      { id: 'cube_tall', pos: [0, 0, 0], scale: [1, 1, 1], color },
      { id: 'thruster_bell', pos: [0, -0.4, 0], scale: [0.8, 0.8, 0.8], color }
    ],
    tags: ['flight_jetpack'],
    tier: 2,
    power: { limit: 10, used: 5 }
  };
}
