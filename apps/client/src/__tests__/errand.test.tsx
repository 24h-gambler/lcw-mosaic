import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FIRST_ERRAND, NPC_OPENING_LINES, NPC_REVISIT_LINES, UI_STRINGS_EN } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { errandDialogFor, errandGoalKo, fetchErrand, type ErrandView } from '../dialog/errand.js';
import { FirstVisitGuide } from '../dialog/FirstVisitGuide.js';
import { createSoloSubmitWith } from '../dialog/submit.js';
import type { NpcRef } from '../dialog/types.js';

/**
 * WP-111 / docs/03 D1 from the child's side: the client errand module drives the real PlatformDO routes with a
 * device token — Mia (the neighbour at the cafe door) asks, the cafe sells the cold water, Mia takes it, +50 once —
 * and the dialog shapes match. Luna stays the guide.
 */

const TOKEN = 'op-token-0123456789abcdef';
const LUNA: NpcRef = { id: 'guide', ctx: 'guide', nameKo: '루나', nameEn: 'Luna' };
const MINA: NpcRef = { id: 'errand_neighbor', ctx: 'errand', nameKo: '이웃 미아', nameEn: 'Mia' };
const HANI: NpcRef = { id: 'cafe_owner', ctx: 'cafe', nameKo: '카페 주인 해나', nameEn: 'Hannah' };
const TOBY: NpcRef = { id: 'shop_owner', ctx: 'trade_shop', nameKo: '토비', nameEn: 'Toby' };

async function platform() {
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => p.fetch(new Request(`https://lcw.test${String(input)}`, init))) as typeof fetch;
  await f('/v1/admin/players', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L1' })
  });
  const devToken = 'e'.repeat(48);
  p.sql.run(
    'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
    ['dev-1', 'kid', 'fam', createHash('sha256').update(devToken).digest('hex'), 'tablet', Date.now(), Date.now()]
  );
  return { p, f, devToken };
}

const utter = (text: string, stars: 1 | 2 | 3) => ({
  target_text: text,
  transcript: text,
  chosen_stars: stars,
  hint_level: 'full' as const,
  latency_ms: 900,
  dur_ms: 2000,
  stt_source: 'browser' as const,
  confidence: 0.9
});

