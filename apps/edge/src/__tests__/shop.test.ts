/**
 * Coins that build up and things to spend them on (Dan 11-19 R326 ⑤⑪⑫, shop.ts) through the platform gateway with a
 * linked child's device token: a passed solo sentence earns coins (once per window, daily cap), the shop button buys
 * at list price with no double charge and never below zero, saying the order in English buys at the star price,
 * selling back, daily quests checked by the server, and a child-to-child trade with escrow.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COIN_RULES, DAILY_QUESTS, SHOP_CATALOG, bankEntriesFor, shopItem, starPrice, tradeLines } from '@lcw/content';
import { BK, naturalBlock } from '@lcw/sim-core';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let b: any = text;
  try {
    b = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: b };
}
async function child(p: PlatformDO, playerId: string, fam: string, nickname = 'Juno') {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname, birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const g = bearer((await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon)).body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  await call(p, 'POST', '/v1/admin/seats', { payer_player_id: playerId, plan: 'solo', term: 'month', player_ids: [playerId], paid_at: Date.now() });
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, {}, g);
  return bearer((await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon)).body.device_token);
}
const GUIDE = bankEntriesFor('guide', 'L2')[0]!;
async function say(p: PlatformDO, dev: Record<string, string>, dialog: string, stars: 1 | 2 | 3, ctx = 'guide', text?: string) {
  const o = ctx === 'guide' ? GUIDE.offers[stars - 1]! : { text: text! };
  return call(
    p,
    'POST',
    '/v1/converse/score',
    { dialog_id: dialog, chosen_stars: stars, hint_level: 'keyword', transcript: o.text, npc_ctx: ctx, target_text: o.text, mode: 'guided', stt_source: 'device', confidence: 0.95, dur_ms: 2000, latency_ms: 800 },
    dev
  );
}
/** Both sides of a trade say their line (WP-509). */
const offerSaid = (key: string) => ({ transcript: tradeLines(key).offer, stt_source: 'device', confidence: 0.95 });
const acceptSaid = (key: string) => ({ transcript: tradeLines(key).accept, stt_source: 'device', confidence: 0.95 });
const shop = async (p: PlatformDO, dev: Record<string, string>) => (await call(p, 'GET', '/v1/shop', undefined, dev)).body;

afterEach(() => vi.useRealTimers());

