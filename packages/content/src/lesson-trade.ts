/**
 * Trading with the teacher in a lesson (Dan 11-19 R325: "선생은 이런저런 도구·물건을 많이 가지고 있고, 학생과 트레이드를
 * 진행할 수 있게"). The teacher's avatar in the child's world is always a talk target: E, a click or a tap opens the
 * trade window. The teacher carries everything the town already defines (the trade shop's tools, the cafe's drinks,
 * the furniture shop's goods), so a trade reuses the same item keys, names, pictures and world models.
 *
 * A trade is English practice: the child says the trade sentence (one of `tradeOffers`, 1~3 stars by how much they
 * say), the server scores it like any lesson sentence and only then moves the things (apps/edge lesson-mode.ts
 * POST /v1/lesson/trade). The sentences are built here, on both sides, so the server can check that the sentence the
 * child chose is one of this trade's sentences (no trading with "hi").
 */
import { CAFE_MENU, FURNITURE_SHOP_GOODS, TRADE_SHOP_GOODS } from './lang-en-ko.js';

export interface TeacherStockItem {
  key: string;
  /** English word as the child says it ("lantern", "honey tea"). */
  label: string;
  /** One describing word for the longer sentence ("bright lantern"); '' when the thing has none. */
  adj: string;
  nameKo: string;
  emoji: string;
  kind: 'tool' | 'drink' | 'furniture';
}

const TOOLS: TeacherStockItem[] = TRADE_SHOP_GOODS.map((g) => ({ key: g.key, label: g.label, adj: g.adj, nameKo: g.nameKo, emoji: g.emoji, kind: 'tool' as const }));
const DRINKS: TeacherStockItem[] = CAFE_MENU.map((d) => ({ key: d.key, label: d.label, adj: d.defaultMod, nameKo: d.nameKo, emoji: d.emoji, kind: 'drink' as const }));
const FURNITURE: TeacherStockItem[] = FURNITURE_SHOP_GOODS.map((g) => ({ key: g.key, label: g.label, adj: g.adj, nameKo: g.nameKo, emoji: g.emoji, kind: 'furniture' as const }));

/** Everything the teacher can hand over in a lesson: tools first (the trade role-play), then drinks and furniture. */
export const TEACHER_STOCK: readonly TeacherStockItem[] = [...TOOLS, ...DRINKS, ...FURNITURE];

/** The teacher's id as a speaker in the child's world (lesson lines, the trade window): the visiting teacher NPC id. */
export const TEACHER_SPEAKER_ID = 'teacher';

/** How many trades one lesson keeps open for one child (a trade is a sentence; more than this is not a lesson any more). */
export const LESSON_TRADES_MAX = 60;

const STOCK_BY_KEY = new Map(TEACHER_STOCK.map((s) => [s.key, s]));

export function teacherStockItem(key: string | null | undefined): TeacherStockItem | null {
  return key ? (STOCK_BY_KEY.get(key) ?? null) : null;
}

/**
 * The English word for a thing the child owns (the bag's item keys). Known things by their label; anything else by
 * its key with spaces ("blue_stone" → "blue stone"), so every bag item can be offered in a sentence.
 */
export function itemWordEn(key: string): string {
  const known = STOCK_BY_KEY.get(key);
  if (known) return known.label;
  return key
    .replace(/^furn_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^A-Za-z ]/g, '')
    .trim()
    .toLowerCase() || 'thing';
}

export interface TradeOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
}

export type TradeLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

/**
 * The sentences for one trade, one per star grade. `getKey` = what the child asks the teacher for (a stock key),
 * `giveKey` = the thing the child hands over (a bag item key). Either may be missing, not both.
 *   get only:    "The lantern, please." · "Can I have the lantern, please?" · "Can I have the bright lantern, please?"
 *   give + get:  "My apple for the lantern." · "Can I trade my apple for the lantern?" · "Can I trade my apple for your bright lantern, please?"
 *   give only:   "This is for you." · "Here is my apple." · "Here is my apple for you, teacher."
 * L3 and up say it the polite way ("Could I …", "I'd like to trade …").
 */
