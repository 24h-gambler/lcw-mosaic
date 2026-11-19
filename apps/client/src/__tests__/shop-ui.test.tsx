// Town shop, maker's book and trades (Dan R326 ⑤⑪⑫): the catalog is one table, every thing can be ordered in English
// at three levels, the windows render for guests without asking, the API maps the server's answers, and the words are
// child-safe (coins only — no money, no "게임").
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import {
  BLOCK_PALETTE,
  DAILY_QUESTS,
  MAKE_RECIPES,
  SHOP_CATALOG,
  SHOP_CATEGORIES,
  challengeOfDay,
  findBankOffer,
  shopItem,
  starPrice
} from '@lcw/content';
import { ShopPanel, effectLine } from '../frame/menu/ShopPanel.js';
import { MakePanel, RecipePicture } from '../frame/menu/MakePanel.js';
import type { MenuPanelProps } from '../frame/menu/types.js';
import { SHOP_STRINGS } from '../frame/shop-strings.js';
import { buyThing, fetchShop, newRequestId } from '../frame/shop-api.js';
import { SHOPKEEPER, shopSayOffers } from '../frame/shop-say.js';

const guest: MenuPanelProps = { world: null, identity: { kind: 'guest' }, auth: { kind: 'guest', token: null }, lessonOn: false, go: () => undefined, close: () => undefined };
const child = { kind: 'child' as const, token: 'd'.repeat(40) };

describe('shop catalog (one table)', () => {
  it('has many things in every category, unique keys, coin prices only', () => {
    const keys = SHOP_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of SHOP_CATEGORIES) expect(SHOP_CATALOG.filter((i) => i.cat === c).length).toBeGreaterThanOrEqual(8);
    expect(SHOP_CATALOG.length).toBeGreaterThanOrEqual(60);
    for (const i of SHOP_CATALOG) expect(i.price).toBeGreaterThan(0);
  });
  it('block packs cost the block table price × count (one source) and name a real block', () => {
    for (const i of SHOP_CATALOG.filter((x) => x.cat === 'materials')) {
      const b = BLOCK_PALETTE.find((x) => x.key === i.block!.key)!;
      expect(b).toBeTruthy();
      expect(i.price).toBe(b.priceCoins * i.block!.count);
    }
  });
  it('food and water carry their survival points (the world lane applies them)', () => {
    for (const i of SHOP_CATALOG.filter((x) => x.cat === 'food')) expect(i.food!.hunger + i.food!.thirst).toBeGreaterThan(0);
    expect(effectLine(shopItem('water_bottle')!)).toBe('+40 water');
    expect(effectLine(shopItem('mat_plank')!)).toBe('16 blocks');
  });
  it('every thing has order lines at L1–L3 whose 3-star price is half (the server bank)', () => {
    for (const i of SHOP_CATALOG)
      for (const lv of ['L1', 'L2', 'L3'] as const) {
        const offers = shopSayOffers(i.key, lv);
        expect(offers.map((o) => o.stars)).toEqual([1, 2, 3]);
        const hit = findBankOffer({ ctx: 'trade_shop', level: lv, text: offers[2]!.text });
        expect(hit?.offer.price).toBe(starPrice(i.price, 3));
        expect(offers[2]!.text.toLowerCase()).toContain(i.label.toLowerCase());
      }
    expect(shopSayOffers('hat_red', 'L1')[2]!.text).toBe('Can I have a red hat, please?');
    // review of PR 189: no two things share an order line (the server would hand over the first one)
    for (const lv of ['L1', 'L2', 'L3'] as const) {
      const lines = SHOP_CATALOG.flatMap((i) => shopSayOffers(i.key, lv).map((o) => o.text.toLowerCase()));
      expect(new Set(lines).size).toBe(lines.length);
    }
    expect(shopSayOffers('apple', 'L1')[0]!.text).toBe('An apple, please.');
    expect(shopSayOffers('nope', 'L1')).toEqual([]);
    expect(SHOPKEEPER.ctx).toBe('trade_shop');
  });
  it("the maker's book only uses things the shop sells, and today's challenge is the same all day", () => {
    for (const r of MAKE_RECIPES) for (const n of r.needs) expect(shopItem(n.item)).toBeTruthy();
    const day = Date.UTC(2026, 10, 19, 1, 0, 0);
    expect(challengeOfDay(day).key).toBe(challengeOfDay(day + 10 * 3_600_000).key);
    expect(new Set(Array.from({ length: MAKE_RECIPES.length }, (_, d) => challengeOfDay(day + d * 86_400_000).key)).size).toBe(MAKE_RECIPES.length);
    expect(DAILY_QUESTS.map((q) => q.key)).toEqual(['talk5', 'buy_english', 'build_today', 'show_build']);
  });
});

describe('shop windows', () => {
  it('render for a guest without asking the server, and the words are child-safe', () => {
    expect(renderToStaticMarkup(<ShopPanel {...guest} />)).toContain(SHOP_STRINGS.guest.en);
    const make = renderToStaticMarkup(<MakePanel {...guest} />);
    expect(make).toContain(challengeOfDay(Date.now()).goal);
    for (const r of MAKE_RECIPES) expect(make).toContain(r.goal);
    const all = JSON.stringify(SHOP_STRINGS) + JSON.stringify(SHOP_CATALOG) + JSON.stringify(MAKE_RECIPES) + JSON.stringify(DAILY_QUESTS);
    for (const w of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all).not.toContain(w);
    expect(all).not.toMatch(/게임|가격|결제|원\b|\bgame\b/i);
  });
  it('the recipe picture marks what the child already has', () => {
    const r = MAKE_RECIPES.find((x) => x.key === 'pet_house')!;
    const html = renderToStaticMarkup(<RecipePicture r={r} owned={{ mat_plank: 1 }} />);
    expect(html.match(/class="in have"/g)).toHaveLength(1);
    expect(html).toContain('→');
  });
});

describe('shop API', () => {
  it('sends the device token, one GET per open, and maps the answers', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url === '/v1/shop') return new Response(JSON.stringify({ coins_total: 12, prices: {}, owned: {}, quests: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: 'short_of_coins', need: 48 }), { status: 409 });
    };
    const s = await fetchShop(child, f);
    expect(s.ok && s.data.coins_total).toBe(12);
    expect((seen[0]!.init!.headers as Record<string, string>).authorization).toBe(`Bearer ${child.token}`);
    const b = await buyThing(child, 'hat_red', newRequestId(), f);
    expect(b).toEqual({ ok: false, error: 'short_of_coins', need: 48 });
    expect(JSON.parse(String(seen[1]!.init!.body))).toMatchObject({ item_key: 'hat_red' });
    expect(newRequestId()).toMatch(/^[A-Za-z0-9_-]{8,48}$/);
    expect(await fetchShop({ kind: 'guest', token: null }, f)).toEqual({ ok: false, error: 'guest' });
  });
});
