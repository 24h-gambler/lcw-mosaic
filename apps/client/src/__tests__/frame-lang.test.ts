// Screens in the language being learned (Dan 2026-11-16): the frame's menu, map and HUD strings come in one table per
// screen language with the same shape; the English tables carry no Korean; Korean is an assist the player turns on.
import { afterEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { LANG_PACK_MANIFEST } from '@lcw/content';
import { FRAME_STRINGS, FRAME_STRINGS_EN, FRAME_STRINGS_KO, FRAME_STRINGS_BY_LANG, frameLang, setFrameLang } from '../frame/strings.js';
import {
  BAND_NAMES,
  BAND_NAMES_EN,
  BAND_NAMES_KO,
  WORLD_FRAME_STRINGS_EN,
  WORLD_FRAME_STRINGS_KO,
  WORLD_STRINGS,
  controlsDesktopFor,
  buildHelpDesktopFor,
  DEFAULT_KEY_HINTS,
  setWorldFrameLang,
  worldFrameLang
} from '../world/strings.js';
import { helpKoOn, learnLang, onLearnLang, resetLangForTest, setHelpKo, uiLang } from '../frame/lang.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../frame/settings.js';
import { toServerSettings } from '../frame/settings-sync.js';
import { goLabel, compassKo } from '../frame/menu/map-model.js';
import { ko, koHelpActive, koOf } from '../frame/menu/ko-help.js';
import { clockLabel, hotbarCaption, placeLabel } from '../frame/status.js';

const HANGUL = /[가-힣]/;
const NO_GAME = /game|게임/i;

/** Every key path of a table: functions as leaves with their arity ("bookProgress()/2"), arrays as one leaf. */
function shape(v: unknown, path = ''): string[] {
  if (typeof v === 'function') return [`${path}()/${v.length}`];
  if (Array.isArray(v)) return [`${path}[]`];
  if (v && typeof v === 'object') return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return [path];
}

/** Every string a table can show: plain strings, array items, and function results for sample arguments. */
function texts(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') {
    const f = v as (...a: unknown[]) => unknown;
    const samples: unknown[][] = [Array(f.length).fill('X'), Array(f.length).fill(3), [['A', 'B']]];
    const out: string[] = [];
    for (const args of samples) {
      try {
        const r = f(...args);
        if (typeof r === 'string') out.push(r);
      } catch {
        // wrong sample type for this function
      }
    }
    expect(out.length).toBeGreaterThan(0);
    return out;
  }
  if (Array.isArray(v)) return v.flatMap(texts);
  if (v && typeof v === 'object') return Object.values(v).flatMap(texts);
  return [];
}

afterEach(() => {
  setFrameLang('en');
  setWorldFrameLang('en');
  resetLangForTest();
});

describe('learn language (frame/lang.ts)', () => {
  it('defaults to the content pack target language; the screens show in it', () => {
    expect(learnLang()).toBe(LANG_PACK_MANIFEST.target_lang);
    expect(uiLang()).toBe('en');
    // the live tables start in the screen language
    expect(frameLang()).toBe('en');
    expect(worldFrameLang()).toBe('en');
    expect(FRAME_STRINGS.menu).toBe(FRAME_STRINGS_EN.menu);
    expect(WORLD_STRINGS.offlineBand).toBe(WORLD_FRAME_STRINGS_EN.offlineBand);
  });
});

