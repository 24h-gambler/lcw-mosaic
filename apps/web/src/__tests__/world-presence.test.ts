import { describe, expect, it } from 'vitest';
import { WORLD_SEEN_FRESH_MS, worldPresence } from '../lessonApi.js';
import { LESSON_STRINGS_KO } from '../strings.js';

describe("console '접속 중 / 접속 대기' (the teacher comes into the child's world, Dan 11-16 12:10)", () => {
  const now = Date.parse('2026-11-16T15:00:00+09:00');

  it("a world that asked within the window is '접속 중'; a signed-in child whose world is closed is '접속 대기'", () => {
    expect(worldPresence(now - 4_000, 1, now)).toBe('in_world');
    expect(worldPresence(now - WORLD_SEEN_FRESH_MS + 1, 1, now)).toBe('in_world');
    expect(worldPresence(now - WORLD_SEEN_FRESH_MS, 1, now)).toBe('waiting');
    expect(worldPresence(null, 2, now)).toBe('waiting');
    // seen once, devices since unlinked: still a signed-in child, just not here now
    expect(worldPresence(now - 3_600_000, 0, now)).toBe('waiting');
  });

  it('no signed-in device: the 6-digit code is the way in, so the console keeps it up front', () => {
    expect(worldPresence(null, 0, now)).toBe('no_device');
    expect(worldPresence(undefined, undefined, now)).toBe('no_device');
  });

  it('the lines name the child and never ask the child to type anything', () => {
    const d = LESSON_STRINGS_KO.director;
    expect(d.worldIn('Oreo')).toContain('접속 중');
    expect(d.worldIn('Oreo')).toContain('Oreo');
    expect(d.worldWaiting('Oreo')).toContain('접속 대기');
    expect(d.worldInHelp).toContain('아무것도 누르지 않아요');
  });
});