export function tradeOffers(p: { getKey?: string | null; giveKey?: string | null; level?: TradeLevel }): TradeOffer[] {
  const get = teacherStockItem(p.getKey ?? null);
  const give = p.giveKey ? itemWordEn(p.giveKey) : null;
  const high = p.level !== undefined && !['L1', 'L2'].includes(p.level);
  if (get && give) {
    const full = get.adj ? `${get.adj} ${get.label}` : get.label;
    return [
      { stars: 1, text: `My ${give} for the ${get.label}.`, hintTags: [give, get.label] },
      { stars: 2, text: high ? `Could I trade my ${give} for the ${get.label}?` : `Can I trade my ${give} for the ${get.label}?`, hintTags: ['trade', give, get.label] },
      {
        stars: 3,
        text: high ? `I'd like to trade my ${give} for your ${full}, please.` : `Can I trade my ${give} for your ${full}, please?`,
        hintTags: ['trade', give, get.label]
      }
    ];
  }
  if (get) {
    const full = get.adj ? `${get.adj} ${get.label}` : get.label;
    return [
      { stars: 1, text: `The ${get.label}, please.`, hintTags: [get.label, 'please'] },
      { stars: 2, text: high ? `Could I have the ${get.label}, please?` : `Can I have the ${get.label}, please?`, hintTags: ['can i have', get.label] },
      { stars: 3, text: high ? `Could I have the ${full}, please?` : `Can I have the ${full}, please?`, hintTags: ['can i have', get.label] }
    ];
  }
  if (give) {
    return [
      { stars: 1, text: 'This is for you.', hintTags: ['for you'] },
      { stars: 2, text: `Here is my ${give}.`, hintTags: ['here is', give] },
      { stars: 3, text: `Here is my ${give} for you, teacher.`, hintTags: ['here is', give, 'for you'] }
    ];
  }
  return [];
}

/** The teacher's answer when a trade went through (shown over the teacher and read aloud on the child's screen). */
export function tradeReplyEn(p: { getKey?: string | null; giveKey?: string | null }): string {
  const get = teacherStockItem(p.getKey ?? null);
  const give = p.giveKey ? itemWordEn(p.giveKey) : null;
  // "boots", "glasses": here are; "lantern": here is
  const be = get && /[^s]s$/.test(get.label) ? 'are' : 'is';
  if (get && give) return `Deal! Here ${be} the ${get.label}. Thank you for the ${give}!`;
  if (get) return `Sure! Here ${be} the ${get.label}.`;
  if (give) return `Thank you for the ${give}!`;
  return 'Thank you!';
}

/** R326 ⑫: own words that asked for nothing in a trade: what the teacher says back (Korean help line + English). */
export function tradeNotUnderstood(example: string): { ko: string; en: string } {
  return { ko: `무엇을 바꾸고 싶은지 영어로 말해 봐요. 예: ${example}`, en: `Tell me what you want in English. Like: ${example}` };
}

/** R326 ⑫: the teacher's opening line when the child just wants to talk (trade window 「💬 Just talk」). */
export const TEACHER_TALK_OPENING_EN = 'Hi! What do you want to tell me?';

/** The teacher's line when the teacher hands something over from the console or the world (no sentence needed). */
export function giftLineEn(key: string): string {
  const s = teacherStockItem(key);
  if (!s) return 'Here is something for you!';
  return /[^s]s$/.test(s.label) ? `Here are some ${s.label} for you!` : `Here is ${articleOf(s.label)} ${s.label} for you!`;
}

/** The teacher's opening line in the trade window (the dialog's NPC line before the child says the trade sentence). */
export function tradeOpeningEn(p: { getKey?: string | null; giveKey?: string | null }): string {
  if (p.getKey) return `Hello! Do you want the ${itemWordEn(p.getKey)}?`;
  if (p.giveKey) {
    const w = itemWordEn(p.giveKey);
    return `Oh, ${articleOf(w)} ${w}! Is it for me?`;
  }
  return 'Hello! What would you like?';
}

function articleOf(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * R331 (함께 진행): the teacher's trade proposal from the in-world panel, one shape both sides know — the panel says it as
 * the teacher, the child's side spots it so E at the teacher opens the trade window with that thing already picked.
 */
export function tradeAskLine(sentence: string, itemLabel: string): string {
  return `Say "${sentence}" and the ${itemLabel} is yours!`;
}
const TRADE_ASK_RE = /^Say "(.+)" and the (.+) is yours!$/;
/** A teacher line that is a trade proposal (tradeAskLine's shape). */
export function isTradeAskLine(text: string): boolean {
  return TRADE_ASK_RE.test(text.trim());
}
/** The proposed thing's key (null: not a proposal line, or a thing the teacher does not carry). */
export function tradeAskItemKey(text: string): string | null {
  const m = TRADE_ASK_RE.exec(text.trim());
  if (!m) return null;
  const label = m[2]!.toLowerCase();
  return TEACHER_STOCK.find((it) => it.label.toLowerCase() === label)?.key ?? null;
}
