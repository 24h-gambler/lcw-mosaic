import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lookupPhraseBank } from '@lcw/content';
import {
  COVERAGE_FROM_JSON,
  FEATURE_IDS,
  FEATURE_STATE,
  INTERIM_FEATURE_STATE,
  allLive,
  resolveFeatureStates,
  whenLive,
  type FeatureId,
  type FeatureState
} from '../site/featureStatus.js';
import { CAFE_OFFERS_NOW, FEATURE_NAME_KO, LANDING_NOW, PLAY_NOW, PLAY_SECTION_FEATURES } from '../site/copyNow.js';
import { metaFor, parseSitePath } from '../site/routes.js';
import { prerenderPage } from '../site/prerender.js';
import { META, PLAY } from '../site/copy.js';

const coveragePath = fileURLToPath(new URL('../../../../docs/spec-coverage.json', import.meta.url));

// Audit 2026-11-16 item 1: the site shows as "now" only what production has; every other claim stays with a tag and
// switches on by itself when docs/spec-coverage.json (ops lane) marks it live.
describe('feature state behind site claims', () => {
  it('uses the ids agreed with the ops lane, every one with a state', () => {
    expect([...FEATURE_IDS].sort()).toEqual(
      ['build_plot', 'court', 'craft_gear', 'destruction', 'earn', 'explore_regions', 'fight', 'friends_pass', 'jetpack', 'mine', 'residents', 'showroom', 'sky_island', 'space_station', 'talk_order', 'talk_trade'].sort()
    );
    for (const id of FEATURE_IDS) {
      expect(['live', 'building', 'planned']).toContain(INTERIM_FEATURE_STATE[id]);
      expect(FEATURE_NAME_KO[id]).toBeTruthy();
    }
  });

  it('reads docs/spec-coverage.json over the interim table when the file exists', () => {
    expect(COVERAGE_FROM_JSON).toBe(existsSync(coveragePath));
    if (existsSync(coveragePath)) {
      const file = JSON.parse(readFileSync(coveragePath, 'utf8')) as { features: Array<{ id: string; status: FeatureState }> };
      for (const f of file.features) if ((FEATURE_IDS as readonly string[]).includes(f.id)) expect(FEATURE_STATE[f.id as FeatureId]).toBe(f.status);
    } else {
      expect(FEATURE_STATE).toEqual(INTERIM_FEATURE_STATE);
    }
  });

  it('the JSON wins per id; unknown ids and states are ignored', () => {
    const s = resolveFeatureStates({
      features: [
        { id: 'jetpack', status: 'live' },
        { id: 'talk_order', status: 'planned' },
        { id: 'not_a_feature', status: 'live' },
        { id: 'fight', status: 'shipped' as FeatureState }
      ]
    });
    expect(s.jetpack).toBe('live');
    expect(s.talk_order).toBe('planned');
    expect(s.fight).toBe(INTERIM_FEATURE_STATE.fight);
    expect(Object.keys(s)).toHaveLength(FEATURE_IDS.length);
  });

  it('a claim switches to the full line only when every feature it needs is live', () => {
    const someLive = resolveFeatureStates({ features: [{ id: 'sky_island', status: 'live' }] });
    const bothLive = resolveFeatureStates({ features: [{ id: 'sky_island', status: 'live' }, { id: 'space_station', status: 'live' }] });
    expect(whenLive(PLAY_NOW.lead.needs, 'FULL', 'NOW', someLive)).toBe('NOW');
    expect(whenLive(PLAY_NOW.lead.needs, 'FULL', 'NOW', bothLive)).toBe('FULL');
    expect(allLive([], INTERIM_FEATURE_STATE)).toBe(true);
  });

  it('today lines never name a feature that is not live and never use the banned word', () => {
    const lines = [
      ...Object.values(LANDING_NOW).flatMap((e) => (Array.isArray(e.now) ? e.now : typeof e.now === 'string' ? [e.now] : [])),
      PLAY_NOW.lead.now,
      PLAY_NOW.half.now,
      PLAY_NOW.build.now,
      PLAY_NOW.metaDescription.now,
      PLAY_NOW.talkMode.k,
      PLAY_NOW.talkMode.d
    ].filter((x): x is string => typeof x === 'string');
    for (const l of lines) expect(l).not.toMatch(/게임|\bgame\b/i);
    // Features named on a today line are either live or marked as being made in the same line.
    for (const l of lines) {
      for (const word of ['제트팩', '싸우', '법정', '터뜨', '호박']) expect(l).not.toContain(word);
      if (/하늘섬|우주 정거장|입주|광산/.test(l)) expect(l).toMatch(/만드는 중/);
    }
  });

  it('the landing dialog shows the honey cafe offers the world really serves, with their prices', () => {
    const bank = lookupPhraseBank({ ctx: 'cafe', level: 'L3', item: 'honey_tea', modifiers: ['warm'] });
    expect(bank?.slotsKey).toBe('item=honey_tea|mod=warm');
    expect(CAFE_OFFERS_NOW.map((o) => o.text)).toEqual(bank?.offers.map((o) => o.text));
    expect(CAFE_OFFERS_NOW.map((o) => o.stars)).toEqual([1, 2, 3]);
    const coins = CAFE_OFFERS_NOW.map((o) => o.coins ?? 0);
    expect(coins[0]).toBeGreaterThan(coins[2]!);
    expect(LANDING_NOW.stepGrow.now.every((t) => t.length > 0)).toBe(true);
  });

  it('every /play section and mode card is keyed to features', () => {
    expect(Object.keys(PLAY_SECTION_FEATURES).sort()).toEqual(['boom', 'build', 'friend', 'half', 'make', 'up']);
    expect(PLAY_NOW.modes).toHaveLength(PLAY.modes.length);
  });
});

