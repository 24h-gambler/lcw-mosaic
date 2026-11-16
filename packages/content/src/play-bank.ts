/**
 * Phrase bank for the play modes (docs/01 6장 경영자; docs/03 D2·D4; docs/04 4.2 맥락별 파라미터). Same shape and
 * the same scoring path as every other bank entry (`PHRASE_BANK`, `decideConverseReward`): the play module only adds
 * sentences, never its own scorer. Stars follow docs/04 4.3: 1★ corrected, 2★ expanded, 3★ a clause (because, so
 * that, if) or a higher word.
 *
 * Coins: shop goods (suit, pickaxe, drill) carry their docs/03 D2 prices and are bought on the normal purchase path.
 * Everything else is price 0 here: what it earns (exchange money, a job, a day's pay, a tip) is decided by the server
 * play module (apps/edge/src/play.ts) from the granted stars.
 *
 * This file imports only types from lang-en-ko.ts (it is spread into PHRASE_BANK there; no runtime cycle).
 */
import type { LangLevel, PhraseBankEntry, PhraseOffer } from './lang-en-ko.js';

type Three = [string, string, string];
const LEVELS: readonly LangLevel[] = ['L1', 'L2', 'L3'];

function free(t: Three, bonus: [string | null, string | null, string | null] = [null, null, null]): [PhraseOffer, PhraseOffer, PhraseOffer] {
  return [
    { stars: 1, text: t[0], price: 0, bonus: bonus[0] },
    { stars: 2, text: t[1], price: 0, bonus: bonus[1] },
    { stars: 3, text: t[2], price: 0, bonus: bonus[2] }
  ];
}

/** docs/03 D3 가격식: 1★ list price, 2★ 20% off, 3★ 50% off. */
function priced(t: Three, base: number, bonus3: string | null = null): [PhraseOffer, PhraseOffer, PhraseOffer] {
  return [
    { stars: 1, text: t[0], price: base, bonus: null },
    { stars: 2, text: t[1], price: Math.round(base * 0.8), bonus: null },
    { stars: 3, text: t[2], price: Math.round(base * 0.5), bonus: bonus3 }
  ];
}

function entry(
  ctx: string,
  intent: string,
  item: string,
  level: LangLevel,
  offers: [PhraseOffer, PhraseOffer, PhraseOffer],
  hintTags: string[],
  baseMesh: string,
  socket: PhraseBankEntry['socket'] = 'RightHand_Socket'
): PhraseBankEntry {
  return { id: `play_${ctx}_${level}_${item}`, lang: 'en', ctx, intent, slotsKey: `item=${item}|kind=play`, level, offers, hintTags, baseMesh, socket };
}

/* ---------------------------------------------------------------- shop goods: suit (tailor), tools (maker) */

/** docs/03 D2 장비 표: what the market hall sells for coins. The suit is the interview condition (D4). */
export const PLAY_SHOP_GOODS = [
  { key: 'suit', ctx: 'boutique', nameKo: '정장', emoji: '👔', basePrice: 600, socket: 'Body_Socket' as const },
  { key: 'pickaxe', ctx: 'makers_lab', nameKo: '철 곡괭이', emoji: '⛏️', basePrice: 300, socket: 'RightHand_Socket' as const },
  { key: 'drill', ctx: 'makers_lab', nameKo: '드릴', emoji: '🛠️', basePrice: 350, socket: 'RightHand_Socket' as const }
] as const;

const SHOP_LINES: Record<string, Record<'L1' | 'L2' | 'L3', Three>> = {
  suit: {
    L1: ['A suit, please.', 'A black suit, please.', 'Can I have a black suit, please?'],
    L2: ['I want a black suit.', 'Can I get a nice black suit?', 'Can I get a black suit because I have a job interview?'],
    L3: ["I'd like a black suit, please.", 'Could you find me a smart black suit in my size?', "I'm looking for a smart black suit so that I can look good at my interview."]
  },
  pickaxe: {
    L1: ['A pickaxe, please.', 'An iron pickaxe, please.', 'Can I have an iron pickaxe, please?'],
    // L2 is the older entry makers_lab_L2_pickaxe_iron (lang-en-ko.ts); the same sentences, kept there.
    L2: ['I want an iron pickaxe.', 'Can I get a strong iron pickaxe?', 'Can I get a strong iron pickaxe to mine gold?'],
    L3: ["I'd like an iron pickaxe, please.", 'Could you make a strong iron pickaxe for me?', 'I need a strong iron pickaxe so that I can mine gold deep down.']
  },
  drill: {
    L1: ['A drill, please.', 'A fast drill, please.', 'Can I have a fast drill, please?'],
    L2: ['I want a drill.', 'Can I get a fast drill?', 'Can I get a fast drill because I want to find diamonds?'],
    L3: ["I'd like a drill, please.", 'Could you build a fast drill with a strong tip?', 'I need a fast drill so that I can dig down to the diamonds.']
  }
};

