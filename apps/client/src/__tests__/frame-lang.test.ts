// Screens in the language the child learns (Dan 11-16, world/lang.ts; English is the only one open): the frame's menu,
// map and HUD lines are English, and the Korean is a help the player turns on, joined after a dot ("Close · 닫기") or
// on a small line of its own (KoHelp, the band, low-gauge notices). Each side gets its own names: never a Korean
// particle on an English name ("Town Square으로 가기").
import { afterEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { ACHIEVEMENT_REGISTRY, COLLECTION_BOOKS, LANG_PACK_MANIFEST } from '@lcw/content';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN, FRAME_STRINGS_KO, frameBi } from '../frame/strings.js';
import { BAND_NAMES_KO, SCENE_TITLES_KO, SECTOR_NAMES_KO, WORLD_STRINGS, nameBi, worldSay } from '../world/strings.js';
import { helpKoOn, learnLang, onLearnLang, resetLangForTest, setHelpKo } from '../world/lang.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../frame/settings.js';
import { toServerSettings } from '../frame/settings-sync.js';
import { compassKo, goLabel, mapNowLine, mapSummary, type MapScene, type SectorCell } from '../frame/menu/map-model.js';
import { ko, koHelpActive, koOf } from '../frame/menu/ko-help.js';
import { ACHIEVEMENT_NAMES_EN, COLLECTION_NAMES_EN, achievementName, entryName, thingName } from '../frame/menu/collection-names.js';
import { itemTitleBi } from '../world/strings.js';
import { keyLabel } from '../frame/menu/SettingsPanel.js';
import { lowNotice } from '../frame/useGauges.js';
import { clockLabel, hotbarCaption, placeBi, placeLabel } from '../frame/status.js';

const HANGUL = /[가-힣]/;
const NO_GAME = /game|게임/i;
/** A Korean particle or ending right after a Latin letter: "Town Square으로", "Plaza예요", "Ground에서". */
const PARTICLE_ON_LATIN = /[A-Za-z]\s?(으로|로\b|이에요|예요|에서|을|를|이|가|은|는|와|과|쪽)/;

/** Every key path of a table: functions as leaves with their arity ("bookProgress()/2"), arrays as one leaf. */
function shape(v: unknown, path = ''): string[] {
  if (typeof v === 'function') return [`${path}()/${v.length}`];
  if (Array.isArray(v)) return [`${path}[]`];
  if (v && typeof v === 'object') return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return [path];
}

