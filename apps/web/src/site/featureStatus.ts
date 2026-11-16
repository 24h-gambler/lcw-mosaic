/**
 * What the site may call "now" (audit 2026-11-16 item 1): every feature the site advertises is keyed to one state.
 *
 * Source of truth is the ops/integration lane's `docs/spec-coverage.json` (tools/spec-coverage.mjs checks it: `live`
 * needs tests, a downgrade needs a decision). Until that file is on main, and for any id it does not list yet, the
 * interim table below answers with the same keys. The glob import is empty while the file is missing, so the site
 * switches to the JSON on the first build after it lands, with no edit here.
 *
 * Nothing is removed from the site because it is not live: claims stay visible with a "만드는 중" tag, and the lines
 * that would read as "you can do this today" use the live-only variant in `copyNow.ts` until the feature turns live.
 */

export const FEATURE_IDS = [
  'talk_order',
  'talk_trade',
  'build_plot',
  'residents',
  'fight',
  'earn',
  'explore_regions',
  'court',
  'destruction',
  'craft_gear',
  'jetpack',
  'mine',
  'sky_island',
  'space_station',
  'friends_pass',
  'showroom'
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type FeatureState = 'live' | 'building' | 'planned';

/**
 * Interim states, measured on production 2026-11-16 (one town: plaza, honey cafe, trade shop, build plot, open hill).
 * - talk_order: honey cafe orders, 1~3 star offers, star price (apps/client/src/world/town.ts honey_cafe)
 * - talk_trade: trade shop barter (town.ts trade_shop)
 * - build_plot: my plot, block placing and chest (world/build.ts, build-hud.ts)
 * - showroom: /s/<id> share page, preview checked by tools/smoke-live.mjs
 * - residents: the room check names who could move in, nobody moves in yet (build-hud.ts showRoom)
 * - friends_pass: /pass hands over ?pass=, the world client does not read it yet (handed to the world lane)
 * Everything else has no scene or system in production.
 */
export const INTERIM_FEATURE_STATE: Readonly<Record<FeatureId, FeatureState>> = {
  talk_order: 'live',
  talk_trade: 'live',
  build_plot: 'live',
  residents: 'building',
  fight: 'planned',
  earn: 'planned',
  explore_regions: 'planned',
  court: 'planned',
  destruction: 'building',
  craft_gear: 'planned',
  jetpack: 'planned',
  mine: 'planned',
  sky_island: 'planned',
  space_station: 'planned',
  friends_pass: 'building',
  showroom: 'live'
};

export interface CoverageFeature {
  id: string;
  status: FeatureState;
}

interface CoverageFile {
  features?: readonly CoverageFeature[];
}

const STATES: readonly FeatureState[] = ['live', 'building', 'planned'];

/** The JSON's states over the interim table. Unknown ids and unknown states in the JSON are ignored. */
export function resolveFeatureStates(
  coverage: CoverageFile | null | undefined,
  interim: Readonly<Record<FeatureId, FeatureState>> = INTERIM_FEATURE_STATE
): Readonly<Record<FeatureId, FeatureState>> {
  const out: Record<FeatureId, FeatureState> = { ...interim };
  for (const f of coverage?.features ?? []) {
    if ((FEATURE_IDS as readonly string[]).includes(f.id) && STATES.includes(f.status)) out[f.id as FeatureId] = f.status;
  }
  return out;
}

// Empty object while docs/spec-coverage.json does not exist (Vite resolves the glob at build time).
const found = import.meta.glob<CoverageFile>('../../../../docs/spec-coverage.json', { eager: true, import: 'default' });
const coverageFile: CoverageFile | null = Object.values(found)[0] ?? null;

/** True when the ops lane's coverage file was found at build time (shown in tests, not on screen). */
export const COVERAGE_FROM_JSON = coverageFile !== null;

export const FEATURE_STATE: Readonly<Record<FeatureId, FeatureState>> = resolveFeatureStates(coverageFile);

export function featureLive(id: FeatureId, states: Readonly<Record<FeatureId, FeatureState>> = FEATURE_STATE): boolean {
  return states[id] === 'live';
}

export function allLive(ids: readonly FeatureId[], states: Readonly<Record<FeatureId, FeatureState>> = FEATURE_STATE): boolean {
  return ids.every((id) => featureLive(id, states));
}

/** The full claim once every feature it names is live; until then the line that is true today. */
export function whenLive<T>(ids: readonly FeatureId[], full: T, now: T, states: Readonly<Record<FeatureId, FeatureState>> = FEATURE_STATE): T {
  return allLive(ids, states) ? full : now;
}