const SHOP_TAGS: Record<string, Record<'L1' | 'L2' | 'L3', string[]>> = {
  suit: { L1: ['suit', 'black', 'can I have'], L2: ['suit', 'interview', 'because'], L3: ['suit', 'could you', 'so that'] },
  pickaxe: { L1: ['pickaxe', 'iron', 'can I have'], L2: ['iron pickaxe', 'strong', 'mine gold'], L3: ['pickaxe', 'could you', 'so that'] },
  drill: { L1: ['drill', 'fast', 'can I have'], L2: ['drill', 'diamonds', 'because'], L3: ['drill', 'could you', 'so that'] }
};

/* ---------------------------------------------------------------- exchange (docs/04 4.2 환전소: 숫자, 제안, 양보) */

/** Ores the exchange buys (docs/03 D2), with the noun forms the sentences need. */
export const EXCHANGE_ORES = [
  { key: 'coal', nameKo: '석탄', emoji: '⚫', mine: 'my coal', all: 'all my coal', one: 'this coal' },
  { key: 'iron', nameKo: '철광석', emoji: '🟤', mine: 'my iron ore', all: 'all my iron ore', one: 'this iron ore' },
  { key: 'gold', nameKo: '금', emoji: '🟡', mine: 'my gold', all: 'all my gold', one: 'this gold' },
  { key: 'ruby', nameKo: '루비', emoji: '🔴', mine: 'my rubies', all: 'all my rubies', one: 'these rubies' },
  { key: 'diamond', nameKo: '다이아몬드', emoji: '💎', mine: 'my diamonds', all: 'all my diamonds', one: 'these diamonds' }
] as const;
export type ExchangeOre = (typeof EXCHANGE_ORES)[number]['key'];

function exchangeLines(o: (typeof EXCHANGE_ORES)[number], level: LangLevel): Three {
  if (level === 'L1') return [`Sell ${o.mine}, please.`, `I want to sell ${o.mine}.`, `Can I sell ${o.all}, please?`];
  if (level === 'L2')
    return [`I want to sell ${o.one}.`, `Could you give me ten percent more for ${o.one}?`, `If you offer twenty-five percent more, I will sell ${o.all} today.`];
  return [`I'd like to sell ${o.mine}, please.`, `Could you pay me a little more for ${o.one}?`, `If you can pay twenty-five percent more, I'll sell you ${o.all} right now.`];
}

function exchangeTags(o: (typeof EXCHANGE_ORES)[number], level: LangLevel): string[] {
  const noun = o.key === 'iron' ? 'iron ore' : o.key === 'ruby' ? 'rubies' : o.key === 'diamond' ? 'diamonds' : o.key;
  if (level === 'L1') return [noun, 'sell', 'can I'];
  if (level === 'L2') return [noun, 'if you offer', 'sell'];
  return [noun, 'could you', 'if you can'];
}

/* ---------------------------------------------------------------- office: interview, boss, customers */

export type InterviewTurn = 'interview_intro' | 'interview_why' | 'interview_strength';
export const INTERVIEW_TURNS: readonly InterviewTurn[] = ['interview_intro', 'interview_why', 'interview_strength'];

/** The interviewer's question for each turn (English line read by the NPC; Korean help on the client). */
export const INTERVIEW_QUESTIONS: Readonly<Record<InterviewTurn, string>> = {
  interview_intro: 'Welcome! Please tell me about yourself.',
  interview_why: 'Why do you want to work here?',
  interview_strength: 'What are you good at?'
};

const INTERVIEW_LINES: Record<InterviewTurn, Record<'L1' | 'L2' | 'L3', Three>> = {
  interview_intro: {
    L1: ['Hello, I am here for the job.', 'Hello, I am here for the job interview.', 'Hello, nice to meet you. I am here for the job interview.'],
    L2: ['Hello, I am here for the interview.', 'Hello, I am happy to meet you today.', 'Hello, I am happy to be here because I really want this job.'],
    L3: ["Good morning, I'm here for the interview.", "Good morning, it's a pleasure to meet you.", "Good morning, it's a pleasure to meet you, and I'm excited about this job."]
  },
  interview_why: {
    L1: ['I like this town.', 'I like to help people.', 'I want this job because I like to help people.'],
    L2: ['I want to work here.', 'I want to work here and help customers.', 'I want to work here because I like helping customers.'],
    L3: ["I'd like to work in this office.", "I'd like to work here and learn new things.", "I'd like to work here because I enjoy solving problems for people."]
  },
  interview_strength: {
    L1: ['I am kind.', 'I am kind and fast.', 'I am kind, so people like to talk to me.'],
    L2: ['I am good at talking.', 'I am good at talking with people.', 'I am good at talking with people, so I can help your customers.'],
    L3: ["I'm a hard worker.", "I'm a hard worker and a good listener.", "I'm a good listener, so I can understand what customers really need."]
  }
};

