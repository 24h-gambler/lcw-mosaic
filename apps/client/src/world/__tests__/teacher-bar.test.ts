import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OPERATOR_TOKEN_KEY, TEACHER_NAME_KEY, TS, TeacherBar, teachFrom, teachPrepFrom, teachSignInRedirect, teachStartPick, teachTicketBody } from '../TeacherBar.js';
import type { WorldHandle } from '../api.js';
import { startFlowFor } from '../../App.js';
import { TEACHER_STOCK, tradeOffers } from '@lcw/content';

const store = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });

describe('teacher in the world (?teach=, docs/02 §11)', () => {
  it('needs both a lesson id and the console sign-in on this browser', () => {
    const tok = 'lcwop_' + 'a'.repeat(30);
    expect(teachFrom('?teach=les-20261116-ab12', store({ [OPERATOR_TOKEN_KEY]: tok }))).toEqual({ lessonId: 'les-20261116-ab12', token: tok, name: null });
    expect(teachFrom('?teach=les-20261116-ab12', store({}))).toBeNull();
    expect(teachFrom('?teach=../admin', store({ [OPERATOR_TOKEN_KEY]: tok }))).toBeNull();
    expect(teachFrom('?scene=plaza', store({ [OPERATOR_TOKEN_KEY]: tok }))).toBeNull();
    expect(teachFrom('?teach=les-1', store({ [OPERATOR_TOKEN_KEY]: 'short' }))).toBeNull();
  });

  it('R331: a teacher address without a sign-in goes to the sign-in door, never the world as a plain player', () => {
    const tok = 'lcwop_' + 'a'.repeat(30);
    expect(teachSignInRedirect('?teach=new', store({}))).toBe('/director');
    expect(teachSignInRedirect('?teach=les-20261124-ab12', store({ [OPERATOR_TOKEN_KEY]: 'short' }))).toBe('/director');
    expect(teachSignInRedirect('?teach=new', store({ [OPERATOR_TOKEN_KEY]: tok }))).toBeNull();
    // a child's world (no teacher address, or a junk one) is never sent away
    expect(teachSignInRedirect('', store({}))).toBeNull();
    expect(teachSignInRedirect('?code=123456', store({}))).toBeNull();
    expect(teachSignInRedirect('?teach=../admin', store({}))).toBeNull();
  });

  it("R331: the hub's '다음 수업 준비' student is picked first in the world's start list", () => {
    const list = [{ player_id: 'p-a', nickname: 'A' }, { player_id: 'p-b', nickname: 'B' }];
    expect(teachPrepFrom('?teach=new&prep=p-b')).toBe('p-b');
    expect(teachPrepFrom('?teach=new&prep=../x')).toBeNull();
    expect(teachStartPick(list, 'p-b')).toBe('p-b');
    expect(teachStartPick(list, 'p-gone')).toBe('p-a');
    expect(teachStartPick(list, null)).toBe('p-a');
    expect(teachStartPick([], 'p-b')).toBe('');
  });

  it('asks for the lesson room under the console name ("선생님" when none)', () => {
    const tok = 'x'.repeat(40);
    const named = teachFrom('?teach=les-1', store({ [OPERATOR_TOKEN_KEY]: tok, [TEACHER_NAME_KEY]: ' 김민지<b> ' }))!;
    expect(teachTicketBody(named)).toEqual({ room: 'lesson-les-1', name: '김민지b' });
    expect(teachTicketBody({ lessonId: 'les-1', token: tok, name: null })).toEqual({ room: 'lesson-les-1', name: '선생님' });
  });

  it('R331: ?teach=new opens start mode (no lesson room until it opens)', () => {
    const tok = 'x'.repeat(40);
    expect(teachFrom('?teach=new', store({ [OPERATOR_TOKEN_KEY]: tok }))).toEqual({ lessonId: 'new', token: tok, name: null });
    expect(teachFrom('?teach=new', store({}))).toBeNull();
    expect(teachTicketBody({ lessonId: 'new', token: tok, name: null })).toBeNull();
    expect(startFlowFor('?teach=new', false)).toBe(false);
  });

  it('R331: the in-world panel runs the lesson (targets, F1/F2 pins, end) and starts one', () => {
    const world = { getStats: () => ({ peers: 0 }) } as unknown as WorldHandle;
    const session = { lessonId: 'les-1', token: 'x'.repeat(40), name: null };
    const live = renderToStaticMarkup(React.createElement(TeacherBar, { world, session, room: { status: 'in', takeOver: () => undefined } }));
    expect(live).toContain(TS.targetPlaceholder);
    expect(live).toContain(TS.pinCoaching);
    expect(live).toContain(TS.pinExpression);
    expect(live).toContain(TS.endLesson);
    expect(live).toContain(TS.askTitle);
    expect(live).toContain(TS.askSend);
    // The trade offer is one of the sentences the server scores (item name only = ⭐1, more = ⭐2·⭐3), not free text.
    const offers = tradeOffers({ getKey: TEACHER_STOCK[0]!.key });
    expect(offers.map((o) => o.stars)).toEqual([1, 2, 3]);
    for (const o of offers) expect(live).toContain(o.text.replace(/'/g, '&#x27;'));
    expect(live).toContain('data-testid="teach-ask-sentence"');
    const start = renderToStaticMarkup(
      React.createElement(TeacherBar, { world, session: { lessonId: 'new', token: 'x'.repeat(40), name: null }, room: null })
    );
    expect(start).toContain(TS.startTitle);
    expect(start).not.toContain(TS.pinCoaching);
  });

  it('goes straight into the world (no title screen)', () => {
    expect(startFlowFor('?teach=les-1', false)).toBe(false);
  });

  it('another tab of this teacher holding the seat shows here with a way back', () => {
    const world = { getStats: () => ({ peers: 0 }) } as unknown as WorldHandle;
    const session = { lessonId: 'les-1', token: 'x'.repeat(40), name: null };
    const html = (status: string) =>
      renderToStaticMarkup(React.createElement(TeacherBar, { world, session, room: { status, takeOver: () => undefined } }));
    expect(html('replaced')).toContain(TS.replaced);
    expect(html('replaced')).toContain(TS.takeOver);
    expect(html('replaced')).not.toContain(TS.goNear);
    expect(html('in')).not.toContain(TS.takeOver);
    expect(html('in')).toContain(TS.goNear);
  });
});
