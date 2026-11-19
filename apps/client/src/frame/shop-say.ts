/**
 * "Ask in English" from the shop window (Dan R326 ⑪): the shopkeeper's dialog (Toby, the trade shop) opens with this
 * thing's order lines from the phrase bank. The server prices the granted stars (1★ list, 2★ 20% off, 3★ half) and
 * pays the sentence's coins: the child chooses the goal, the English gets the discount.
 */
import { lookupPhraseBank, shopItem, type LangLevel } from '@lcw/content';
import type { NpcRef } from '../world/api.js';

export const SHOPKEEPER: NpcRef = { id: 'shop_owner', ctx: 'trade_shop', nameKo: '토비', nameEn: 'Toby' };

export interface SayOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
}

/** The three order lines of one shop thing at the child's level (L4+ use the L3 lines), or [] for an unknown key. */
export function shopSayOffers(itemKey: string, level: LangLevel = 'L1'): SayOffer[] {
  const item = shopItem(itemKey);
  if (!item) return [];
  const lv: LangLevel = level === 'L1' || level === 'L2' ? level : 'L3';
  const entry = lookupPhraseBank({ ctx: 'trade_shop', level: lv, item: item.key, modifiers: [item.adj.toLowerCase().replace(/\s+/g, '_')] });
  if (!entry || !entry.slotsKey.startsWith(`item=${item.key}|`)) return [];
  return entry.offers.map((o) => ({
    stars: o.stars,
    text: o.text,
    hintTags: entry.hintTags.filter((t) => o.text.toLowerCase().includes(t.toLowerCase()))
  }));
}
