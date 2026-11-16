// HUD follows the player's settings (G14): key names in the help lines, syllable marks for the target sentence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setFrameLang } from '../frame/strings.js';
import { syllabify, syllabifySentence, syllablesOf } from '../frame/syllables.js';
import { keyHintsOf } from '../frame/FrameLayer.js';
import { DEFAULT_KEYS } from '../frame/settings.js';
import { WORLD_STRINGS as W, DEFAULT_KEY_HINTS, buildHelpDesktopFor, controlsDesktopFor, setWorldFrameLang } from '../world/strings.js';

// This file checks the Korean copy: pin the screen language to Korean (by default it follows the learn language).
beforeAll(() => {
  setFrameLang('ko');
  setWorldFrameLang('ko');
});
afterAll(() => {
  setFrameLang('en');
  setWorldFrameLang('en');
});

describe('syllable marks (docs/08 11장 읽기)', () => {
  it.each([
    ['cookie', 'coo·kie'],
    ['water', 'wa·ter'],
    ['honey', 'ho·ney'],
    ['banana', 'ba·na·na'],
    ['chocolate', 'cho·co·late'],
    ['table', 'ta·ble'],
    ['little', 'lit·tle'],
    ['apple', 'ap·ple'],
    ['window', 'win·dow'],
    ['orange', 'o·range'],
    ['wanted', 'wan·ted'],
    ['please', 'please'],
    ['likes', 'likes'],
    ['have', 'have'],
    ['kite', 'kite'],
    ['tea', 'tea'],
    ['I', 'I']
  ])('%s -> %s', (w, want) => {
    expect(syllablesOf(w).join('·')).toBe(want);
  });
  it('keeps capitals and punctuation, and the letters never change', () => {
    expect(syllabify('Cookie,')).toBe('Coo·kie,');
    expect(syllabify('please?')).toBe('please?');
    const s = 'Can I have a cookie, please? The honey tea is warm.';
    const out = syllabifySentence(s);
    expect(out).toBe('Can I have a coo·kie, please? The ho·ney tea is warm.');
    expect(out.replace(/·/g, '')).toBe(s);
  });
});

describe('HUD key hints follow the remapped keys', () => {
  it('default keys give the same help line as before', () => {
    expect(keyHintsOf(DEFAULT_KEYS)).toEqual(DEFAULT_KEY_HINTS);
    expect(controlsDesktopFor(DEFAULT_KEY_HINTS)).toBe(W.controlsDesktop);
    expect(buildHelpDesktopFor(DEFAULT_KEY_HINTS)).toBe(W.buildHelpDesktop);
  });
  it('a changed key shows up in the line (arrows-style move keys are joined)', () => {
    const k = keyHintsOf({ ...DEFAULT_KEYS, talk: 'KeyF', forward: 'KeyZ', left: 'KeyQ', jump: 'ShiftLeft' });
    expect(k.talk).toBe('F');
    expect(k.move).toBe('ZQSD');
    expect(controlsDesktopFor(k)).toContain('F 말 걸기');
    expect(controlsDesktopFor(k)).toContain('왼쪽 Shift 점프');
    const odd = keyHintsOf({ ...DEFAULT_KEYS, forward: 'Numpad8' });
    expect(odd.move).toBe('Num 8/A/S/D');
  });
});
