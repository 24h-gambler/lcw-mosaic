import { describe, expect, it } from 'vitest';
import { OPERATOR_TOKEN_KEY, TEACHER_NAME_KEY, teachFrom, teachTicketBody } from '../TeacherBar.js';
import { startFlowFor } from '../../App.js';

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

  it('asks for the lesson room under the console name ("선생님" when none)', () => {
    const tok = 'x'.repeat(40);
    const named = teachFrom('?teach=les-1', store({ [OPERATOR_TOKEN_KEY]: tok, [TEACHER_NAME_KEY]: ' 김민지<b> ' }))!;
    expect(teachTicketBody(named)).toEqual({ room: 'lesson-les-1', name: '김민지b' });
    expect(teachTicketBody({ lessonId: 'les-1', token: tok, name: null })).toEqual({ room: 'lesson-les-1', name: '선생님' });
  });

  it('goes straight into the world (no title screen)', () => {
    expect(startFlowFor('?teach=les-1', false)).toBe(false);
  });
});
