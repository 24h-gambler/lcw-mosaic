import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UI_STRINGS_KO } from '@lcw/content';
import { MIC_STATUS_KEY, MicCheckGate, readMicStatus } from '../dialog/FirstVisitGuide.js';
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
const F = UI_STRINGS_KO.firstVisit;

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
    const html = renderToStaticMarkup(<MicCheckGate audience="lesson" lessonCode="K7Q2" speech={speech} />);
    expect(html).toContain(F.lessonMicTitle);
    expect(html).toContain('lcw-firstvisit-mic');
    expect(html).not.toContain(F.volume);
    g.sessionStorage!.setItem('lcw.lessonMicChecked:K7Q2', '1');
    expect(renderToStaticMarkup(<MicCheckGate audience="lesson" lessonCode="K7Q2" speech={speech} />)).toBe('');
    // another lesson code checks again
    expect(renderToStaticMarkup(<MicCheckGate audience="lesson" lessonCode="Z9X1" speech={speech} />)).toContain(F.lessonMicTitle);
  });

  it('a guest sees it once on this device, with the headset and volume tips', () => {
    const html = renderToStaticMarkup(<MicCheckGate audience="guest" speech={speech} />);
    expect(html).toContain(F.title);
    expect(html).toContain(F.volume);
    g.localStorage!.setItem('lcw.firstVisitSeen', '1');
    expect(renderToStaticMarkup(<MicCheckGate audience="guest" speech={speech} />)).toBe('');
  });

  it('hidden while a dialog is open; the status is read back for the lesson poll', () => {
    expect(renderToStaticMarkup(<MicCheckGate audience="guest" hidden speech={speech} />)).toBe('');
    expect(readMicStatus()).toBeNull();
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'quiet');
    expect(readMicStatus()).toBe('quiet');
    g.sessionStorage!.setItem(MIC_STATUS_KEY, 'garbage');
    expect(readMicStatus()).toBeNull();
  });
});