/** Every string a table can show: plain strings, array items, and function results for sample arguments. */
function texts(v: unknown, samples: unknown[][] = [], path = ''): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') {
    const f = v as (...a: unknown[]) => unknown;
    const all = [...samples.map((s) => s.slice(0, Math.max(f.length, 1))), Array(f.length).fill('X'), Array(f.length).fill(3), [['A', 'B']], ['X', 'X', 'X', 'X']];
    const out: string[] = [];
    for (const args of all) {
      try {
        const r = f(...args);
        if (typeof r === 'string') out.push(r);
      } catch {
        // wrong sample type for this function
      }
    }
    expect(out.length, path).toBeGreaterThan(0);
    return out;
  }
  if (Array.isArray(v)) return v.flatMap((x, i) => texts(x, samples, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.keys(v).flatMap((k) => texts((v as Record<string, unknown>)[k], samples, `${path}.${k}`));
  return [];
}

const cells: SectorCell[] = Array.from({ length: 9 }, (_, i) => ({
  index: i,
  col: i % 3,
  row: Math.floor(i / 3),
  rect: [0, 0, 1, 1] as const,
  id: i === 4 ? 'town' : null,
  nameKo: i === 4 ? SECTOR_NAMES_KO.town : null,
  kind: i === 4 ? 'town' : null,
  explored: i === 4,
  zone: 'core'
})) as unknown as SectorCell[];
const places = (['plaza', 'honey_cafe'] as const).map((id) => ({ id, nameKo: SCENE_TITLES_KO[id], x: 0, z: 0 })) as unknown as MapScene[];

afterEach(() => resetLangForTest());

describe('the screens speak the learn language', () => {
  it('defaults to English, the content pack target language; the Korean help is off', () => {
    expect(learnLang()).toBe(LANG_PACK_MANIFEST.target_lang);
    expect(learnLang()).toBe('en');
    expect(helpKoOn()).toBe(false);
    expect(F.menu).toBe('Menu');
    expect(F.tabs.bag).toBe(FRAME_STRINGS_EN.tabs.bag);
    expect(F.touchGuide).toEqual(FRAME_STRINGS_EN.touchGuide);
    expect(F.bookProgress(2, 5)).toBe('2 / 5');
  });

  it('EN and KO frame tables have the same keys, recursively, functions (and their arity) included', () => {
    expect(shape(FRAME_STRINGS_EN)).toEqual(shape(FRAME_STRINGS_KO));
    expect(FRAME_STRINGS_EN.compass).toHaveLength(8);
    expect(FRAME_STRINGS_EN.unexploredLines).toHaveLength(FRAME_STRINGS_KO.unexploredLines.length);
    expect(FRAME_STRINGS_EN.keyFixed.map((r) => r.length)).toEqual(FRAME_STRINGS_KO.keyFixed.map((r) => r.length));
  });

  it('no Hangul in what the screen shows with the help off (menu, map, HUD frame lines, key names, collection)', () => {
    const all = [
      ...texts(FRAME_STRINGS_EN),
      ...texts(F),
      ...texts(WORLD_STRINGS),
      ...Object.values(BAND_NAMES_KO),
      ...Object.values(SCENE_TITLES_KO),
      SECTOR_NAMES_KO.town,
      placeLabel(SCENE_TITLES_KO.plaza, 'surface'),
      clockLabel(21.25, 'clear'),
      hotbarCaption([null, null, null, null, null], 0),
      mapSummary({ cells, playerCell: 4, near: places[0]!, band: 'surface', yaw: 0, places, lessonOn: false }),
      goLabel(SCENE_TITLES_KO.plaza),
      mapNowLine(SCENE_TITLES_KO.plaza, 'surface', 0).en,
      lowNotice('lowThirst'),
      keyLabel('ShiftLeft'),
      keyLabel('ControlRight'),
      ...ACHIEVEMENT_REGISTRY.map((a) => achievementName(a.id, a.nameKo)),
      ...Object.entries(COLLECTION_BOOKS)
        .filter(([b]) => b !== 'expressions')
        .flatMap(([b, list]) => list.map((e) => entryName(b, e.key, e.nameKo)))
    ];
    expect(all.length).toBeGreaterThan(500);
    expect(all.filter((t) => HANGUL.test(t))).toEqual([]);
  });

  it('no blame, price or payment words and never "game" / "게임" in either language', () => {
    for (const table of [FRAME_STRINGS_EN, FRAME_STRINGS_KO, ACHIEVEMENT_NAMES_EN, COLLECTION_NAMES_EN]) {
      const all = texts(table);
      for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all.filter((t) => t.includes(p))).toEqual([]);
      expect(all.filter((t) => NO_GAME.test(t))).toEqual([]);
      expect(all.filter((t) => /\b(buy|pay|price|subscribe|wrong|fail)/i.test(t))).toEqual([]);
    }
  });

  it('English keeps key names and short tab labels', () => {
    for (const k of Object.keys(FRAME_STRINGS_EN.tabs)) expect((FRAME_STRINGS_EN.tabs as Record<string, string>)[k]!.length).toBeLessThanOrEqual(8);
    expect(keyLabel('ShiftLeft')).toBe('Left Shift');
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(compassKo(0)).toBe('south');
  });
});

