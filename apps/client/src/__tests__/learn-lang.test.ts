import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LEARN_LANGS, readLearnLang } from '@lcw/content';
import {
  HELP_KO_KEY,
  LEARN_LANG_KEY,
  helpKoOn,
  learnLang,
  learnLangChosen,
  onLearnLang,
  resetLangForTest,
  say,
  setHelpKo,
  setLearnLang
} from '../world/lang.js';

// node has no window: a memory localStorage and an event target stand in for it
beforeAll(() => {
  const m = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear()
  };
  const bus = new EventTarget();
  g.addEventListener = bus.addEventListener.bind(bus);
  g.removeEventListener = bus.removeEventListener.bind(bus);
  g.dispatchEvent = bus.dispatchEvent.bind(bus);
});

afterEach(() => {
  localStorage.clear();
  resetLangForTest();
});

describe('learn language (Dan 11-16: the screen speaks the language the child learns)', () => {
  it('only open languages are kept; English is the one open now', () => {
    expect(LEARN_LANGS.filter((l) => l.ready).map((l) => l.id)).toEqual(['en']);
    expect(readLearnLang('en')).toBe('en');
    expect(readLearnLang('ja')).toBeNull();
    expect(readLearnLang(undefined)).toBeNull();
  });

  it('speaks English before a choice, remembers the choice on the device and announces it', () => {
    expect(learnLangChosen()).toBe(false);
    expect(learnLang()).toBe('en');
    const seen: Array<{ learnLang: string; helpKo: boolean }> = [];
    const off = onLearnLang((v) => seen.push(v));
    setLearnLang('en');
    expect(localStorage.getItem(LEARN_LANG_KEY)).toBe('en');
    expect(learnLangChosen()).toBe(true);
    setLearnLang('ja' as never);
    expect(localStorage.getItem(LEARN_LANG_KEY)).toBe('en');
    setHelpKo(true);
    expect(localStorage.getItem(HELP_KO_KEY)).toBe('1');
    off();
    setHelpKo(false);
    expect(seen).toEqual([
      { learnLang: 'en', helpKo: false },
      { learnLang: 'en', helpKo: true }
    ]);
  });

  it('Korean help is off by default and adds the Korean line only when on and different', () => {
    expect(helpKoOn()).toBe(false);
    expect(say({ en: 'Make my world', ko: '내 월드 만들기' })).toEqual({ text: 'Make my world', help: null });
    setHelpKo(true);
    expect(say({ en: 'Make my world', ko: '내 월드 만들기' })).toEqual({ text: 'Make my world', help: '내 월드 만들기' });
    expect(say({ en: 'LCW', ko: 'LCW' })).toEqual({ text: 'LCW', help: null });
  });
});
