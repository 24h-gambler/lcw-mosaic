import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DirectorHandoff, HANDOFF_COPY, WORLD_TEACH_URL, worldTeachUrl } from '../DirectorHandoff.js';
import { App } from '../App.js';

// R331 (Dan 11-23): /director is the teacher's sign-in door and the handoff to the in-world panel.
const noFetch = { signupQueue: false as const };

describe('R331 /director handoff', () => {
  it('signed out: no world button yet, the console sign-in is open', () => {
    const html = renderToStaticMarkup(<DirectorHandoff initialToken={null} console={noFetch} />);
    expect(html).toContain(HANDOFF_COPY.signInFirst);
    expect(html).not.toContain(`href="${WORLD_TEACH_URL}"`);
    expect(html).toMatch(/<details data-testid="director-legacy" open="">/);
  });

  it('signed in: the world button points at the teacher start mode, the ops console folds', () => {
    const html = renderToStaticMarkup(<DirectorHandoff initialToken={'lcwop_' + 'a'.repeat(30)} console={noFetch} />);
    expect(html).toContain(`href="${WORLD_TEACH_URL}"`);
    expect(html).toContain(HANDOFF_COPY.go);
    expect(html).not.toContain(HANDOFF_COPY.signInFirst);
    expect(html).toMatch(/<details data-testid="director-legacy">/);
  });

  it("the hub's '다음 수업 준비' (?prep=) carries the student to the world's start list", () => {
    expect(worldTeachUrl(null)).toBe('/world/?teach=new');
    expect(worldTeachUrl('p-1')).toBe('/world/?teach=new&prep=p-1');
    const html = renderToStaticMarkup(<DirectorHandoff initialToken={'lcwop_' + 'a'.repeat(30)} search="?prep=p-1" console={noFetch} />);
    expect(html).toContain('href="/world/?teach=new&amp;prep=p-1"');
  });

  it('the /director route renders the handoff', () => {
    const html = renderToStaticMarkup(<App initialRoute="/director" />);
    expect(html).toContain('data-testid="director-handoff"');
  });
});
