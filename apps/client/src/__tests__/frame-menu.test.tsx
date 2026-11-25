// Player menu (docs/08 8.6 G03 G04 G10 G11): server-shaped data, tab keys, who asks the server, error mapping.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { mineTierOf } from '@lcw/sim-core';
import { fetchItems, moveThing, parseCollection, parseItems, pickRepair, type ItemsView } from '../frame/api.js';
import { bagSlots, chestThings, socketThings, BagPanel } from '../frame/menu/BagPanel.js';
import { BOOK_IDS, bookPct, sixBooks, BookPanel } from '../frame/menu/BookPanel.js';
import { repairOrder, RepairPanel } from '../frame/menu/RepairPanel.js';
import { turnYaw } from '../frame/menu/MirrorPanel.js';
import { tabForKey, PlayerMenu } from '../frame/menu/PlayerMenu.js';
import { MENU_TABS, otherModalOpen, type MenuPanelProps } from '../frame/menu/types.js';
import { bagKeys, frameAuthOf, ownedKeys } from '../frame/FrameLayer.js';
import { FRAME_STRINGS as F } from '../frame/strings.js';
import { SERVER_UNREACHABLE_EVENT } from '../frame/connection.js';

const child = { kind: 'child' as const, token: 'd'.repeat(40) };
const raw = {
  bag_slots: 5,
  coins_total: 340,
  items: [
    { item_id: 'a', item_key: 'honey_tea', item_name_ko: '꿀차', emoji: '🍯', location: 'bag', socket: null, durability: 100, card: { box: 1, due: false, mastered: false } },
    { item_id: 'b', item_key: 'hat', item_name_ko: '모자', emoji: '🎩', location: 'socket', socket: 'Head_Socket', durability: 100, card: null },
    { item_id: 'c', item_key: 'kite', item_name_ko: '연', emoji: '🪁', location: 'chest', socket: null, durability: 100, card: { box: 2, due: true, mastered: false } },
    { item_id: 'x', location: 'given' },
    { nonsense: true }
  ]
};

describe('server data in the menu', () => {
  it('keeps only known places and fields (unknown rows dropped, never trusted)', () => {
    const v = parseItems(raw);
    expect(v.items.map((t) => t.item_id)).toEqual(['a', 'b', 'c']);
    expect(v.coins_total).toBe(340);
    expect(parseItems({}).bag_slots).toBe(5);
  });
  it('lays out the 5-slot bag, 6 sockets and the chest', () => {
    const v = parseItems(raw);
    const slots = bagSlots(v);
    expect(slots).toHaveLength(5);
    expect(slots[0]?.item_key).toBe('honey_tea');
    expect(slots.slice(1).every((s) => s === null)).toBe(true);
    expect(socketThings(v).Head_Socket?.item_key).toBe('hat');
    expect(socketThings(v).Back_Socket).toBeNull();
    expect(chestThings(v).map((t) => t.item_key)).toEqual(['kite']);
  });
  it('puts the server bag on the HUD hotbar in order, five slots', () => {
    expect(bagKeys(parseItems(raw))).toEqual(['honey_tea', null, null, null, null]);
  });
  it('R2904①: the screen sees every owned tool (bag, equipped, chest) so a shop pickaxe breaks ore without being in hand', () => {
    const v = parseItems({
      items: [
        { item_id: 'a', item_key: 'honey_tea', item_name_ko: '꿀차', emoji: '🍯', location: 'bag', socket: null, durability: 100, card: null },
        { item_id: 'b', item_key: 'iron_pickaxe', item_name_ko: '철 곡괭이', emoji: '⛏', location: 'bag', socket: null, durability: 100, card: null },
        { item_id: 'c', item_key: 'drill', item_name_ko: '드릴', emoji: '🔩', location: 'chest', socket: null, durability: 100, card: null }
      ]
    });
    expect(ownedKeys(v)).toEqual(expect.arrayContaining(['iron_pickaxe', 'drill']));
    expect(mineTierOf(ownedKeys(v))).toBe(3);
    expect(mineTierOf(ownedKeys(parseItems({ items: [] })))).toBe(0);
  });
  it('always shows six books in the spec order, with a safe progress', () => {
    const v = parseCollection({ books: [{ id: 'food', total: 4, found: 1, entries: [] }, { id: 'unknown_book', total: 1, found: 1 }] });
    const six = sixBooks(v);
    expect(six.map((b) => b.id)).toEqual([...BOOK_IDS]);
    expect(bookPct(six[3]!)).toBe(25);
    expect(bookPct({ found: 0, total: 0 })).toBe(0);
    expect(bookPct({ found: 9, total: 3 })).toBe(100);
  });
  it('lists due repairs first', () => {
    const o = repairOrder([
      { item_id: '1', item_key: 'b', item_name_ko: '공', emoji: '', due: false },
      { item_id: '2', item_key: 'k', item_name_ko: '연', emoji: '', due: true }
    ]);
    expect(o[0]!.item_id).toBe('2');
  });
  it('turns the mirror character around without drifting past a full circle', () => {
    expect(turnYaw(3, 1)).toBeCloseTo(4 - Math.PI * 2);
    expect(turnYaw(-3, -1)).toBeCloseTo(-4 + Math.PI * 2);
  });
});

