// App shell rules for dialog results (docs/19 3장, 5장): no invented items, one ledger, guide walks, 3D fallback.
import { describe, expect, it } from 'vitest';
import { createResultPlayer, guideDestination, type DialogResultLike } from '../../App.js';
import { FrameFloorWatch } from '../tiers.js';
import type { NpcRef } from '../api.js';

function fakeWorld() {
  const log: string[] = [];
  return {
    log,
    celebrate: (s: 0 | 1 | 2 | 3) => log.push(`stars:${s}`),
    giveItem: (k: string) => log.push(`item:${k}`),
    setCoins: (n: number | null) => log.push(`coins:${n}`)
  };
}

const cafe: NpcRef = { id: 'cafe_owner', nameKo: '카페 주인 하니', nameEn: 'Honey', ctx: 'cafe' } as NpcRef;
const guide: NpcRef = { id: 'guide', nameKo: '안내인', nameEn: 'Mina', ctx: 'guide' } as NpcRef;

describe('dialog result player', () => {
  it('gives nothing when the server names no item (no free honey tea, solo or lesson)', () => {
    const w = fakeWorld();
    createResultPlayer(w)({ pass: true, stars: 3, feedbackKo: '' });
    expect(w.log).toEqual(['stars:3']);
  });

  it('puts the server-named item in hand once, even when the window reports again on close', () => {
    const w = fakeWorld();
    const play = createResultPlayer(w);
    const r: DialogResultLike = { pass: true, stars: 2, feedbackKo: '', itemKey: 'honey_tea', coinsTotal: 14 };
    play(r);
    play(r); // ✕ / Esc after the pass reports the best result again
    expect(w.log).toEqual(['coins:14', 'stars:2', 'item:honey_tea', 'coins:14']);
  });

  it('celebrates only better stars; a fail says "again" only before any pass', () => {
    const w = fakeWorld();
    const play = createResultPlayer(w);
    play({ pass: false, stars: 0, feedbackKo: '' });
    play({ pass: true, stars: 1, feedbackKo: '' });
    play({ pass: false, stars: 0, feedbackKo: '' });
    play({ pass: true, stars: 3, feedbackKo: '' });
    play({ pass: true, stars: 2, feedbackKo: '' });
    expect(w.log).toEqual(['stars:0', 'stars:1', 'stars:3']);
  });

  it('guest practice never grants an item', () => {
    const w = fakeWorld();
    createResultPlayer(w)({ pass: true, stars: 2, feedbackKo: '', itemKey: 'honey_tea', practice: true });
    expect(w.log).toEqual(['stars:2']);
  });

  it('shows the ledger total the server sent', () => {
    const w = fakeWorld();
    createResultPlayer(w)({ pass: false, stars: 0, feedbackKo: '', coinsTotal: 0 });
    expect(w.log).toContain('coins:0');
  });
});

describe('guide destination', () => {
  it('a passed guide answer naming a place walks there', () => {
    expect(guideDestination(guide, { pass: true, stars: 2, feedbackKo: '', askedKey: 'cafe' })).toBe('honey_cafe');
    expect(guideDestination(guide, { pass: true, stars: 1, feedbackKo: '', askedKey: 'trade_shop' })).toBe('trade_shop');
  });

  it('no walk for other NPCs, fails, or unknown places', () => {
    expect(guideDestination(cafe, { pass: true, stars: 2, feedbackKo: '', askedKey: 'cafe' })).toBeNull();
    expect(guideDestination(guide, { pass: false, stars: 0, feedbackKo: '', askedKey: 'cafe' })).toBeNull();
    expect(guideDestination(guide, { pass: true, stars: 2, feedbackKo: '', askedKey: 'moon' })).toBeNull();
    expect(guideDestination(guide, { pass: true, stars: 2, feedbackKo: '' })).toBeNull();
  });
});

describe('3D fallback watch', () => {
  it('trips after 10 slow seconds at the resolution floor, after a 15 s warm-up', () => {
    const w = new FrameFloorWatch();
    for (let i = 0; i < 15; i++) expect(w.sample(3, true)).toBe(false);
    for (let i = 0; i < 9; i++) expect(w.sample(8, true)).toBe(false);
    expect(w.sample(8, true)).toBe(true);
    expect(w.sample(60, false)).toBe(true); // stays tripped
  });

  it('does not trip while the governor can still lower the resolution, or on a short dip', () => {
    const w = new FrameFloorWatch();
    for (let i = 0; i < 15; i++) w.sample(60, false);
    for (let i = 0; i < 30; i++) expect(w.sample(8, false)).toBe(false);
    for (let i = 0; i < 9; i++) w.sample(8, true);
    expect(w.sample(20, true)).toBe(false);
    for (let i = 0; i < 9; i++) expect(w.sample(8, true)).toBe(false);
  });
});