const INTERVIEW_TAGS: Record<InterviewTurn, Record<'L1' | 'L2' | 'L3', string[]>> = {
  interview_intro: { L1: ['here for', 'nice to meet you'], L2: ['happy to', 'because'], L3: ['pleasure', "and I'm"] },
  interview_why: { L1: ['help', 'because'], L2: ['help', 'because'], L3: ['enjoy', 'because'] },
  interview_strength: { L1: ['kind', 'so'], L2: ['good at', 'so I can'], L3: ['good listener', 'so I can'] }
};

export type BossLine = 'boss_report' | 'boss_late';
/** What the boss says when the child arrives (on time / late). */
export const BOSS_QUESTIONS: Readonly<Record<BossLine, string>> = {
  boss_report: 'Good morning! Are you ready for work?',
  boss_late: 'You are late today. What happened?'
};

const BOSS_LINES: Record<BossLine, Record<'L1' | 'L2' | 'L3', Three>> = {
  boss_report: {
    L1: ['Good morning!', 'Good morning, I am here.', 'Good morning, I am here and ready to work.'],
    L2: ["Good morning, I'm here.", 'Good morning, I came early today.', 'Good morning, I came early because I want to do a good job.'],
    L3: ["Good morning, I'm ready to start.", "Good morning, I'm ready to start my shift.", 'Good morning, I came in early so that I could prepare for the customers.']
  },
  // docs/03 D4 "지각하면 상사에게 사유를 말해야 합니다(과거 시제·변명)".
  boss_late: {
    L1: ['Sorry, I am late.', 'I am sorry. I was late.', 'I am sorry I was late. The bus was slow.'],
    L2: ['Sorry, I was late.', "I'm sorry, I missed the bus today.", "I'm sorry I was late because I missed the bus this morning."],
    L3: ['I apologize for being late.', "I'm sorry, I missed the bus and had to walk.", "I'm sorry I was late; I missed the bus, but I will leave home earlier tomorrow."]
  }
};

const BOSS_TAGS: Record<BossLine, Record<'L1' | 'L2' | 'L3', string[]>> = {
  boss_report: { L1: ['good morning', 'ready to'], L2: ['came early', 'because'], L3: ['prepare', 'so that'] },
  boss_late: { L1: ['sorry', 'was'], L2: ['missed', 'because'], L3: ['missed', 'but I will'] }
};

/** docs/03 D4 "고객 클레임 시나리오는 office.customer.* 묶음에서 레벨에 맞게 추첨". */
export const CUSTOMER_SCENARIOS = [
  { key: 'customer_cold_coffee', lineEn: 'Excuse me, my coffee is cold!', lineKo: '커피가 식었대요', thing: 'coffee', fix: 'get you a hot coffee', because: 'yours is cold' },
  { key: 'customer_lost_umbrella', lineEn: 'Oh no, I lost my umbrella in here!', lineKo: '우산을 잃어버렸대요', thing: 'umbrella', fix: 'help you find your umbrella', because: 'it is raining outside' },
  { key: 'customer_broken_lamp', lineEn: 'The lamp on my desk is broken!', lineKo: '책상 전등이 고장 났대요', thing: 'lamp', fix: 'change the lamp', because: 'it is too dark to work' },
  { key: 'customer_wrong_size', lineEn: 'This shirt is too small for me!', lineKo: '셔츠가 너무 작대요', thing: 'shirt', fix: 'bring you a bigger shirt', because: 'this one is too small' }
] as const;
export type CustomerScenarioKey = (typeof CUSTOMER_SCENARIOS)[number]['key'];

function customerLines(s: (typeof CUSTOMER_SCENARIOS)[number], level: LangLevel): Three {
  // every line names this customer's thing: the bank finds a sentence by its words, so no two claims may share one
  if (level === 'L1') return [`Sorry, the ${s.thing}.`, `I am so sorry about the ${s.thing}.`, `I am sorry. Let me ${s.fix}.`];
  if (level === 'L2') return [`I'm sorry about the ${s.thing}.`, `I'm sorry, I can ${s.fix}.`, `I'm sorry, I will ${s.fix} because ${s.because}.`];
  return [`I'm very sorry about your ${s.thing}.`, `I'm sorry for the trouble; could I ${s.fix}?`, `I'm sorry for the trouble, so let me ${s.fix} right away.`];
}

const CUSTOMER_TAGS: Record<'L1' | 'L2' | 'L3', string[]> = { L1: ['sorry', 'let me'], L2: ['I can', 'because'], L3: ['could I', 'so let me'] };

