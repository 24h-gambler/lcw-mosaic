import { describe, expect, it } from 'vitest';
import { TEACHER_NAME_MAX, normalizeTeacherName, teacherLabel } from '../teacher-name.js';

describe('teacher name on the child screen (review #80: the title exactly once)', () => {
  it('label: name + 선생님, never twice; no name → 선생님', () => {
    expect(teacherLabel('김민지')).toBe('김민지 선생님');
    expect(teacherLabel('김민지 선생님')).toBe('김민지 선생님');
    expect(teacherLabel('김민지선생님')).toBe('김민지 선생님');
    expect(teacherLabel('Dan')).toBe('Dan 선생님');
    expect(teacherLabel('선생님')).toBe('선생님');
    expect(teacherLabel('')).toBe('선생님');
    expect(teacherLabel(null)).toBe('선생님');
    expect(teacherLabel(undefined)).toBe('선생님');
  });
  it('normalize: name alone, trimmed, capped, no control characters or angle brackets', () => {
    expect(normalizeTeacherName('  김민지 선생님 ')).toBe('김민지');
    expect(normalizeTeacherName('x'.repeat(TEACHER_NAME_MAX))).toBe('x'.repeat(TEACHER_NAME_MAX));
    expect(normalizeTeacherName('x'.repeat(TEACHER_NAME_MAX + 1))).toBeNull();
    expect(normalizeTeacherName('a<b>')).toBeNull();
    expect(normalizeTeacherName(`a${String.fromCharCode(9)}b`)).toBeNull();
    expect(normalizeTeacherName('   ')).toBeNull();
  });
});
