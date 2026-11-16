import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudentScreenBox } from '../DirectorLive.js';
import { EMPTY_DIRECTOR_LIVE, mergeDirectorLive } from '../directorLiveState.js';
import { P } from '../presenceStrings.js';
import { TeacherModeHelp, TeacherPresenceBox, TeacherStatus, startTicker } from '../teacherPresence.js';
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

  it('the live lesson box carries the status line, the 1PC lock number form and the help', () => {
    const api = { presence: vi.fn(), leave: vi.fn(), setPanelPin: vi.fn(), panelPinState: vi.fn(), panelUnlock: vi.fn() } as unknown as LessonApi;
    const html = renderToStaticMarkup(<TeacherPresenceBox api={api} token="op" lessonId="les-1" ended={false} />);
    expect(html).toContain('data-testid="teacher-status"');
    expect(html).toContain('data-testid="panel-pin-input"');
    expect(html).toContain('data-testid="teacher-mode-help"');
    // Server rendering runs no effects: no beat leaves without a browser.
    expect(api.presence).not.toHaveBeenCalled();
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
