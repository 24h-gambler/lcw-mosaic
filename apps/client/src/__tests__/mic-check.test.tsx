import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UI_STRINGS_EN, UI_STRINGS_KO } from '@lcw/content';
import { MIC_STATUS_KEY, MicCheckGate, closeMicCheckOnStageMove, micCheckAudience, micChipText, micGateView, readMicStatus } from '../dialog/FirstVisitGuide.js';
import { createScriptedSpeechEngine } from '../dialog/speech.js';

/** Audit G15 (11-16): lesson students and guests also get the "Hello!" mic check before their first dialog. */

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v))
  };
}

const g = globalThis as unknown as { sessionStorage?: Storage; localStorage?: Storage };
const saved = { s: g.sessionStorage, l: g.localStorage };
const speech = createScriptedSpeechEngine([]);
const F = UI_STRINGS_EN.firstVisit;

describe('mic check gate (lesson students, guests)', () => {
  beforeEach(() => {
    g.sessionStorage = memoryStorage();
    g.localStorage = memoryStorage();
  });
  afterEach(() => {
    g.sessionStorage = saved.s;
    g.localStorage = saved.l;
  });

  it('a lesson student sees the mic check once per lesson, without the guardian tips', () => {
    const html = renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="K7Q2" speech={speech} />);
    expect(html).toContain(F.lessonMicTitle);
    expect(html).toContain('lcw-firstvisit-mic');
    expect(html).not.toContain(F.volume);
    g.sessionStorage!.setItem('lcw.lessonMicChecked:K7Q2', '1');
    // checked: only the small HUD mic chip from now on, never the card again by itself
    const after = renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="K7Q2" speech={speech} />);
    expect(after).not.toContain(F.lessonMicTitle);
    expect(after).toContain('lcw-mic-chip');
    // another lesson code checks again
    expect(renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="Z9X1" speech={speech} />)).toContain(F.lessonMicTitle);
  });

  it('a guest sees it once on this device, with the headset and volume tips', () => {
    const html = renderToStaticMarkup(<MicCheckGate identityKind="guest" speech={speech} />);
    expect(html).toContain(F.title);
    expect(html).toContain(F.volume);
    g.localStorage!.setItem('lcw.firstVisitSeen', '1');
    expect(renderToStaticMarkup(<MicCheckGate identityKind="guest" speech={speech} />)).toBe('');
  });

  it('hidden while a dialog is open; the status is read back for the lesson poll', () => {
    expect(renderToStaticMarkup(<MicCheckGate identityKind="guest" hidden speech={speech} />)).toBe('');
    expect(readMicStatus()).toBeNull();
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'quiet');
    expect(readMicStatus()).toBe('quiet');
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'garbage');
    expect(readMicStatus()).toBeNull();
  });

  it('a student session from /join on a bare /world/ is a lesson student, keyed by the lesson id (lesson lane 11-16)', () => {
    g.sessionStorage!.setItem('lcw.studentToken', 't'.repeat(40));
    g.sessionStorage!.setItem('lcw.studentLessonId', 'les_abc');
    expect(micCheckAudience('guest')).toEqual({ audience: 'lesson', keys: ['lcw.lessonMicChecked:les_abc'] });
    expect(micCheckAudience('child')?.audience).toBe('lesson');
    expect(micCheckAudience('lesson', '123456')?.keys).toEqual(['lcw.lessonMicChecked:les_abc', 'lcw.lessonMicChecked:123456']);
    const html = renderToStaticMarkup(<MicCheckGate identityKind="guest" speech={speech} />);
    expect(html).toContain(F.lessonMicTitle);
    expect(html).not.toContain(F.volume);
    // checked through the ?code= way before the join answered -> still counts once the session holds the lesson id
    g.sessionStorage!.setItem('lcw.lessonMicChecked:123456', '1');
    expect(renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="123456" speech={speech} />)).not.toContain(F.lessonMicTitle);
  });

  it('once per lesson on this device: a reload or a second tab (new sessionStorage) shows the chip, not the card', () => {
    g.localStorage!.setItem('lcw.lessonMicChecked:K7Q2', '1');
    expect(micGateView('lesson', 'K7Q2', {})).toBe('chip');
    const html = renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="K7Q2" speech={speech} />);
    expect(html).not.toContain(F.lessonMicTitle);
    expect(html).toContain(F.micChipSkipped);
  });

  it('a stage move while the card is still open closes it for good: skipped, then only the chip (production smoke 11-18)', () => {
    expect(micGateView('lesson', 'K7Q2', {})).toBe('card');
    expect(closeMicCheckOnStageMove('lesson', 'K7Q2')).toBe(true);
    expect(readMicStatus()).toBe('skipped');
    expect(g.sessionStorage!.getItem('lcw.lessonMicChecked:K7Q2')).toBe('1');
    expect(g.localStorage!.getItem('lcw.lessonMicChecked:K7Q2')).toBe('1');
    expect(micGateView('lesson', 'K7Q2', {})).toBe('chip');
    // every later stage move leaves it alone; the card comes back only when the child taps the chip
    expect(closeMicCheckOnStageMove('lesson', 'K7Q2')).toBe(false);
    expect(micGateView('lesson', 'K7Q2', {})).toBe('chip');
    expect(micGateView('lesson', 'K7Q2', { reopen: true })).toBe('card');
    // hidden (title screen, a solo dialog) hides the chip too
    expect(micGateView('lesson', 'K7Q2', { hidden: true })).toBeNull();
  });

  it('closing on a stage move keeps a status a mic turn already found; guests and device children are not touched', () => {
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'ok');
    expect(closeMicCheckOnStageMove('lesson', 'K7Q2')).toBe(true);
    expect(readMicStatus()).toBe('ok');
    expect(closeMicCheckOnStageMove('guest')).toBe(false);
    expect(closeMicCheckOnStageMove('child')).toBe(false);
    expect(g.localStorage!.getItem('lcw.firstVisitSeen')).toBeNull();
  });

  it('the chip says the mic status in words, Korean too', () => {
    expect(micChipText('ok')).toBe(F.micChipOk);
    expect(micChipText('quiet')).toBe(F.micChipQuiet);
    expect(micChipText('none')).toBe(F.micChipNone);
    expect(micChipText('skipped')).toBe(F.micChipSkipped);
    expect(micChipText(null)).toBe(F.micChipSkipped);
    for (const k of ['micChipOk', 'micChipQuiet', 'micChipNone', 'micChipSkipped', 'micChipHint'] as const) {
      expect(UI_STRINGS_KO.firstVisit[k]).toMatch(/[가-힣]/);
    }
    g.sessionStorage!.setItem('lcw.lessonMicChecked:K7Q2', '1');
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'none');
    const html = renderToStaticMarkup(<MicCheckGate identityKind="lesson" lessonCode="K7Q2" speech={speech} />);
    expect(html).toContain(F.micChipNone);
    expect(html).toContain('data-status="none"');
  });

  it('a child with a device gets the check inside the first-visit intro, not here', () => {
    expect(micCheckAudience('child')).toBeNull();
    expect(renderToStaticMarkup(<MicCheckGate identityKind="child" speech={speech} />)).toBe('');
  });
});
