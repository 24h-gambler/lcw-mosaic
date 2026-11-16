import { describe, expect, it } from 'vitest';
import { CUSTOMER_SCENARIOS, EXCHANGE_ORES, INTERVIEW_TURNS, NEGOTIATION, PHRASE_BANK, PLAY_BANK, PLAY_SHOP_GOODS, bankItemKey, findBankOffer } from '../index.js';

/** Play phrase bank (play-bank.ts): every play sentence set exists at L1-L3 and follows the star ladder. */

const has = (ctx: string, item: string, level: string) => PHRASE_BANK.some((e) => e.ctx === ctx && e.level === level && bankItemKey(e) === item);

describe('play bank', () => {
  it('is in the shared bank with unique ids', () => {
    const ids = PHRASE_BANK.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of PLAY_BANK) expect(PHRASE_BANK).toContain(e);
  });

  it('covers every play turn at L1, L2 and L3', () => {
    const want: Array<[string, string]> = [
      ...PLAY_SHOP_GOODS.map((g) => [g.ctx, g.key] as [string, string]),
      ...EXCHANGE_ORES.map((o) => ['exchange', o.key] as [string, string]),
      ...INTERVIEW_TURNS.map((t) => ['interview', t] as [string, string]),
      ['boss', 'boss_report'],
      ['boss', 'boss_late'],
      ...CUSTOMER_SCENARIOS.map((c) => ['customer', c.key] as [string, string]),
      ['customer', NEGOTIATION.key]
    ];
    for (const [ctx, item] of want) for (const level of ['L1', 'L2', 'L3']) expect(has(ctx, item, level), `${ctx} ${item} ${level}`).toBe(true);
  });

  it('three offers per entry, 1-2-3 stars, longer as the stars rise; only shop goods carry a price', () => {
    const priced = new Set<string>(PLAY_SHOP_GOODS.map((g) => g.key));
    for (const e of PLAY_BANK) {
      expect(e.offers.map((o) => o.stars)).toEqual([1, 2, 3]);
      expect(e.offers[2]!.text.split(' ').length, e.id).toBeGreaterThan(e.offers[0]!.text.split(' ').length);
      const price = e.offers[0]!.price;
      if (priced.has(bankItemKey(e))) expect(price, e.id).toBeGreaterThan(0);
      else expect(e.offers.every((o) => o.price === 0), e.id).toBe(true);
    }
  });

  it('a sentence belongs to one item of its context (the bank finds the item by the words, review H1)', () => {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const owner = new Map<string, string>();
    const ctxs = new Set(PLAY_BANK.map((e) => e.ctx));
    for (const e of PHRASE_BANK) {
      if (!ctxs.has(e.ctx)) continue;
      for (const o of e.offers) {
        const k = `${e.ctx}|${norm(o.text)}`;
        const item = bankItemKey(e);
        expect(owner.get(k) ?? item, `${e.id}: "${o.text}"`).toBe(item);
        owner.set(k, item);
      }
    }
  });

  it('every play sentence at every level and star is found as its own item (the server turn check)', () => {
    for (const e of PLAY_BANK)
      for (const o of e.offers) {
        const hit = findBankOffer({ ctx: e.ctx, level: e.level, text: o.text });
        expect(hit && bankItemKey(hit.entry), `${e.id} ${o.stars}: "${o.text}"`).toBe(bankItemKey(e));
        expect(hit?.offer.stars, `${e.id} ${o.stars}`).toBe(o.stars);
      }
  });

  it('no banned words on the child screen (docs/21): no game, test or right/wrong answer words', () => {
    for (const e of PLAY_BANK) for (const o of e.offers) expect(o.text, e.id).not.toMatch(/\b(game|test|exam|correct answer|wrong answer)\b/i);
    for (const c of CUSTOMER_SCENARIOS) expect(c.lineKo).not.toMatch(/게임|정답|오답|시험|평가/);
  });
});

describe('play labels (review dock names)', () => {
  it('every play item key has a Korean name, no English key leaks to the child', async () => {
    const { PLAY_LABELS } = await import('../index.js');
    const keys = new Set(PLAY_LABELS.map((l) => l.key));
    for (const e of PLAY_BANK) expect(keys.has(bankItemKey(e)), e.id).toBe(true);
    for (const l of PLAY_LABELS) expect(l.nameKo).toMatch(/[가-힣]/);
  });
});
