import { describe, expect, it } from 'vitest';
import { FIRST_ERRAND, NPC_CAST_PACKS, NPC_OPENING_LINES, UI_STRINGS_KO, npcCast, npcPersona } from '../index.js';

describe('NPC cast packs (Dan 11-16 "원어민 이름과 말투")', () => {
  const WORLD_NPCS = ['guide', 'cafe_owner', 'shop_owner', 'errand_neighbor', 'trail_ranger'];

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

describe('the trail ranger out in the open land (R2904①)', () => {
  it('has a name, a voice of its own, an opening line and a bank at every level it can be asked at', async () => {
    const { NPC_REVISIT_LINES, lookupPhraseBank } = await import('../index.js');
    expect(npcPersona('trail_ranger')).toMatchObject({ nameEn: 'Rowan', age: 'adult' });
    expect(npcCast('en').ctxNpc.ranger).toBe('trail_ranger');
    expect(NPC_OPENING_LINES.ranger).toMatch(/\?$/);
    expect(NPC_REVISIT_LINES.ranger!.length).toBeGreaterThanOrEqual(3);
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      const e = lookupPhraseBank({ ctx: 'ranger', level });
      expect(e?.offers).toHaveLength(3);
      expect(e!.offers.every((o) => o.price === 0)).toBe(true);
    }
  });
});
