// R331: who E and the talk prompt reach among NPCs in reach (visitor.npcTalkScore, the engine's own ranking).
import { describe, expect, it } from 'vitest';
import { npcTalkScore } from '../visitor.js';

const pick = (cands: Array<{ id: string; dist: number; off: number; passer?: boolean; realTeacher?: boolean }>): string =>
  cands
    .map((c) => ({ id: c.id, s: npcTalkScore({ dist: c.dist, off: c.off, passer: c.passer ?? false, realTeacher: c.realTeacher ?? false }) }))
    .sort((a, b) => a.s - b.s)[0]!.id;

describe('npcTalkScore', () => {
  it('the real teacher straight ahead wins over the guide at the child’s feet (live 11-24: 2 m vs 0.8 m)', () => {
    expect(pick([{ id: 'guide', dist: 0.8, off: 0 }, { id: 'teacher', dist: 2, off: 0, realTeacher: true }])).toBe('teacher');
  });
  it('the teacher figure with no real teacher in the room does not jump the queue', () => {
    expect(pick([{ id: 'guide', dist: 0.8, off: 0 }, { id: 'teacher', dist: 2, off: 0 }])).toBe('guide');
  });
  it('the real teacher behind the child does not take E from the NPC in front', () => {
    expect(pick([{ id: 'guide', dist: 1.5, off: 0.1 }, { id: 'teacher', dist: 1.5, off: 2.8, realTeacher: true }])).toBe('guide');
  });
  it('a passer-by still loses to the lesson NPC when both are in front (+1.5)', () => {
    expect(pick([{ id: 'cafe_owner', dist: 2, off: 0.2 }, { id: 'walker', dist: 1.2, off: 0.1, passer: true }])).toBe('cafe_owner');
  });
  it('one in front beats one just behind the back (R2625 ④)', () => {
    expect(pick([{ id: 'a', dist: 1, off: 2 }, { id: 'b', dist: 2.5, off: 0.1 }])).toBe('b');
  });
});
