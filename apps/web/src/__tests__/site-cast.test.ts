import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { npcPersona } from '@lcw/content';
import { MEDIA, josa } from '../site/copy.js';

// NPC names on the public site follow the world's cast pack (packages/content npc-cast.ts, #55): no name typed in
// site copy, and none of the names the pack replaced.
describe('site NPC names come from the cast pack', () => {
  it('picture labels name the cast as the game shows them', () => {
    expect(MEDIA.cafeOffers).toContain(npcPersona('cafe_owner')?.nameKo);
    expect(MEDIA.tradeOffers).toContain(npcPersona('shop_owner')?.nameKo);
    expect(MEDIA.guideOffers).toContain(npcPersona('guide')?.nameKo);
  });

  it('puts the right particle after a name', () => {
    expect(josa('카페 주인 해나', '이', '가')).toBe('카페 주인 해나가');
    expect(josa('안내인 루나 선생님', '이', '가')).toBe('안내인 루나 선생님이');
    expect(josa('상점 주인 토비', '과', '와')).toBe('상점 주인 토비와');
    expect(josa('Leo', '이', '가')).toBe('Leo가');
  });

  it('no replaced name is left in site sources or public text files', () => {
    const replaced = /하니|Hani\b|미나|\bMina\b/;
    const roots = ['../site', '../../public'].map((d) => fileURLToPath(new URL(`${d}/`, import.meta.url)));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|json|txt|html|md)$/.test(name)) files.push(p);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((f) => replaced.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
