import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudentScreenBox } from '../DirectorLive.js';
import { EMPTY_DIRECTOR_LIVE, mergeDirectorLive } from '../directorLiveState.js';
import { P } from '../presenceStrings.js';
import { TeacherModeHelp, TeacherPresenceBox, TeacherStatus, cleanTeacherName, startTicker } from '../teacherPresence.js';
import type { LessonApi } from '../lessonApi.js';

const T0 = Date.parse('2026-11-16T15:00:00+09:00');

describe('teacher presence on the director console', () => {
  it('help sheet: both setups are written out (1PC 로 할 때 / 2PC 로 할 때)', () => {
    const html = renderToStaticMarkup(<TeacherModeHelp />);
    expect(html).toContain('data-testid="teacher-mode-help"');
    expect(html).toContain(P.help1pcTitle);
    expect(html).toContain(P.help2pcTitle);
    for (const line of [...P.help1pc, ...P.help2pc]) expect(html).toContain(line.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  });

  it('help promises only what exists: no browser-reserved shortcut, no "teacher speaks" feature, warns about /director', () => {
    const all = [...P.help1pc, ...P.help2pc].join(' ');
    expect(all).not.toContain('Ctrl+Shift+T');
    expect(all).toContain('Ctrl+Alt+T');
    expect(all).not.toContain('선생님 말하기');
    expect(all).toContain('/director');
  });

  it('the live lesson box carries the status line, the 1PC lock number form and the help', () => {
    const api = { presence: vi.fn(), leave: vi.fn(), setPanelPin: vi.fn(), panelPinState: vi.fn(), panelUnlock: vi.fn() } as unknown as LessonApi;
    const html = renderToStaticMarkup(<TeacherPresenceBox api={api} token="op" lessonId="les-1" ended={false} />);
    expect(html).toContain('data-testid="teacher-status"');
    expect(html).toContain('data-testid="panel-pin-input"');
    expect(html).toContain('data-testid="teacher-mode-help"');
    // Server rendering runs no effects: no beat leaves without a browser.
    expect(api.presence).not.toHaveBeenCalled();
  });

  it('teacher name: the console box has the field; only names the server accepts are sent', () => {
    const api = { presence: vi.fn(), leave: vi.fn(), setPanelPin: vi.fn(), panelPinState: vi.fn(() => new Promise(() => undefined)), panelUnlock: vi.fn() } as unknown as LessonApi;
    expect(renderToStaticMarkup(<TeacherPresenceBox api={api} token="op" lessonId="les-1" ended={false} />)).toContain('data-testid="teacher-name-input"');
    expect(cleanTeacherName('  김민지 선생님 ')).toBe('김민지');
    expect(cleanTeacherName('')).toBeNull();
    expect(cleanTeacherName('x'.repeat(21))).toBeNull();
    expect(cleanTeacherName('a<b>')).toBeNull();
    expect(cleanTeacherName(`a${String.fromCharCode(9)}b`)).toBeNull();
    expect(cleanTeacherName(null)).toBeNull();
  });

  it('status line says with the teacher or alone', () => {
    const on = renderToStaticMarkup(<TeacherStatus teacher={{ present: true, name: 'Dan', since: T0, tracked: true, panel: 'open' }} failing={false} />);
    const off = renderToStaticMarkup(<TeacherStatus teacher={{ present: false, name: null, since: null, tracked: true, panel: null }} failing={false} />);
    expect(on).not.toEqual(off);
    expect(on).toContain(P.consolePresent);
    expect(off).toContain(P.consoleAbsent);
    expect(off).toContain('data-present="0"');
  });

  it('student row shows the mic check result', () => {
    const live = mergeDirectorLive(EMPTY_DIRECTOR_LIVE, {
      server_now: T0,
      student_view: { connected: true, last_seen_at: T0, scene_id: 'honey_cafe', expected_scene_id: 'honey_cafe', ui: '3d', mic: 'quiet' }
    } as never, T0);
    const html = renderToStaticMarkup(<StudentScreenBox live={live} localNow={T0} startedAt={T0} />);
    expect(html).toContain('data-testid="student-mic"');
    expect(html).toContain(P.mic('quiet'));
    for (const m of ['ok', 'quiet', 'none', 'skipped', null] as const) expect(P.mic(m)).toMatch(/^마이크: /);
    expect(new Set(['ok', 'quiet', 'none', 'skipped'].map((m) => P.mic(m as never))).size).toBe(4);
  });

  it('ticker: a worker when the page can make one (hidden tabs keep beating), else setInterval', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: (() => void) | null = null;
      constructor(public url: string) {}
      postMessage(m: unknown) {
        posted.push(m);
      }
      terminate() {
        posted.push('terminated');
      }
    }
    const fn = vi.fn();
    const t = startTicker(fn, 15_000, { Worker: FakeWorker as never, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined } as never, Blob: Blob });
    expect(posted).toEqual([15_000]);
    t.stop();
    expect(posted).toEqual([15_000, 0, 'terminated']);

    vi.useFakeTimers();
    try {
      const g = vi.fn();
      const t2 = startTicker(g, 15_000, {});
      vi.advanceTimersByTime(45_000);
      expect(g).toHaveBeenCalledTimes(3);
      t2.stop();
      vi.advanceTimersByTime(45_000);
      expect(g).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