describe('pages with today\'s state (interim table: cafe, shop, plot and showroom live)', () => {
  const live = (id: FeatureId) => FEATURE_STATE[id] === 'live';

  it('/play: live sections first, the others keep their claim with a state tag', () => {
    const html = prerenderPage('/play').body;
    // The claims are not removed.
    for (const t of [PLAY.boomTitle, PLAY.makeTitle, PLAY.friendTitle, PLAY.upTitle, ...PLAY.modes.map((m) => m.k)]) expect(html).toContain(t);
    const tags = html.match(/data-feature-state="(building|planned)"/g) ?? [];
    const notLive = Object.values(PLAY_SECTION_FEATURES).filter((ids) => !ids.every(live)).length;
    expect(tags.length).toBeGreaterThanOrEqual(notLive);
    if (!live('jetpack')) {
      // The half-price section shows the cafe's real offers and sits before every section that is not live yet.
      expect(html).toContain(CAFE_OFFERS_NOW[2]!.text.replace(/'/g, '&#x27;'));
      expect(html.indexOf(PLAY.halfTitle)).toBeLessThan(html.indexOf(PLAY.boomTitle));
      expect(html.indexOf(PLAY.buildTitle)).toBeLessThan(html.indexOf(PLAY.boomTitle));
    }
    if (!live('sky_island')) expect(html).toContain(PLAY_NOW.lead.now);
    expect(html).toContain('data-testid="open-now"');
  });

  it('/: the hero and steps say what is true today', () => {
    const html = prerenderPage('/').body;
    if (!live('fight')) expect(html).toContain(LANDING_NOW.heroBody.now);
    if (!live('sky_island')) expect(html).toContain(LANDING_NOW.step3Body.now);
    if (!live('jetpack')) expect(html).not.toMatch(/jetpack/i);
  });

  it('/play meta description follows the same state', () => {
    const d = metaFor(parseSitePath('/play')!).description;
    expect(d).toBe(live('destruction') && live('sky_island') ? META['/play']!.description : PLAY_NOW.metaDescription.now);
  });

  it('/parents and /learn tag scenes the world does not have yet', () => {
    const parents = prerenderPage('/parents').body;
    if (!live('court')) expect(parents).toMatch(/변론<small[^>]*>(준비 중|만드는 중)</);
    const learn = prerenderPage('/learn/say-sorry').body;
    if (!live('court')) expect(learn).toContain('data-feature="court"');
    expect(prerenderPage('/learn/order-a-drink').body).not.toContain('data-feature=');
  });
});