describe('town shop and coins (R326)', { timeout: 60_000 }, () => {
  it('a passed solo sentence earns coins once per window, tops up a better grade, and stops at the daily cap', async () => {
    const p = platform();
    const dev = await child(p, 'kid-earn', 'fam-earn');
    const start = (await shop(p, dev)).coins_total as number;
    const r1 = await say(p, dev, 'win-1', 1);
    expect(r1.status).toBe(200);
    expect(r1.body.pass).toBe(true);
    expect(r1.body.coins_earned).toBe(COIN_RULES.soloPerStar);
    expect(r1.body.coins_total).toBe(start + COIN_RULES.soloPerStar);
    // the same window again at the same grade: nothing more
    const again = await say(p, dev, 'win-1', 1);
    expect(again.body.coins_earned).toBeUndefined();
    // a better grade in the same window: only the difference
    const better = await say(p, dev, 'win-1', 3);
    expect(better.body.coins_earned).toBe(2 * COIN_RULES.soloPerStar);
    expect(better.body.coins_total).toBe(start + 3 * COIN_RULES.soloPerStar);
    // the same sentence in a fresh window (the dialog id is the client's) pays nothing more today
    const fresh = await say(p, dev, 'win-2', 3);
    expect(fresh.body.pass).toBe(true);
    expect(fresh.body.coins_earned).toBeUndefined();
    // also with no target sentence sent (the server finds the bank sentence; the tag is the server's sentence)
    const noTarget = await call(p, 'POST', '/v1/converse/score', { dialog_id: 'win-3', chosen_stars: 3, hint_level: 'keyword', transcript: GUIDE.offers[2]!.text, npc_ctx: 'guide', target_text: '', mode: 'guided', stt_source: 'device', confidence: 0.95, dur_ms: 2000, latency_ms: 800 }, dev);
    expect(noTarget.body.pass).toBe(true);
    expect(noTarget.body.coins_earned).toBeUndefined();
    // many windows of different sentences: never more than the cap a day
    const cafe = bankEntriesFor('cafe', 'L2');
    for (let i = 0; i < 14; i++) await say(p, dev, `cap-${i}`, 3, 'cafe', cafe[i]!.offers[2].text);
    // (the cafe orders also buy drinks, so count the earnings, not the balance)
    const s = await shop(p, dev);
    expect(s.earned_today).toBe(COIN_RULES.soloDailyCap);
  });

  it('the shop button buys at list price once per request id, never below zero, and the thing lands in the bag', async () => {
    const p = platform();
    const dev = await child(p, 'kid-buy', 'fam-buy');
    const s0 = await shop(p, dev);
    expect(Object.keys(s0.prices)).toHaveLength(SHOP_CATALOG.length);
    const hat = shopItem('hat_red')!;
    expect(s0.prices.hat_red).toBe(hat.price);
    const b1 = await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-hat-0001' }, dev);
    expect(b1.status).toBe(201);
    expect(b1.body.paid).toBe(hat.price);
    expect(b1.body.coins_total).toBe(s0.coins_total - hat.price);
    // a resend after a network error: same answer, no second charge or second hat
    const b2 = await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-hat-0001' }, dev);
    expect(b2.status).toBe(200);
    expect(b2.body.repeated).toBe(true);
    expect(b2.body.coins_total).toBe(b1.body.coins_total);
    const s1 = await shop(p, dev);
    expect(s1.owned.hat_red).toBe(1);
    const items = (await call(p, 'GET', '/v1/items', undefined, dev)).body.items as Array<{ item_key: string; location: string }>;
    expect(items.find((x) => x.item_key === 'hat_red')?.location).toBe('bag');
    // too expensive: refused, balance unchanged and never negative
    const crown = await call(p, 'POST', '/v1/shop/buy', { item_key: 'wings_fairy', request_id: 'req-wings-001' }, dev);
    expect(crown.status).toBe(409);
    expect(crown.body.error).toBe('short_of_coins');
    expect(crown.body.coins_total).toBe(b1.body.coins_total);
    expect(crown.body.coins_total).toBeGreaterThanOrEqual(0);
    // the client cannot name a price or an unknown thing
    expect((await call(p, 'POST', '/v1/shop/buy', { item_key: 'gold_bar', request_id: 'req-gold-0001' }, dev)).status).toBe(404);
    expect((await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'x' }, dev)).status).toBe(400);
    // no token: the operator gate
    expect((await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-anon-0001' }, anon)).status).toBe(401);
  });

  it('a material pack carries its block and count for the build hotbar', async () => {
    const p = platform();
    const dev = await child(p, 'kid-mat', 'fam-mat');
    const plank = shopItem('mat_plank')!;
    expect(plank.block).toEqual({ key: 'plank', count: 16 });
    const r = await call(p, 'POST', '/v1/shop/buy', { item_key: 'mat_plank', request_id: 'req-plank-001' }, dev);
    expect(r.status).toBe(201);
    expect(r.body.paid).toBe(plank.price);
  });

  it('saying the order in English to the shopkeeper buys at the star price (3 stars = half) and counts for the quest', async () => {
    const p = platform();
    const dev = await child(p, 'kid-say', 'fam-say');
    const entry = bankEntriesFor('trade_shop', 'L2').find((e) => e.id === 'trade_shop_L2_cap_blue')!;
    expect(entry).toBeTruthy();
    const before = (await shop(p, dev)).coins_total as number;
    const r = await say(p, dev, 'shop-cap', 3, 'trade_shop', entry.offers[2].text);
    expect(r.status).toBe(200);
    expect(r.body.granted?.item_id).toBe('cap_blue');
    const half = starPrice(shopItem('cap_blue')!.price, 3);
    expect(r.body.granted.coins_delta).toBe(-half);
    // pays half, and the passed sentence itself earned coins
    expect(r.body.coins_total).toBe(before - half + 3 * COIN_RULES.soloPerStar);
    const s = await shop(p, dev);
    expect(s.owned.cap_blue).toBe(1);
    expect(s.quests.find((q: { key: string }) => q.key === 'buy_english').progress).toBe(1);
    const claim = await call(p, 'POST', '/v1/quests/claim', { quest: 'buy_english' }, dev);
    expect(claim.status).toBe(200);
    expect(claim.body.reward).toBe(DAILY_QUESTS.find((q) => q.key === 'buy_english')!.reward);
    const twice = await call(p, 'POST', '/v1/quests/claim', { quest: 'buy_english' }, dev);
    expect(twice.body.repeated).toBe(true);
    expect(twice.body.coins_total).toBe(claim.body.coins_total);
    // a quest not done yet is refused by the server
    const show = await call(p, 'POST', '/v1/quests/claim', { quest: 'show_build' }, dev);
    expect(show.status).toBe(409);
    expect(show.body.error).toBe('not_done');
  });

  it("R2861①: the axe at Toby's trade shop — the shop line buys it, and so do the child's own words naming it", async () => {
    const p = platform();
    const dev = await child(p, 'kid-axe', 'fam-axe');
    const entry = bankEntriesFor('trade_shop', 'L2').find((e) => e.id === 'trade_shop_L2_axe')!;
    expect(entry).toBeTruthy();
    expect((await shop(p, dev)).prices.axe).toBeGreaterThan(0);
    const r = await say(p, dev, 'shop-axe', 1, 'trade_shop', entry.offers[0].text);
    expect(r.status).toBe(200);
    expect(r.body.granted?.item_id).toBe('axe');
    // own words, no sentence picked (the solo dialog sends target_text '' with hint none)
    const free = (dialog: string, transcript: string) =>
      call(p, 'POST', '/v1/converse/score', { dialog_id: dialog, chosen_stars: 1, hint_level: 'none', transcript, npc_ctx: 'trade_shop', target_text: '', mode: 'free', stt_source: 'device', confidence: 0.9, dur_ms: 2500, latency_ms: 800 }, dev);
    const own = await free('shop-axe-2', 'I need an axe to cut the trees');
    expect(own.body).toMatchObject({ pass: true, stars: 1 });
    expect(own.body.granted?.item_id).toBe('axe');
    expect((await shop(p, dev)).owned.axe).toBe(2);
    // talk that names nothing here still passes as talk (1 star), nothing sold
    const talk = await free('shop-axe-3', 'what a nice shop you have');
    expect(talk.body).toMatchObject({ pass: true, stars: 1 });
    expect(talk.body.granted ?? null).toBeNull();
    // a bare word or noise is not talk
    expect((await free('shop-axe-4', 'um')).body.pass).toBe(false);
  });

  it('R2904①: pickaxe tiers at the trade shop — a bare hand cannot take ore, the pickaxe can, and the collection shows it', async () => {
    const p = platform();
    const dev = await child(p, 'kid-mine', 'fam-mine');
    for (const k of ['pickaxe', 'iron_pickaxe', 'drill', 'sword']) expect((await shop(p, dev)).prices[k]).toBeGreaterThan(0);
    // an iron ore cell in the deep (the same natural ground the server's world reads)
    let at: { x: number; y: number; z: number } | null = null;
    for (let y = -21; y >= -89 && !at; y--) for (let x = 3000; x < 3200 && !at; x++) for (let z = 0; z < 8 && !at; z++) if (naturalBlock(x, y, z) === BK.ironOre) at = { x, y, z };
    expect(at).not.toBeNull();
    const dig = (x: number, y: number, z: number) => call(p, 'POST', '/v1/plot/ops', { ops: [{ op: 'break', x, y, z }] }, dev);
    const bare = await dig(at!.x, at!.y, at!.z);
    expect(bare.status).toBe(200);
    expect(bare.body.results[0]).toMatchObject({ ok: false, reason: 'needs_pickaxe' });
    // the child's own words name the pickaxe (not the axe inside the word)
    const own = await call(p, 'POST', '/v1/converse/score', { dialog_id: 'mine-1', chosen_stars: 1, hint_level: 'none', transcript: 'I need a pickaxe to dig the stone', npc_ctx: 'trade_shop', target_text: '', mode: 'free', stt_source: 'device', confidence: 0.9, dur_ms: 2500, latency_ms: 800 }, dev);
    expect(own.body).toMatchObject({ pass: true });
    expect(own.body.granted?.item_id).toBe('pickaxe');
    expect((await shop(p, dev)).owned.axe ?? 0).toBe(0);
    const mined = await dig(at!.x, at!.y, at!.z);
    expect(mined.body.results[0]).toMatchObject({ ok: true });
    const inv = mined.body.inv as { slots: Array<{ ref: string } | null>; chest: Record<string, number> };
    expect(inv.slots.some((x) => x?.ref === `b${BK.ironOre}`) || (inv.chest[`b${BK.ironOre}`] ?? 0) > 0).toBe(true);
    const books = (await call(p, 'GET', '/v1/collection', undefined, dev)).body.books as Array<{ id: string; entries: Array<{ key: string; found: boolean }> }>;
    const minerals = books.find((b) => b.id === 'minerals')!;
    expect(minerals.entries.find((e) => e.key === 'iron')?.found).toBe(true);
    expect(minerals.entries.find((e) => e.key === 'diamond')?.found).toBe(false);
    // a stone pickaxe is not enough for gold
    let gold: { x: number; y: number; z: number } | null = null;
    for (let y = -61; y >= -129 && !gold; y--) for (let x = 3000; x < 3300 && !gold; x++) for (let z = 0; z < 8 && !gold; z++) if (naturalBlock(x, y, z) === BK.goldOre) gold = { x, y, z };
    expect(gold).not.toBeNull();
    expect((await dig(gold!.x, gold!.y, gold!.z)).body.results[0]).toMatchObject({ ok: false, reason: 'needs_iron_pickaxe' });
  });

  it('talk quest: five passed sentences today, then one claim', async () => {
    const p = platform();
    const dev = await child(p, 'kid-talk', 'fam-talk');
    expect((await call(p, 'POST', '/v1/quests/claim', { quest: 'talk5' }, dev)).status).toBe(409);
    for (let i = 0; i < 5; i++) await say(p, dev, `t-${i}`, 2);
    const c1 = await call(p, 'POST', '/v1/quests/claim', { quest: 'talk5' }, dev);
    expect(c1.status).toBe(200);
    expect(c1.body.reward).toBe(30);
  });

  it('selling back pays half of what was paid once, and the thing is gone', async () => {
    const p = platform();
    const dev = await child(p, 'kid-sell', 'fam-sell');
    const b = await call(p, 'POST', '/v1/shop/buy', { item_key: 'cap_blue', request_id: 'req-cap-00001' }, dev);
    expect((await shop(p, dev)).sell_prices[b.body.item_id]).toBe(Math.floor(b.body.paid / 2));
    const s1 = await call(p, 'POST', '/v1/shop/sell', { item_id: b.body.item_id }, dev);
    expect(s1.status).toBe(200);
    expect(s1.body.paid).toBe(Math.floor(b.body.paid / 2));
    expect(s1.body.coins_total).toBe(b.body.coins_total + s1.body.paid);
    expect((await call(p, 'POST', '/v1/shop/sell', { item_id: b.body.item_id }, dev)).status).toBe(404);
    // the same request id for another thing is not a free second purchase
    const reuse = await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-cap-00001' }, dev);
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toBe('request_reused');
  });

  it('review of PR 189: saying a bought order again never brings back a thing sold back (no coin loop)', async () => {
    const p = platform();
    const dev = await child(p, 'kid-loop', 'fam-loop');
    const entry = bankEntriesFor('trade_shop', 'L2').find((e) => e.id === 'trade_shop_L2_cap_blue')!;
    const r = await say(p, dev, 'loop-cap', 3, 'trade_shop', entry.offers[2].text);
    expect(r.body.granted?.item_id).toBe('cap_blue');
    const things = (await call(p, 'GET', '/v1/items', undefined, dev)).body.items as Array<{ item_id: string; item_key: string }>;
    const cap = things.find((t) => t.item_key === 'cap_blue')!;
    expect(cap.item_id.startsWith('buy-')).toBe(true);
    // a three-star buy sells back for half of the half price: buying and selling can only lose coins
    const sold = await call(p, 'POST', '/v1/shop/sell', { item_id: cap.item_id }, dev);
    expect(sold.body.paid).toBe(Math.floor(starPrice(shopItem('cap_blue')!.price, 3) / 2));
    const after = sold.body.coins_total as number;
    for (let i = 0; i < 3; i++) {
      const again = await say(p, dev, 'loop-cap', 3, 'trade_shop', entry.offers[2].text);
      expect(again.status).toBe(200);
      expect(again.body.granted?.item_id).toBeUndefined();
    }
    const s = await shop(p, dev);
    expect(s.owned.cap_blue).toBeUndefined();
    expect(s.coins_total).toBe(after);
  });

  it('child-to-child trade: both say their line in English, escrow, one buyer, coins to the seller once, cancel returns the thing', async () => {
    const p = platform();
    // siblings share the family room (the server names it from the token); another family does not see the offer
    const a = await child(p, 'kid-sell2', 'fam-t', 'Mint');
    const b = await child(p, 'kid-buy2', 'fam-t', 'Oreo');
    const c = await child(p, 'kid-late', 'fam-t', 'Pip');
    const other = await child(p, 'kid-other', 'fam-o', 'Zed');
    const hat = await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-trade-001' }, a);
    // WP-509: the seller says the offer in English first; without it nothing is put up
    const silent = await call(p, 'POST', '/v1/p2p/offer', { item_id: hat.body.item_id, price: 40, said: { transcript: '', stt_source: 'device', confidence: 0.5 } }, a);
    expect(silent.status).toBe(422);
    expect(silent.body.target).toBe('Do you want my red hat?');
    expect((await shop(p, a)).owned.hat_red).toBe(1);
    const talk5 = async () => (await shop(p, a)).quests.find((q: { key: string }) => q.key === 'talk5').progress as number;
    const talkBefore = await talk5();
    const offer = await call(p, 'POST', '/v1/p2p/offer', { item_id: hat.body.item_id, price: 40, said: offerSaid('hat_red') }, a);
    // review of PR 189: trade lines are logged, but they do not fill the talk goal (no offer / take-back loop)
    expect(await talk5()).toBe(talkBefore);
    expect(offer.status).toBe(201);
    // in escrow: not in the seller's things any more, cannot be offered twice
    expect((await shop(p, a)).owned.hat_red).toBeUndefined();
    expect((await call(p, 'POST', '/v1/p2p/offer', { item_id: hat.body.item_id, price: 10, said: offerSaid('hat_red') }, a)).status).toBe(404);
    const seen = await call(p, 'GET', '/v1/p2p/offers', undefined, b);
    expect(seen.body.offers).toHaveLength(1);
    expect(seen.body.offers[0]).toMatchObject({ seller_name: 'Mint', item_key: 'hat_red', price: 40, mine: false });
    expect((await call(p, 'GET', '/v1/p2p/offers?room=family-fam-t', undefined, other)).body.offers).toHaveLength(0);
    expect((await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: acceptSaid('hat_red') }, a)).body.error).toBe('own_offer');
    // review of PR 189: a child of another family who learns the offer id cannot buy it (same room only)
    const outsider = await child(p, 'kid-out2', 'fam-other2', 'Kiwi');
    const far = await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: acceptSaid('hat_red') }, outsider);
    expect(far.status).toBe(404);
    // WP-509: the buyer must ask in English; a mumble moves nothing
    const mumble = await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: { transcript: 'uh', stt_source: 'device', confidence: 0.5 } }, b);
    expect(mumble.status).toBe(422);
    expect(mumble.body).toMatchObject({ error: 'say_it_again', target: 'Can I buy your red hat, please?' });
    const bBefore = (await shop(p, b)).coins_total as number;
    const acc = await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: acceptSaid('hat_red') }, b);
    expect(acc.status).toBe(200);
    expect(acc.body.coins_total).toBe(bBefore - 40);
    expect((await shop(p, b)).owned.hat_red).toBe(1);
    // resend from the buyer: same answer, no second charge; a second buyer: closed
    const accAgain = await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: acceptSaid('hat_red') }, b);
    expect(accAgain.body.repeated).toBe(true);
    expect(accAgain.body.coins_total).toBe(bBefore - 40);
    expect((await call(p, 'POST', '/v1/p2p/accept', { offer_id: offer.body.offer_id, said: acceptSaid('hat_red') }, c)).body.error).toBe('offer_closed');
    // the seller's coins land when the seller opens the list, once
    const aBefore = (await shop(p, a)).coins_total as number;
    const list1 = await call(p, 'GET', '/v1/p2p/offers', undefined, a);
    expect(list1.body.paid_out).toBe(40);
    expect(list1.body.coins_total).toBe(aBefore + 40);
    const list2 = await call(p, 'GET', '/v1/p2p/offers', undefined, a);
    expect(list2.body.paid_out).toBe(0);
    expect(list2.body.coins_total).toBe(aBefore + 40);

    // cancel gives the thing back
    const cap = await call(p, 'POST', '/v1/shop/buy', { item_key: 'cap_blue', request_id: 'req-trade-002' }, a);
    const o2 = await call(p, 'POST', '/v1/p2p/offer', { item_id: cap.body.item_id, price: 5, said: offerSaid('cap_blue') }, a);
    expect((await shop(p, a)).owned.cap_blue).toBeUndefined();
    expect((await call(p, 'POST', '/v1/p2p/cancel', { offer_id: o2.body.offer_id }, a)).status).toBe(200);
    expect((await shop(p, a)).owned.cap_blue).toBe(1);
    expect((await call(p, 'POST', '/v1/p2p/accept', { offer_id: o2.body.offer_id, said: acceptSaid('cap_blue') }, b)).body.error).toBe('offer_closed');
    // short of coins: refused, nothing moves
    const crown = await call(p, 'POST', '/v1/shop/buy', { item_key: 'pet_ball', request_id: 'req-trade-003' }, a);
    const o3 = await call(p, 'POST', '/v1/p2p/offer', { item_id: crown.body.item_id, price: COIN_RULES.tradeMaxCoins, said: offerSaid('pet_ball') }, a);
    expect((await call(p, 'POST', '/v1/p2p/accept', { offer_id: o3.body.offer_id, said: acceptSaid('pet_ball') }, c)).body.error).toBe('short_of_coins');
    // price over the cap is refused
    expect((await call(p, 'POST', '/v1/p2p/offer', { item_id: 'x', price: COIN_RULES.tradeMaxCoins + 1, said: offerSaid('x') }, a)).status).toBe(400);
  });

  it('an offer lapses after its time and the thing returns to the seller', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
    const p = platform();
    const a = await child(p, 'kid-lapse', 'fam-l');
    const hat = await call(p, 'POST', '/v1/shop/buy', { item_key: 'hat_red', request_id: 'req-lapse-01' }, a);
    await call(p, 'POST', '/v1/p2p/offer', { item_id: hat.body.item_id, price: 1, said: offerSaid('hat_red') }, a);
    expect((await shop(p, a)).owned.hat_red).toBeUndefined();
    vi.setSystemTime(new Date(Date.now() + COIN_RULES.tradeTtlMs + 1000));
    const l = await call(p, 'GET', '/v1/p2p/offers', undefined, a);
    expect(l.body.offers).toHaveLength(0);
    expect((await shop(p, a)).owned.hat_red).toBe(1);
  });
});
