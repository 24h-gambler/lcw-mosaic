import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FURNITURE_SHOP_GOODS, PHRASE_BANK, UI_STRINGS_KO, starPrice } from '@lcw/content';
import { ROOM_MISSING_SENTENCES, applyReadAloudDiscount } from '@lcw/sim-core';
import { PlatformDO, type LcwEnv } from '../../../edge/src/platform.js';
import { fakeDurableStorage } from '../../../edge/src/__tests__/fake-do.js';
import { ReadAloudPrompt, postReadAloud } from '../dialog/ReadAloudPrompt.js';
import { createSoloSubmitWith } from '../dialog/submit.js';
import { createScriptedSpeechEngine } from '../dialog/speech.js';

/** Build-screen read-aloud line → real platform routes → the next lamp at Toby's shop is 10% off (docs/03 D13). */

describe('ReadAloudPrompt', () => {
  it('shows the room sentence (target font, >= 22px) with the read-aloud button and the kind hint', () => {
    const html = renderToStaticMarkup(
      <ReadAloudPrompt kind="light" sentence={ROOM_MISSING_SENTENCES.light} speech={createScriptedSpeechEngine([])} />
    );
    expect(html).toContain('This room needs a light source.');
    expect(html).toContain(UI_STRINGS_KO.readAloud.cta);
    expect(html).toContain('조명 가구 10% 할인');
    expect(html).toMatch(/font-size:2[2-9]px/);
  });

  it('claims with the device token, then the solo order of a lamp is charged 10% less', async () => {
    const TOKEN = 'op-token-0123456789abcdef';
    const p = new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => p.fetch(new Request(`https://lcw.test${String(input)}`, init))) as typeof fetch;
    await f('/v1/admin/players', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ family_id: 'fam', guardian_id: 'g', player_id: 'kid', nickname: 'Kid', level: 'L2' })
    });
    const tok = 'c'.repeat(48);
    p.sql.run(
      'insert into devices (id, player_id, family_id, token_hash, label, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?, null)',
      ['dev-1', 'kid', 'fam', createHash('sha256').update(tok).digest('hex'), 'tablet', Date.now(), Date.now()]
    );
    const r = await postReadAloud({ token: tok, kind: 'light', transcript: 'this room needs a light source', sttSource: 'browser', confidence: 0.9, durMs: 2000, fetchImpl: f });
    expect(r).toMatchObject({ pass: true, discount_pct: 0.1 });
    const again = await postReadAloud({ token: tok, kind: 'light', transcript: 'this room needs a light source', sttSource: 'browser', confidence: 0.9, durMs: 2000, fetchImpl: f });
    expect(again).toMatchObject({ pass: true, discount_pct: 0, already_claimed: true });

    const lamp = FURNITURE_SHOP_GOODS.find((g) => g.role === 'light')!;
    const text = PHRASE_BANK.find((b) => b.ctx === 'trade_shop' && b.level === 'L2' && b.slotsKey.startsWith(`item=${lamp.key}|`))!.offers[1].text;
    const submit = createSoloSubmitWith({
      token: tok,
      npc: { id: 'shop_owner', ctx: 'trade_shop', nameKo: '토비', nameEn: 'Toby' },
      fetchImpl: f,
      dialogId: 'lamp-1'
    });
    const bought = await submit({ target_text: text, transcript: text, chosen_stars: 2, hint_level: 'full', latency_ms: 800, dur_ms: 2000, stt_source: 'browser', confidence: 0.9 });
    expect(bought.itemKey).toBe(lamp.key);
    expect(bought.coinsTotal).toBe(200 - applyReadAloudDiscount(starPrice(lamp.basePrice, 2), 0.1));
  });
});