describe('Korean help (world/lang.ts helpKoOn, one switch with the start screen)', () => {
  it('joins the Korean after a dot, nested tables and lists too; compass words and key names stay English', () => {
    setHelpKo(true);
    expect(F.close).toBe('Close · 닫기');
    expect(F.tabs.bag).toBe(`${FRAME_STRINGS_EN.tabs.bag} · ${FRAME_STRINGS_KO.tabs.bag}`);
    expect(F.touchGuide[0]).toBe(`${FRAME_STRINGS_EN.touchGuide[0]} · ${FRAME_STRINGS_KO.touchGuide[0]}`);
    expect(F.keyFixed[0]).toEqual(FRAME_STRINGS_EN.keyFixed[0]!.map((x, i) => (x === FRAME_STRINGS_KO.keyFixed[0]![i] ? x : `${x} · ${FRAME_STRINGS_KO.keyFixed[0]![i]}`)));
    expect(F.compass).toEqual(FRAME_STRINGS_EN.compass);
    expect(keyLabel('ShiftLeft')).toBe('Left Shift');
    expect(F.bookProgress(2, 5)).toBe('2 / 5');
    expect(F.hintStep(2)).toBe('Hint 2 · 힌트 2단계');
  });

  it('a sentence with a name gets each side its own words; an English-only name keeps the Korean out', () => {
    setHelpKo(true);
    expect(F.goTo('Town Square')).toBe('Go to Town Square');
    expect(F.goTo({ en: 'Town Square', ko: '중앙 광장' })).toBe('Go to Town Square · 중앙 광장으로 가기');
    expect(goLabel(SCENE_TITLES_KO.plaza)).toBe('Go to Town Square · 중앙 광장으로 가기');
    expect(goLabel(SCENE_TITLES_KO.honey_cafe)).toBe('Go to Honey Cafe · 꿀 카페로 가기');
    expect(F.rebindDone({ en: 'Q', ko: 'Q' }, frameBi((t) => t.keyActions.jump))).toBe("Now Q does 'Jump'. · 이제 Q 키로 '점프'을 해요.");
    expect(F.qualityNow(frameBi((t) => t.qualities.low))).toBe('Now: Low · 지금: 낮음');
    expect(nameBi(SCENE_TITLES_KO.plaza)).toEqual({ en: 'Town Square', ko: '중앙 광장' });
    expect(nameBi(BAND_NAMES_KO.surface)).toEqual({ en: 'Ground', ko: '지상' });
    expect(nameBi('Somewhere new')).toBeNull();

    const summary = mapSummary({ cells, playerCell: 4, near: places[0]!, band: 'surface', yaw: 0, places, lessonOn: false });
    expect(summary).toContain('This is the map.');
    expect(summary).toContain('중앙 광장 근처');
    expect(summary).toContain('지상에서 남쪽을 보고 있어요');
    const now = mapNowLine(SCENE_TITLES_KO.plaza, 'surface', 0);
    expect(now).toEqual({ en: 'Town Square · Ground · facing south', ko: '지금 중앙 광장 · 지상 · 남쪽을 봐요' });
    // a name no table knows: English only, no Korean sentence around it
    expect(mapNowLine('Somewhere new', 'surface', 0).ko).toBeNull();

    // every function of the live table, fed English names: the Korean side never puts a particle on them
    const lines = [...texts(F, [['Town Square', 'Ground', 'north', 'Q'], [{ en: 'Town Square', ko: '중앙 광장' }, { en: 'Ground', ko: '지상' }, { en: 'north', ko: '북' }]]), summary, now.ko!];
    expect(lines.filter((t) => PARTICLE_ON_LATIN.test(t.replace(/'[^']*'/g, '')))).toEqual([]);
  });

  it('the HUD band and the low-gauge notices put the Korean on a line of its own', () => {
    expect(worldSay('offlineBand').help).toBeNull();
    expect(lowNotice('lowThirst')).not.toContain('\n');
    setHelpKo(true);
    const band = worldSay('offlineBand');
    expect(HANGUL.test(band.text)).toBe(false);
    expect(band.help).toBe('연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중');
    expect(lowNotice('lowThirst')).toMatch(/^[^가-힣]+\n목이 말라서/);
    expect(WORLD_STRINGS.talk).toBe('Talk · 말 걸기');
  });

  it('the menu draws the Korean line only while it is on', () => {
    expect(koHelpActive()).toBe(false);
    expect(ko((t) => t.tabs.bag)).toBeNull();
    expect(koOf(FRAME_STRINGS_EN.bagTitle)).toBeNull();
    setHelpKo(true);
    expect(ko((t) => t.tabs.bag)).toBe(FRAME_STRINGS_KO.tabs.bag);
    expect(koOf(FRAME_STRINGS_EN.bagTitle)).toBe(FRAME_STRINGS_KO.bagTitle);
    expect(koOf(FRAME_STRINGS_EN.settingsSavedHere)).toBe(FRAME_STRINGS_KO.settingsSavedHere);
    expect(koOf('not a frame string')).toBeNull();
  });

  it('is kept by lang.ts only: off by default, not in the settings record nor its server copy', () => {
    expect('helpKo' in DEFAULT_SETTINGS).toBe(false);
    expect('helpKo' in normalizeSettings({ helpKo: true })).toBe(false);
    expect('helpKo' in toServerSettings(DEFAULT_SETTINGS)).toBe(false);
    const seen: boolean[] = [];
    const off = onLearnLang((v) => seen.push(v.helpKo));
    setHelpKo(true);
    expect(helpKoOn()).toBe(true);
    setHelpKo(false);
    off();
    expect(helpKoOn()).toBe(false);
    expect(seen.every((x) => typeof x === 'boolean')).toBe(true);
  });
});

describe('collection names (GET /v1/collection sends Korean names only)', () => {
  it('achievements by id in English, the server Korean after it with the help on; unknown ids as sent', () => {
    expect(ACHIEVEMENT_REGISTRY.map((a) => a.id).filter((id) => !ACHIEVEMENT_NAMES_EN[id])).toEqual([]);
    expect(achievementName('first_order', '첫 주문')).toBe('First order');
    expect(achievementName('food_orders_20', '단골손님 (음식 20번 주문)')).toBe('Regular (20 food orders)');
    expect(achievementName('blocks_1000', '블록 1,000개 설치')).toBe('Place 1,000 blocks');
    expect(achievementName('mastered_10', '마스터 도안 10개')).toBe('10 mastered designs');
    expect(achievementName('new_one', '새 업적')).toBe('새 업적');
    setHelpKo(true);
    expect(achievementName('blocks_100', '블록 100개 설치')).toBe('Place 100 blocks · 블록 100개 설치');
  });

  it('every entry of the five named books has an English name; expressions are English sentences already', () => {
    for (const b of ['minerals', 'enemies', 'food', 'outfits'] as const) {
      expect(COLLECTION_BOOKS[b].map((e) => e.key).filter((k) => !COLLECTION_NAMES_EN[b]?.[k])).toEqual([]);
    }
    expect(entryName('food', 'honey_tea', '꿀차')).toBe('Honey tea');
    expect(entryName('outfits', 'helmet', '빨간 헬멧')).toBe('Red helmet');
    expect(entryName('blocks', 'brick', '벽돌')).toBe('Brick');
    expect(entryName('blocks', 'nope', '새 블록')).toBe('새 블록');
    const expr = COLLECTION_BOOKS.expressions[0]!;
    expect(HANGUL.test(expr.nameKo)).toBe(false);
    expect(entryName('expressions', expr.key, expr.nameKo)).toBe(expr.nameKo);
    setHelpKo(true);
    expect(entryName('minerals', 'gold', '금')).toBe('Gold · 금');
    expect(entryName('blocks', 'brick', '벽돌')).toBe('Brick · 벽돌');
  });
});


describe('server names and HUD lines on English screens (review #lang-en)', () => {
  it('carried things show English by item key, the server Korean only with the help, an unknown key as sent', () => {
    expect(thingName('honey_latte', '꿀 라테')).toBe('Honey latte');
    expect(thingName('mystery_box', '수수께끼 상자')).toBe('수수께끼 상자');
    setHelpKo(true);
    expect(thingName('honey_latte', '꿀 라테')).toBe('Honey latte · 꿀 라테');
  });
  it('the status chip and the caption put the Korean on a line of their own, none while the help is off', () => {
    expect(placeBi(SCENE_TITLES_KO.plaza, 'surface')).toEqual({ en: 'Town Square · Ground', ko: null });
    expect(itemTitleBi('honey_latte')).toEqual({ en: 'Honey latte', ko: null });
    expect(HANGUL.test(clockLabel(10.5, 'snow'))).toBe(false);
    setHelpKo(true);
    // a title built while the help was on (frozen in the HUD) still splits into its two sides
    expect(placeBi(SCENE_TITLES_KO.plaza, 'surface')).toEqual({ en: 'Town Square · Ground', ko: '중앙 광장 · 지상' });
    expect(placeBi(SCENE_TITLES_KO.plaza, 'surface', false).ko).toBeNull();
    expect(itemTitleBi('honey_latte')).toEqual({ en: 'Honey latte', ko: '꿀 라테' });
    expect(HANGUL.test(clockLabel(10.5, 'snow'))).toBe(false);
  });
});