describe('tables by language', () => {
  it('EN and KO frame tables have the same keys, recursively, functions (and their arity) included', () => {
    expect(shape(FRAME_STRINGS_EN)).toEqual(shape(FRAME_STRINGS_KO));
    expect(shape(FRAME_STRINGS_BY_LANG.en)).toEqual(shape(FRAME_STRINGS_BY_LANG.ko));
    // arrays shown side by side keep their length (compass 8 ways, two-line labels, fixed keys)
    expect(FRAME_STRINGS_EN.compass).toHaveLength(8);
    expect(FRAME_STRINGS_EN.unexploredLines).toHaveLength(FRAME_STRINGS_KO.unexploredLines.length);
    expect(FRAME_STRINGS_EN.keyFixed.map((r) => r.length)).toEqual(FRAME_STRINGS_KO.keyFixed.map((r) => r.length));
  });

  it('EN and KO HUD tables have the same keys', () => {
    expect(shape(WORLD_FRAME_STRINGS_EN)).toEqual(shape(WORLD_FRAME_STRINGS_KO));
    expect(shape(BAND_NAMES_EN)).toEqual(shape(BAND_NAMES_KO));
  });

  it('no Hangul anywhere in the English tables (menu, map, HUD, bands, help-line templates)', () => {
    setWorldFrameLang('en');
    const all = [
      ...texts(FRAME_STRINGS_EN),
      ...texts(WORLD_FRAME_STRINGS_EN),
      ...texts(BAND_NAMES_EN),
      controlsDesktopFor(DEFAULT_KEY_HINTS),
      buildHelpDesktopFor(DEFAULT_KEY_HINTS)
    ];
    expect(all.length).toBeGreaterThan(300);
    expect(all.filter((t) => HANGUL.test(t))).toEqual([]);
  });

  it('no blame, price or payment words and never "game" / "게임" in either language', () => {
    for (const table of [FRAME_STRINGS_EN, FRAME_STRINGS_KO, WORLD_FRAME_STRINGS_EN, WORLD_FRAME_STRINGS_KO, BAND_NAMES_EN, BAND_NAMES_KO]) {
      const all = texts(table);
      for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all.filter((t) => t.includes(p))).toEqual([]);
      expect(all.filter((t) => NO_GAME.test(t))).toEqual([]);
      expect(all.filter((t) => /\b(buy|pay|price|subscribe|wrong|fail)/i.test(t))).toEqual([]);
    }
  });

  it('English keeps key names and is about as long as the Korean on one-line spots', () => {
    expect(controlsDesktopFor(DEFAULT_KEY_HINTS)).toBe(WORLD_FRAME_STRINGS_EN.controlsDesktop);
    expect(WORLD_FRAME_STRINGS_EN.controlsDesktop).toMatch(/WASD.*Space.*E/);
    expect(buildHelpDesktopFor(DEFAULT_KEY_HINTS)).toBe(WORLD_FRAME_STRINGS_EN.buildHelpDesktop);
    for (const k of Object.keys(FRAME_STRINGS_EN.tabs)) expect((FRAME_STRINGS_EN.tabs as Record<string, string>)[k]!.length).toBeLessThanOrEqual(8);
    // the connection band stays one line (Latin letters are about half a Hangul syllable wide)
    expect(WORLD_FRAME_STRINGS_EN.offlineBand.length).toBeLessThanOrEqual(WORLD_FRAME_STRINGS_KO.offlineBand.length * 2.2);
  });
});