describe('first-visit errand: client module against the real platform routes', () => {
  it('Mia asks -> accept -> the cafe sells only the cold water -> hand it over -> done with +50', async () => {
    const { f, devToken } = await platform();
    let e: ErrandView = await fetchErrand({ token: devToken, fetchImpl: f });
    expect(e).toMatchObject({ state: 'offered', item_key: FIRST_ERRAND.item, npc_line: FIRST_ERRAND.lines.ask });
    expect(errandGoalKo(e)).toBe('Go talk to your neighbor Mia in front of the cafe'); // the name comes from the cast pack

    // Mia gives the errand: ctx errand, accept lines, her ask line first. Luna is a normal guide talk.
    expect(errandDialogFor(LUNA, e, 'L1')).toBeNull();
    const ask = errandDialogFor(MINA, e, 'L1')!;
    expect(ask.npc).toMatchObject({ id: 'errand_neighbor', ctx: 'errand' });
    expect(ask.npcLine).toBe(FIRST_ERRAND.lines.ask);
    expect(ask.offers.map((o) => o.stars)).toEqual([1, 2, 3]);
    const acc = await createSoloSubmitWith({ token: devToken, npc: ask.npc, fetchImpl: f, dialogId: 'd-acc' })(utter(ask.offers[1]!.text, 2));
    expect(acc.pass).toBe(true);
    expect(acc.errand).toEqual({ state: 'accepted', rewardCoins: undefined });
    e = await fetchErrand({ token: devToken, fetchImpl: f });
    expect(e.state).toBe('accepted');
    expect(errandGoalKo(e)).toContain(`${FIRST_ERRAND.mod} ${FIRST_ERRAND.item}`); // English screen: the item in English

    // On the way Mia reminds (waiting line, the yes lines again move nothing); Luna and Toby talk as usual.
    const wait = errandDialogFor(MINA, e, 'L1')!;
    expect(wait.npcLine).toBe(FIRST_ERRAND.lines.waiting);
    expect(errandDialogFor(LUNA, e, 'L1')).toBeNull();
    expect(errandDialogFor(TOBY, e, 'L1')).toBeNull();

    // The cafe offers the asked drink; ordering it is the first order.
    const cafe = errandDialogFor(HANI, e, 'L1')!;
    expect(cafe.npcLine).toBe(NPC_OPENING_LINES.cafe);
    expect(cafe.offers.every((o) => /water/i.test(o.text))).toBe(true);
    const order = await createSoloSubmitWith({ token: devToken, npc: HANI, fetchImpl: f, dialogId: 'd-cafe' })(utter(cafe.offers[1]!.text, 2));
    expect(order.itemKey).toBe('water');
    expect(order.errand?.state).toBe('carrying');
    e = { ...e, state: 'carrying' };

    const give = errandDialogFor(MINA, e, 'L1')!;
    expect(give.npc.ctx).toBe('errand');
    const done = await createSoloSubmitWith({ token: devToken, npc: give.npc, fetchImpl: f, dialogId: 'd-give' })(utter(give.offers[2]!.text, 3));
    expect(done.errand).toEqual({ state: 'done', rewardCoins: 50 });
    expect(typeof done.coinsTotal).toBe('number');

    const after = await fetchErrand({ token: devToken, fetchImpl: f });
    expect(after.state).toBe('done');
    expect(after.first_order_at! - after.started_at).toBeLessThanOrEqual(180_000);
    // once done, the cafe is back to its own talk and Mia points the way in her own voice (R2625: she asked for the
    // water again on every visit), never with her first ask
    expect(errandDialogFor(HANI, after, 'L1')).toBeNull();
    const mia = errandDialogFor(MINA, after, 'L1')!;
    expect(mia.npc).toMatchObject({ id: 'errand_neighbor', ctx: 'guide' });
    expect(mia.voiceCtx).toBe('errand');
    expect(NPC_REVISIT_LINES.errand).toContain(mia.npcLine);
    expect(mia.npcLine).not.toBe(FIRST_ERRAND.lines.ask);
    expect(mia.offers.map((o) => o.text).join(' ')).toMatch(/where is the/i);
  });

  it('a revoked or missing token is an auth error (the guide hides)', async () => {
    const { f } = await platform();
    await expect(fetchErrand({ token: 'x'.repeat(48), fetchImpl: f })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('FirstVisitGuide', () => {
  const world = { setGoal: () => undefined, goToScene: async () => undefined } as never;
  const view = (state: ErrandView['state']): ErrandView => ({
    id: 'errand-first-kid',
    state,
    item_key: 'water',
    item_mod: 'cold',
    item_ko: FIRST_ERRAND.itemKo,
    reward_coins: 0,
    npc_line: FIRST_ERRAND.lines.ask,
    started_at: 1,
    first_pass_at: null,
    first_order_at: null,
    done_at: null
  });
  const noFetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;

  it('guests (no token) start on the town goals; an unknown errand renders nothing', () => {
    // R2625: a guest has no errand (it needs a linked device), so the town tour starts at once: ask Luna the way
    const guest = renderToStaticMarkup(<FirstVisitGuide world={world} errand={view('accepted')} onErrand={() => undefined} fetchImpl={noFetch} />);
    expect(guest).toContain('data-goal="ask_way"');
    expect(guest).toContain('Go to Luna');
    expect(renderToStaticMarkup(<FirstVisitGuide world={world} errand={null} onErrand={() => undefined} hidden fetchImpl={noFetch} />)).toBe('');
    expect(renderToStaticMarkup(<FirstVisitGuide world={world} player={{ deviceToken: 'd'.repeat(48) }} errand={null} onErrand={() => undefined} fetchImpl={noFetch} />)).toBe('');
  });

  it('shows the way button for the step: to Mia at the cafe door to start and to hand over, to the cafe while ordering', () => {
    const at = (s: ErrandView['state'], hidden = false) =>
      renderToStaticMarkup(<FirstVisitGuide world={world} player={{ deviceToken: 'd'.repeat(48) }} errand={view(s)} onErrand={() => undefined} hidden={hidden} fetchImpl={noFetch} />);
    expect(at('accepted')).toContain(UI_STRINGS_EN.firstVisit.walkCafe);
    expect(at('carrying')).toContain('Go to Mia');
    expect(at('offered')).toContain('Go to Mia');
    expect(at('done')).not.toContain('lcw-errand-walk');
    expect(at('accepted', true)).toBe('');
  });
});