describe('who asks the server', () => {
  it('uses the linked device token, the lesson student token once joined, and nothing for a guest', () => {
    expect(frameAuthOf({ kind: 'child', token: 't'.repeat(40) } as never, null)).toEqual({ kind: 'child', token: 't'.repeat(40) });
    expect(frameAuthOf({ kind: 'lesson', code: '123456' }, 's'.repeat(40))).toEqual({ kind: 'lesson', token: 's'.repeat(40) });
    expect(frameAuthOf({ kind: 'lesson', code: '123456' }, null).token).toBeNull();
    expect(frameAuthOf({ kind: 'guest' }, 's'.repeat(40)).token).toBeNull();
  });
  it('never calls the server as a guest', async () => {
    let called = false;
    const r = await fetchItems({ kind: 'guest', token: null }, async () => {
      called = true;
      return new Response('{}');
    });
    expect(r).toEqual({ ok: false, error: 'guest' });
    expect(called).toBe(false);
  });
  it('sends the bearer token and maps a full bag, a not-due card and a dropped network', async () => {
    let auth = '';
    const full = await moveThing(child, 'c', 'bag', async (_u, init) => {
      auth = String((init?.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify({ error: 'bag_full' }), { status: 409 });
    });
    expect(auth).toBe(`Bearer ${child.token}`);
    expect(full).toEqual({ ok: false, error: 'bag_full' });
    const notDue = await pickRepair(child, 'c', async () => new Response(JSON.stringify({ error: 'not_due' }), { status: 409 }));
    expect(notDue).toEqual({ ok: false, error: 'not_due' });
    const seen: string[] = [];
    const g = globalThis as unknown as { window?: EventTarget };
    const had = g.window;
    g.window = new EventTarget();
    g.window.addEventListener(SERVER_UNREACHABLE_EVENT, () => seen.push('down'));
    const net = await fetchItems(child, async () => {
      throw new TypeError('network');
    });
    g.window = had;
    expect(net).toEqual({ ok: false, error: 'network' });
    expect(seen).toEqual(['down']);
  });
});

describe('menu keys and words', () => {
  it('opens tabs with I / M / K and never takes the world keys', () => {
    expect(tabForKey('KeyI')).toBe('bag');
    expect(tabForKey('KeyM')).toBe('map');
    expect(tabForKey('KeyK')).toBe('book');
    for (const k of ['Tab', 'KeyR', 'KeyE', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Digit1', 'F5', 'Space', 'KeyZ']) expect(tabForKey(k)).toBeNull();
  });
  it('has eight tabs (shop and make next to the bag, R326) and child-safe words only (no blame, no price, no "게임")', () => {
    expect(MENU_TABS).toEqual(['bag', 'shop', 'make', 'mirror', 'map', 'book', 'repair', 'settings']);
    const all = JSON.stringify(F);
    for (const w of FORBIDDEN_PLAYER_UI_PATTERNS) expect(all).not.toContain(w);
    expect(all).not.toMatch(/게임|가격|결제|원\b/);
  });
  it('renders every panel for a guest without asking the server', () => {
    const props: MenuPanelProps = { world: null, identity: { kind: 'guest' }, auth: { kind: 'guest', token: null }, lessonOn: false, go: () => undefined, close: () => undefined };
    // the markup escapes the apostrophe of "You're"
    for (const P of [BagPanel, BookPanel, RepairPanel]) expect(renderToStaticMarkup(<P {...props} />)).toContain(F.guestNote.replace(/'/g, '&#x27;'));
    const html = renderToStaticMarkup(<PlayerMenu {...props} tab="bag" onTab={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(8);
  });
  it('steps aside for any other window, but not for windows inside the menu', () => {
    const doc = (hud: boolean, els: Array<{ inMenu: boolean }>) => ({
      querySelector: (s: string) => (s === '.lw-hud.dlg' && hud ? ({} as Element) : null),
      querySelectorAll: () => els.map((e) => ({ closest: (s: string) => (s === '.lcw-menu' && e.inMenu ? {} : null) })) as unknown as NodeListOf<Element>
    });
    expect(otherModalOpen(doc(false, []))).toBe(false);
    expect(otherModalOpen(doc(true, []))).toBe(true); // a lesson dialog marked on the HUD
    expect(otherModalOpen(doc(false, [{ inMenu: false }]))).toBe(true); // review dialog, first-visit or seat card
    expect(otherModalOpen(doc(false, [{ inMenu: true }]))).toBe(false); // the menu itself and its repair review
    expect(otherModalOpen(null)).toBe(false);
  });
  it('a bag view type stays assignable from the parser (contract with GET /v1/items)', () => {
    const v: ItemsView = parseItems(raw);
    expect(v.items[0]!.card?.box).toBe(1);
  });
});
