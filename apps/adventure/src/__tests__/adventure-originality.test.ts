import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS } from '@lcw/content';
import { S } from '../ui/strings.js';

/**
 * docs/22 1장: the genre form is shared (walk, meet, turn-based, dodge with a small marker, win by talking), but every
 * name, line, picture and tune here is our own. This guards against borrowed names and the famous command labels
 * creeping in. The list names the work it guards against so a reviewer can see what is checked; it lives only here.
 */
const BORROWED = [
  /undertale/i,
  /deltarune/i,
  /toby\s*fox/i,
  /\bfrisk\b/i,
  /\bchara\b/i,
  /\btoriel\b/i,
  /\bsans\b(?!-serif)/i,
  /\bpapyrus\b/i,
  /\bundyne\b/i,
  /\balphys\b/i,
  /\basgore\b/i,
  /\basriel\b/i,
  /\bflowey\b/i,
  /\bmettaton\b/i,
  /\bnapstablook\b/i,
  /\btemmie\b/i,
  /\bmuffet\b/i,
  /\bgaster\b/i,
  /\bgrillby\b/i,
  /\bfroggit\b/i,
  /\bwhimsun\b/i,
  /\bmoldsmal\b/i,
  /\bsnowdin\b/i,
  /\bhotland\b/i,
  /\bthe underground\b/i,
  /\bthe ruins\b/i,
  /\bdetermination\b/i,
  /\bmegalovania\b/i,
  /\bsave point\b/i,
  // look-alikes found in review (11-16): a rhyme of the first meeting, its moth-like partner, another series' ink people
  /\bsprigget\b/i,
  /\bpuffmoth\b/i,
  /\binklings?\b/i,
  /splatoon/i,
  /언더테일/,
  /델타룬/
];

const ROOT = path.resolve(__dirname, '../../../..');
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx|html|md|json)$/.test(d.name) ? [p] : [];
  });
}

describe('adventure originality (docs/22 1장)', () => {
  it('no borrowed names, places or terms in the adventure sources, content and spec', () => {
    const scan = [
      ...files(path.join(ROOT, 'apps/adventure/src')),
      path.join(ROOT, 'apps/adventure/index.html'),
      path.join(ROOT, 'packages/content/src/adventure.ts'),
      path.join(ROOT, 'docs/22-adventure.md')
    ];
    const hits: string[] = [];
    for (const f of scan) {
      // the spec quotes the operator's request word for word (that line names the inspiration, nothing else may)
      const text = fs
        .readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !(f.endsWith('22-adventure.md') && l.startsWith('- 운영자 말')))
        .join('\n');
      for (const re of BORROWED) {
        const m = re.exec(text);
        if (m) hits.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('our own command words, not the famous four; the marker is a speech bubble, not a heart', () => {
    const labels = Object.values(S.cmd).map((c) => c.en);
    expect(labels).toEqual(['POKE', 'TALK', 'POUCH', 'FRIEND']);
    for (const l of ['FIGHT', 'ACT', 'ITEM', 'MERCY', 'SPARE']) expect(labels).not.toContain(l);
    const sprites = fs.readFileSync(path.join(ROOT, 'apps/adventure/src/art/sprites.ts'), 'utf8');
    expect(sprites).toMatch(/speech bubble/i);
    expect(sprites).not.toMatch(/heart/i);
    for (const f of files(path.join(ROOT, 'apps/adventure/src'))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/[❤♥💗💖]/u);
  });

  it('every islander, island and guardian has a name of its own, English and Korean', () => {
    const names = ADVENTURE_CHAPTERS.flatMap((c) => [c.islandEn, c.guardian.nameEn, ...c.critters.map((x) => x.nameEn)]);
    expect(new Set(names).size).toBe(names.length);
    for (const c of ADVENTURE_CHAPTERS) {
      expect(c.islandKo).toMatch(/[가-힣]/);
      for (const x of [c.guardian, ...c.critters]) expect(x.nameKo).toMatch(/[가-힣]/);
    }
  });
});
