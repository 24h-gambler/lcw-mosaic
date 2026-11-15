import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UI_STRINGS_KO } from '@lcw/content';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { createReviewSubmit, fetchReviewDue, nextPollDelay } from '../dialog/review.js';
import { ReviewDock, npcForReview, reviewDockTop } from '../dialog/ReviewDock.js';
import type { WorldHandle } from '../world/api.js';

/**
 * The child's review path end to end: client review module → real PlatformDO routes (device token) → memory card
 * moves a box. docs/03 D8, WP-310.
 */

const TOKEN = 'op-token-0123456789abcdef';

async function platformWithCard() {
  const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
  const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
    p.fetch(new Request(`https://lcw.test${String(input)}`, init))) as typeof fetch;
  await f('/v1/admin/players', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' })
  });
  const devToken = 'e'.repeat(48);
  p.sql.run(
    'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
    ['dev-1', 'kid', 'fam', createHash('sha256').update(devToken).digest('hex'), 'tablet', Date.now(), Date.now()]
  );
  const text = 'Can I get a cold smoothie because I am thirsty?';
  const order = await f('/v1/converse/score', {
    method: 'POST',
    headers: { authorization: `Bearer ${devToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dialog_id: 'd1', chosen_stars: 3, hint_level: 'full', npc_ctx: 'cafe', target_text: text, transcript: text })
  });
  expect(order.status).toBe(200);
  return { p, f, devToken, text };
}

describe('client review module against the real platform routes', () => {
  it('nothing is due right after the order; at 20 minutes the sign comes and saying it fixes it', async () => {
    const { p, f, devToken, text } = await platformWithCard();
    const first = await fetchReviewDue({ token: devToken, fetchImpl: f });
    expect(first.signs).toEqual([]);
    expect(first.next_due_at).toBeGreaterThan(Date.now() + 19 * 60_000);
    expect(nextPollDelay(first, Date.now())).toBeLessThanOrEqual(300_000);

    p.sql.run('update memory_cards set next_review_at = ? where id = ?', [Date.now() - 1, 'mc-d1']);
    const due = await fetchReviewDue({ token: devToken, fetchImpl: f });
    expect(due.signs).toHaveLength(1);
    expect(due.signs[0]).toMatchObject({ card_id: 'mc-d1', hint: 'full', listen: true, item_key: 'smoothie' });

    const submit = createReviewSubmit({ token: devToken, cardId: 'mc-d1', fetchImpl: f });
    const u = { target_text: text, transcript: text, chosen_stars: 3 as const, hint_level: 'full' as const, latency_ms: 900, dur_ms: 2400, stt_source: 'browser' as const, confidence: 0.9 };
    const r = await submit(u);
    expect(r.pass).toBe(true);
    expect(r.feedbackKo).toContain('내일');
    // Saying it again right away is "not due": no score, no box move.
    const again = await submit(u);
    expect(again).toMatchObject({ pass: false, feedbackKo: UI_STRINGS_KO.review.notDue });
    const box = p.sql.get<{ box: number }>('select box from memory_cards where id = ?', ['mc-d1']);
    expect(box?.box).toBe(1);
  });

  it('a revoked device token stops the dock (auth error)', async () => {
    const { p, f, devToken } = await platformWithCard();
    p.sql.run('update devices set revoked_at = ? where id = ?', [Date.now(), 'dev-1']);
    await expect(fetchReviewDue({ token: devToken, fetchImpl: f })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('ReviewDock', () => {
  it('renders nothing until the server says a card is due (guests never poll)', () => {
    expect(renderToStaticMarkup(<ReviewDock world={null} />)).toBe('');
  });

  it('opens the review on the NPC the world has for that context, else a built-in one', () => {
    const world = { listNpcs: () => [{ id: 'cafe_owner', ctx: 'cafe', nameKo: '해나', nameEn: 'Hannah' }] } as unknown as WorldHandle;
    expect(npcForReview(world, 'cafe').nameKo).toBe('해나');
    expect(npcForReview(null, 'trade_shop').id).toBe('shop_owner');
    expect(npcForReview(null, 'unknown').id).toBe('guide');
  });
});

describe('ReviewDock place on the HUD (docs/19 5장)', () => {
  it('sits under the star+coin chip on desktop and under the touch view button on touch screens', () => {
    // world HUD: star+coin chip top 12, 36 high; touch view button about 60~116px.
    expect(reviewDockTop(false)).toBeGreaterThanOrEqual(12 + 36 + 8);
    expect(reviewDockTop(true)).toBeGreaterThanOrEqual(116 + 8);
  });
});
