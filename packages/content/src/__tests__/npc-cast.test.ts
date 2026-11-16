import { describe, expect, it } from 'vitest';
import { FIRST_ERRAND, NPC_CAST_PACKS, NPC_OPENING_LINES, UI_STRINGS_KO, npcCast, npcPersona } from '../index.js';

describe('NPC cast packs (Dan 11-16 "원어민 이름과 말투")', () => {
  const WORLD_NPCS = ['guide', 'cafe_owner', 'shop_owner', 'errand_neighbor'];

  it('every pack names every world NPC, each with its own voice', () => {
    for (const pack of Object.values(NPC_CAST_PACKS)) {
      for (const id of WORLD_NPCS) expect(pack.npcs[id], `${pack.lang}:${id}`).toBeTruthy();
      const voices = Object.values(pack.npcs).map((p) => `${p.voice.engine}:${p.voice.speaker}`);
      expect(new Set(voices).size).toBe(voices.length);
    }
  });

  it('the Korean label carries the short name, and the English names are native ones', () => {
    for (const p of Object.values(npcCast('en').npcs)) {
      expect(p.nameKo).toContain(p.nameKoShort);
      expect(p.nameEn).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(npcPersona('cafe_owner')?.nameEn).toBe('Hannah');
    expect(npcPersona('errand_neighbor')).toMatchObject({ nameEn: 'Mia', nameKoShort: '미아', age: 'child' });
    expect(npcPersona('nobody')).toBeNull();
    expect(npcCast('xx').lang).toBe('en');
  });

  it('UI lines take the names from the pack, never hard-coded', () => {
    const F = UI_STRINGS_KO.firstVisit;
    for (const t of [F.goalErrand, F.goalDeliver, F.walkGiver]) expect(t).toContain('{giver}');
    expect(F.goalOrder).toContain('{cafe}');
    for (const p of Object.values(npcCast('en').npcs)) {
      for (const t of Object.values(F)) expect(t).not.toContain(p.nameKoShort);
    }
  });

  it('the errand giver talks like a native child (no "a cold water")', () => {
    for (const line of Object.values(FIRST_ERRAND.lines)) expect(line).not.toMatch(/\ba (cold|hot) water\b/);
    expect(NPC_OPENING_LINES.errand).toBe(FIRST_ERRAND.lines.ask);
  });
});
