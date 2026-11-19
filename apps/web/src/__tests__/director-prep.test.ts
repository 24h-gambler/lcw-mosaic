import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonDirectorConsole, prepFocus } from '../LessonDirector.js';
import { M } from '../directorMoreStrings.js';
import type { AdminStudent } from '../lessonApi.js';

/**
 * The hub's day-record card of a lesson day carries '다음 수업 준비' → /director?prep=<student> (apps/edge ops-cards.ts,
 * operator 11-18: the teacher must see what to do today and how the app helps). The console marks that student's row.
 */

const T0 = Date.parse('2026-11-18T10:00:00+09:00');
const STUDENTS: AdminStudent[] = [
  { player_id: 'stu-aaaa1111', nickname: 'Robin', level: 'L1', birth_year: 2017, family_id: 'f1', last_lesson_at: null, utterances_7d: 0 },
  { player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1', birth_year: 2016, family_id: 'f2', last_lesson_at: T0 - 86_400_000, utterances_7d: 2 }
];
const g = globalThis as { location?: unknown };
const had = 'location' in g;
const saved = g.location;

function render(search: string, students = STUDENTS) {
  g.location = { search, pathname: '/director', hash: '' };
  return renderToStaticMarkup(
    React.createElement(LessonDirectorConsole, {
      initialToken: 'op',
      initialLesson: null,
      initialStudents: students,
      initialSeats: [],
      initialLive: { lessons: [], auto_closed: [] } as never,
      signupQueue: false,
      now: () => T0
    })
  );
}

describe('/director?prep=<student> from the hub day card', () => {
  afterEach(() => {
    if (had) g.location = saved;
    else delete g.location;
  });

  it('reads only a plain student id', () => {
    expect(prepFocus('?prep=stu-29ddc960')).toBe('stu-29ddc960');
    expect(prepFocus('?prep=<script>')).toBeNull();
    expect(prepFocus('?prep=')).toBeNull();
    expect(prepFocus('')).toBeNull();
  });

  it("marks that student's row and its start button, with a line saying what to do", () => {
    const html = render('?prep=stu-29ddc960');
    expect(html).toContain('data-testid="director-prep"');
    expect(html).toContain(M.prepHere('Oreo').replace(/「|」/g, (c) => c));
    expect((html.match(/data-prep="1"/g) ?? []).length).toBe(1);
    expect((html.match(/data-prep-start="1"/g) ?? []).length).toBe(1);
    const row = html.slice(html.indexOf('data-prep="1"'));
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('Oreo');
  });

  it('says so when the card student is not in the list, and marks nothing', () => {
    const html = render('?prep=stu-gone0000');
    expect(html).toContain(M.prepMissing);
    expect(html).not.toContain('data-prep="1"');
  });

  it('without ?prep the list is as before', () => {
    const html = render('');
    expect(html).not.toContain('director-prep');
    expect(html).not.toContain('data-prep');
  });
});
