import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { lookupPhraseBank, starPrice } from '@lcw/content';
import { DialogPanel } from '../dialog/DialogPanel.js';
import { bankOffersFor, itemFor } from '../dialog/hints.js';
import { createScriptedSpeechEngine } from '../dialog/speech.js';
import type { DialogPanelProps, NpcRef } from '../dialog/types.js';

/** Audit G02 (11-16): the preview was a 💬 placeholder and solo play showed no prices ("말이 곧 화폐" invisible). */

const cafe: NpcRef = { id: 'cafe_owner', ctx: 'cafe', nameKo: '카페 주인 해나', nameEn: 'Hannah' };
const guide: NpcRef = { id: 'guide', ctx: 'guide', nameKo: '안내인 루나 선생님', nameEn: 'Luna' };
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

const base: DialogPanelProps = {
  npc: cafe,
  level: 'L1',
  mode: 'guided',
  offers: [],
  hint: 'full',
  submit: async () => ({ pass: true, stars: 1, feedbackKo: '' }),
  onDone: () => {},
  onClose: () => {},
  speech: createScriptedSpeechEngine(['Water, please.'])
};

describe('dialog preview: what the sentence buys and what it costs (G02)', () => {
  it('bank offers carry the list price, lower for the better sentence; free lines carry none', () => {
    const offers = bankOffersFor(cafe, 'L1');
    const entry = lookupPhraseBank({ ctx: 'cafe', level: 'L1' })!;
    expect(offers.map((o) => o.price)).toEqual(entry.offers.map((o) => o.price));
    expect(offers[0]!.price!).toBeGreaterThan(offers[2]!.price!);
    expect(bankOffersFor(guide, 'L1').every((o) => o.price === undefined)).toBe(true);
  });

  it('knows the item of a sentence (drink + modifier, furniture, trade good)', () => {
    expect(itemFor('Can I have some cold water, please?')).toMatchObject({ itemKey: 'water', modifier: 'cold', nameKo: '차가운 물' });
    expect(itemFor('I want the red helmet.')).toMatchObject({ itemKey: 'helmet' });
    expect(itemFor('Where is the cafe?')).toBeNull();
  });

  it('shows the item, its price, a price under every star line and the cheaper better sentence', () => {
    const html = renderToStaticMarkup(<DialogPanel {...base} />);
    const text = textOf(html);
    const offers = bankOffersFor(cafe, 'L1');
    expect(html).toContain('<b>물</b>'); // the 1-star line "Water, please." is selected first
    expect(text).toContain(`이 문장이면 🪙 ${offers[0]!.price}`);
    expect(html.match(/class="lcw-offer__price"/g)?.length).toBe(3);
    for (const o of offers) expect(html).toContain(`aria-label="${o.price}코인"`);
    expect(text).toContain(`★★★ 문장이면 🪙 ${offers[2]!.price}!`);
    expect(html).not.toContain('💬');
    expect(starPrice(20, 3)).toBeLessThan(starPrice(20, 1));
  });

  it('asking the way shows the NPC face, no price', () => {
    const html = renderToStaticMarkup(<DialogPanel {...base} npc={guide} />);
    expect(html).toContain('lcw-dlg__face');
    expect(html).not.toContain('🪙');
  });
});
