// docs/21-glossary.md: the product never calls itself a game ('게임', "game", the /game URL) on anything a user sees.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { ALLOW, BANNED, ROOT, bannedIn, scanForbiddenWords, visibleStrings } from '../forbidden-words.mjs';
import { allPages, fillShell, robotsTxt } from '../../apps/web/src/site/prerender.js';

type Hit = { file: string; line: number; id: string; text: string };

describe('forbidden words on user-visible text (docs/21)', () => {
  it('no shipped string, JSX text, HTML title/meta or manifest uses a banned word', () => {
    const hits = scanForbiddenWords() as Hit[];
    expect(hits.map((h) => `${h.file}:${h.line} [${h.id}] ${h.text}`)).toEqual([]);
  });

  it('every pre-rendered public page is free of them too (titles, meta, share tags, body)', () => {
    const shell = fs.readFileSync(path.join(ROOT, 'apps/web/index.html'), 'utf8');
    const pages = allPages();
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) {
      const visible = fillShell(shell, p).replace(/<script[\s\S]*?<\/script>/g, '');
      expect(bannedIn(visible.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')), p.path).toEqual([]);
      for (const m of visible.matchAll(/\b(?:content|alt|title|aria-label)="([^"]*)"/g)) expect(bannedIn(m[1]!, { prose: true }), `${p.path} ${m[0]}`).toEqual([]);
    }
  });

  it('the detector catches strings and JSX text, and ignores comments, identifiers and token props (fault injection)', () => {
    const src = [
      "// 게임 in a comment is fine",
      "/* the old /game path in a block comment */",
      "const a = '영어로 말하는 3D 블록 게임';",
      "const b = <p>Play the game now</p>;",
      "const c = <Button size=\"game\" data-testid=\"game-canvas-viewport\">ok</Button>;",
      "const d = `${origin}/game/?code=${code}`;",
      "const gameState = { size: 'game' };"
    ].join('\n');
    const found = (visibleStrings(src, 'x.tsx') as { text: string; jsx: boolean }[]).flatMap((s) => bannedIn(s.text, { prose: s.jsx }).map((id: string) => `${id}:${s.text.trim()}`));
    expect(found).toEqual(['ko-game:영어로 말하는 3D 블록 게임', 'en-game:Play the game now', 'path-game:/game/?code=']);
  });

  it('closes the holes found in review: absolute links, one-word labels, gaming/minigame, 겜 (fault injection)', () => {
    expect(bannedIn('https://lcw.worldwidesomething.com/game/?code=123')).toEqual(['path-game']);
    expect(bannedIn('lcw.worldwidesomething.com/game')).toEqual(['path-game']);
    for (const label of ['Game', 'Game:', 'Games', 'Gaming', 'GAME', 'GAMING', 'GAMER', 'Minigame', 'Gameplay']) expect(bannedIn(label), label).toEqual(['en-game']);
    expect(bannedIn('a minigame for kids')).toEqual(['en-game']);
    expect(bannedIn('3D game월드')).toEqual(['en-game']);
    expect(bannedIn('겜 하러 가자')).toEqual(['ko-game']);
    const src = 'const e = <button aria-label="Game" title="ok">x</button>;';
    expect((visibleStrings(src, 'x.tsx') as { text: string }[]).flatMap((s) => bannedIn(s.text))).toEqual(['en-game']);
    // still legal: lower-case tokens that are identifiers, other paths
    for (const ok of ['game', 'minigame', 'game-canvas-viewport', 'GameOver', '/games', '/gamer/', '/world/?code=1']) expect(bannedIn(ok), ok).toEqual([]);
  });

  it('every banned word is written down in the glossary, and every allowance has a reason and a real file', () => {
    const glossary = fs.readFileSync(path.join(ROOT, 'docs/21-glossary.md'), 'utf8');
    for (const b of BANNED as { id: string }[]) expect(glossary, b.id).toContain(b.id);
    for (const a of ALLOW as { file: string; why: string }[]) {
      expect(a.why.length, a.file).toBeGreaterThan(10);
      expect(fs.existsSync(path.join(ROOT, a.file)), a.file).toBe(true);
    }
  });

  it('robots.txt keeps both the new and the old world path out of search results', () => {
    const r = robotsTxt();
    expect(r).toContain('Disallow: /world/');
    expect(r).toContain('Disallow: /game/');
  });
});