describe('switching the live strings', () => {
  it('setFrameLang switches every F.x read and back, without changing the tables', () => {
    const tabs = FRAME_STRINGS.tabs;
    setFrameLang('ko');
    expect(frameLang()).toBe('ko');
    expect(FRAME_STRINGS.menu).toBe('메뉴');
    expect(tabs.bag).toBe('소지품'); // nested objects held elsewhere stay live
    expect(FRAME_STRINGS.bookProgress(2, 5)).toBe('2 / 5');
    expect(goLabel('중앙 광장')).toBe('중앙 광장으로 가기');
    expect(compassKo(0)).toBe('남');
    setFrameLang('en');
    expect(FRAME_STRINGS.menu).toBe('Menu');
    expect(tabs.bag).toBe('Bag');
    expect(goLabel('Plaza')).toBe('Go to Plaza');
    expect(compassKo(0)).toBe('south');
    expect(FRAME_STRINGS_KO.menu).toBe('메뉴');
    expect(FRAME_STRINGS_EN.menu).toBe('Menu');
  });

  it('setWorldFrameLang switches the HUD frame keys, band names and help templates; world-lane keys stay', () => {
    const talk = WORLD_STRINGS.talk;
    setWorldFrameLang('ko');
    expect(WORLD_STRINGS.offlineBand).toBe('연결이 잠깐 끊겼어요 · 혼자 모드로 계속 중');
    expect(BAND_NAMES.surface).toBe('지상');
    expect(placeLabel('중앙 광장', 'surface')).toBe('중앙 광장 · 지상');
    expect(clockLabel(10.5, 'clear')).toBe('맑음 10:30');
    expect(controlsDesktopFor(DEFAULT_KEY_HINTS)).toBe(WORLD_FRAME_STRINGS_KO.controlsDesktop);
    setWorldFrameLang('en');
    expect(WORLD_STRINGS.offlineBand).toBe(WORLD_FRAME_STRINGS_EN.offlineBand);
    expect(BAND_NAMES.surface).toBe('Ground');
    expect(clockLabel(21.25, 'clear')).toBe('Night 21:15');
    expect(hotbarCaption([null, null, null, null, null], 0)).toBe(WORLD_FRAME_STRINGS_EN.hotbarAllEmpty);
    expect(WORLD_STRINGS.talk).toBe(talk);
    expect(BAND_NAMES_KO.surface).toBe('지상');
  });

  it('Korean help on the HUD: the band and the low notices carry the Korean in parentheses (not on Korean screens)', () => {
    setWorldFrameLang('en', { helpKo: true });
    expect(WORLD_STRINGS.offlineBand).toBe(`${WORLD_FRAME_STRINGS_EN.offlineBand} (${WORLD_FRAME_STRINGS_KO.offlineBand})`);
    expect(WORLD_STRINGS.lowHunger).toContain(WORLD_FRAME_STRINGS_KO.lowHunger);
    expect(WORLD_STRINGS.lowThirst).toContain(WORLD_FRAME_STRINGS_KO.lowThirst);
    expect(WORLD_STRINGS.ate).toBe(WORLD_FRAME_STRINGS_EN.ate);
    setWorldFrameLang('ko', { helpKo: true });
    expect(WORLD_STRINGS.offlineBand).toBe(WORLD_FRAME_STRINGS_KO.offlineBand);
    setWorldFrameLang('en');
    expect(WORLD_STRINGS.offlineBand).toBe(WORLD_FRAME_STRINGS_EN.offlineBand);
  });
});

describe('Korean help (lang.ts helpKoOn / setHelpKo, one switch with the start screen)', () => {
  it('is kept by lang.ts only: off by default, not in the settings record nor its server copy', () => {
    expect(helpKoOn()).toBe(false);
    expect('helpKo' in DEFAULT_SETTINGS).toBe(false);
    expect('helpKo' in normalizeSettings({ helpKo: true })).toBe(false);
    expect('helpKo' in toServerSettings(DEFAULT_SETTINGS)).toBe(false);
    const seen: boolean[] = [];
    const off = onLearnLang((v) => seen.push(v.helpKo));
    setHelpKo(true);
    expect(helpKoOn()).toBe(true);
    setHelpKo(false);
    off();
    // node has no window events here; in the page the frame hears both changes (frame-menu-shots KO_HELP)
    expect(helpKoOn()).toBe(false);
    expect(seen.every((x) => typeof x === 'boolean')).toBe(true);
  });

  it('the menu shows the Korean line only while it is on and the screen is not Korean', () => {
    expect(koHelpActive()).toBe(false);
    expect(ko((t) => t.tabs.bag)).toBeNull();
    setHelpKo(true);
    expect(ko((t) => t.tabs.bag)).toBe('소지품');
    expect(koOf(FRAME_STRINGS.bagTitle)).toBe(FRAME_STRINGS_KO.bagTitle);
    expect(koOf(FRAME_STRINGS.settingsSavedHere)).toBe(FRAME_STRINGS_KO.settingsSavedHere);
    expect(koOf('not a frame string')).toBeNull();
    setFrameLang('ko');
    expect(ko((t) => t.tabs.bag)).toBeNull();
    expect(koOf(FRAME_STRINGS.bagTitle)).toBeNull();
  });
});