/** Director's negotiation mission (docs/03 D4 디렉터 "협상 미션", docs/04 4.3 L5 협상·양보). */
export const NEGOTIATION = {
  key: 'customer_negotiate',
  lineEn: 'I want to buy one hundred lamps. Can you give me a better price?',
  lineKo: '전등 100개를 산대요. 더 싸게 해 달래요'
} as const;

const NEGOTIATION_LINES: Record<'L1' | 'L2' | 'L3', Three> = {
  L1: ['Okay, a good price.', 'We can make it cheaper.', 'If you buy a lot, we can make it cheaper.'],
  L2: ['We can give you ten percent off.', 'We can give you ten percent off if you pay today.', 'If you buy one hundred lamps, we can give you fifteen percent off and free delivery.'],
  L3: ['We could offer ten percent off.', 'We could offer ten percent off if you order today.', 'If you order one hundred lamps today, we could offer fifteen percent off with free delivery.']
};
const NEGOTIATION_TAGS: Record<'L1' | 'L2' | 'L3', string[]> = { L1: ['cheaper', 'if you'], L2: ['if you', 'we can'], L3: ['if you', 'we could'] };

/* ---------------------------------------------------------------- the bank */

function build(): PhraseBankEntry[] {
  const out: PhraseBankEntry[] = [];
  for (const level of LEVELS) {
    const l = level as 'L1' | 'L2' | 'L3';
    for (const g of PLAY_SHOP_GOODS) {
      if (g.key === 'pickaxe' && level === 'L2') continue; // makers_lab_L2_pickaxe_iron already sells it
      const intent = g.ctx === 'boutique' ? 'order_outfit' : 'order_item';
      out.push(entry(g.ctx, intent, g.key, level, priced(SHOP_LINES[g.key]![l], g.basePrice, g.key === 'suit' ? 'rare_color' : 'durability_plus'), SHOP_TAGS[g.key]![l], `item_${g.key}_01`, g.socket));
    }
    for (const o of EXCHANGE_ORES) {
      if (o.key === 'gold' && level === 'L2') continue; // exchange_L2_gold_sell (lang-en-ko.ts) is the same line set
      out.push(entry('exchange', 'sell_ore', o.key, level, free(exchangeLines(o, level), ['market_base', 'plus_10', 'plus_25']), exchangeTags(o, level), `item_ore_${o.key}`));
    }
    for (const t of INTERVIEW_TURNS) out.push(entry('interview', 'interview_answer', t, level, free(INTERVIEW_LINES[t][l]), INTERVIEW_TAGS[t][l], 'item_badge_01'));
    for (const b of ['boss_report', 'boss_late'] as const) out.push(entry('boss', b === 'boss_late' ? 'excuse' : 'report', b, level, free(BOSS_LINES[b][l]), BOSS_TAGS[b][l], 'item_badge_01'));
    for (const s of CUSTOMER_SCENARIOS) out.push(entry('customer', 'handle_claim', s.key, level, free(customerLines(s, level)), [s.thing, ...CUSTOMER_TAGS[l]], 'item_badge_01'));
    out.push(entry('customer', 'negotiate', NEGOTIATION.key, level, free(NEGOTIATION_LINES[l]), NEGOTIATION_TAGS[l], 'item_badge_01'));
  }
  return out;
}

export const PLAY_BANK: readonly PhraseBankEntry[] = build();

/**
 * Korean label and emoji of every play item key (memory cards, review dock: "{item}에 번개 표시가 떴어요").
 * Interview, boss and customer keys name the moment the sentence was for.
 */
export const PLAY_LABELS: ReadonlyArray<{ key: string; nameKo: string; emoji: string }> = [
  ...PLAY_SHOP_GOODS.map((g) => ({ key: g.key, nameKo: g.nameKo, emoji: g.emoji })),
  ...EXCHANGE_ORES.map((o) => ({ key: o.key, nameKo: o.nameKo, emoji: o.emoji })),
  { key: 'interview_intro', nameKo: '면접 자기소개', emoji: '💼' },
  { key: 'interview_why', nameKo: '면접 지원 이유', emoji: '💼' },
  { key: 'interview_strength', nameKo: '면접 내 장점', emoji: '💼' },
  { key: 'boss_report', nameKo: '출근 인사', emoji: '🕘' },
  { key: 'boss_late', nameKo: '늦은 사정 말하기', emoji: '🕘' },
  { key: 'customer_cold_coffee', nameKo: '식은 커피 손님', emoji: '☕' },
  { key: 'customer_lost_umbrella', nameKo: '우산 잃은 손님', emoji: '☂️' },
  { key: 'customer_broken_lamp', nameKo: '전등 고장 손님', emoji: '💡' },
  { key: 'customer_wrong_size', nameKo: '작은 셔츠 손님', emoji: '👕' },
  { key: NEGOTIATION.key, nameKo: '손님과 협상', emoji: '🤝' }
];
