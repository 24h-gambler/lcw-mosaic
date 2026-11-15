import {
  CAFE_MENU,
  TRADE_SHOP_GOODS,
  CAFE_MODIFIERS,
  lookupPhraseBank,
  type LangLevel
} from '@lcw/content';
import {
  UnderstandResponseSchema,
  type NpcContext,
  type Slots,
  type UnderstandResponse
} from '@lcw/schemas';
import { QuotaMeter } from '@lcw/quota';
import { normalizeMixedUtterance } from './normalizer.js';

const COLOR_WORDS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'black', 'white', 'silver', 'gold'];

const KNOWN_ITEMS_BY_CTX: Record<string, string[]> = {
  cafe: CAFE_MENU.map((d) => d.label),
  trade_shop: TRADE_SHOP_GOODS.map((g) => g.label),
  makers_lab: ['jetpack', 'iron pickaxe', 'pickaxe', 'drill', 'boots', 'helmet', 'water balloon', 'dynamite', 'sword', 'wand', 'bow', 'winter coat', 'heat suit', 'space suit'],
  boutique: ['raincoat', 'umbrella', 'coat', 'suit', 'boots', 'winter coat', 'desert cloak'],
  exchange: ['coal', 'iron', 'gold', 'ruby', 'diamond', 'nether crystal'],
  court: ['apology'],
  lottery: ['ticket'],
  repair_shop: ['repair']
};

export interface ParsedIntentAndSlots {
  intent: string;
  slots: Slots;
  normalized: string;
  unknownKoreanTokens: string[];
  matchedAnySlot: boolean;
}

export function parseIntentAndSlots(ctx: NpcContext, transcript: string): ParsedIntentAndSlots {
  const norm = normalizeMixedUtterance(transcript);
  const lower = norm.normalized.toLowerCase();

  let color: string | null = null;
  for (const c of COLOR_WORDS) {
    if (norm.tokens.includes(c)) {
      color = c;
      break;
    }
  }

  const modifiers: string[] = [];
  for (const mod of CAFE_MODIFIERS) {
    if (norm.tokens.includes(mod)) modifiers.push(mod);
  }
  if (norm.tokens.includes('iron') && !modifiers.includes('iron')) modifiers.push('iron');
  if (norm.tokens.includes('fast') && !modifiers.includes('fast')) modifiers.push('fast');
  if (norm.tokens.includes('strong') && !modifiers.includes('strong')) modifiers.push('strong');

  const candidates = KNOWN_ITEMS_BY_CTX[ctx] ?? KNOWN_ITEMS_BY_CTX.makers_lab!;
  let item = '';
  // Check multi-word items before single-word items
  const sortedCandidates = [...candidates].sort((a, b) => b.length - a.length);
  for (const cand of sortedCandidates) {
    if (lower.includes(cand)) {
      item = cand.replace(/\s+/g, '_');
      break;
    }
  }

  let intent = 'order_item';
  if (ctx === 'cafe') intent = 'order_drink';
  else if (ctx === 'boutique') intent = 'order_outfit';
  else if (ctx === 'exchange') intent = 'sell_ore';
  else if (ctx === 'trade_shop') intent = 'trade_item';
  else if (ctx === 'court') intent = 'defend';
  else if (ctx === 'lottery') intent = 'pledge';
  else if (ctx === 'repair_shop') intent = 'recall';

  const matchedAnySlot = item.length > 0 || color !== null || modifiers.length > 0;
  const fallbackItem =
    item ||
    (ctx === 'cafe'
      ? 'water'
      : ctx === 'boutique'
        ? 'raincoat'
        : ctx === 'exchange'
          ? 'gold'
          : ctx === 'court'
            ? 'apology'
            : ctx === 'lottery'
              ? 'ticket'
              : ctx === 'repair_shop'
                ? 'repair'
                : ctx === 'trade_shop'
                  ? 'helmet'
                  : 'jetpack');

  return {
    intent,
    slots: {
      item: fallbackItem,
      color,
      modifiers,
      reason: null
    },
    normalized: norm.normalized || 'Water, please.',
    unknownKoreanTokens: norm.unknownKoreanTokens,
    matchedAnySlot
  };
}

export interface BoardSelection {
  item: string;
  color?: string | null;
  modifier?: string;
}

const COLOR_HEX_MAP: Record<string, string> = {
  red: '#C0392B',
  blue: '#3FA9F5',
  green: '#3DBE6B',
  yellow: '#FFC53D',
  purple: '#8E5BE8',
  orange: '#FF6B4A',
  silver: '#C9CED9'
};

export function understandUtterance(params: {
  ctx: NpcContext;
  level: LangLevel;
  transcript: string;
  seatId?: string;
  isLesson?: boolean;
  quotaMeter?: QuotaMeter;
  nowMs?: number;
}): UnderstandResponse {
  const parsed = parseIntentAndSlots(params.ctx, params.transcript);
  const bankEntry = lookupPhraseBank({
    ctx: params.ctx,
    level: params.level,
    item: parsed.slots.item,
    color: parsed.slots.color,
    modifiers: parsed.slots.modifiers
  });

  // Always check quota before any theoretical LLM usage; if exhausted (or 0), bank serves cleanly (WP-112)
  const canUseLlm = params.quotaMeter
    ? params.quotaMeter.canUseCreativeLlm({
        seatId: params.seatId ?? 'anon',
        isLesson: params.isLesson ?? false,
        nowMs: params.nowMs ?? 0
      })
    : false;

  const chosenOffers = bankEntry?.offers ?? [
    { stars: 1, text: `I want ${parsed.slots.item}, please.`, price: 100, bonus: null },
    { stars: 2, text: `Can I get a ${parsed.slots.item}, please?`, price: 80, bonus: null },
    {
      stars: 3,
      text: `I'm looking for a ${parsed.slots.item} so that I can use it today.`,
      price: 50,
      bonus: 'bonus_1'
    }
  ];

  const response: UnderstandResponse = {
    normalized: parsed.normalized,
    intent: parsed.intent,
    slots: parsed.slots,
    offers: chosenOffers,
    hint_tags: bankEntry?.hintTags ?? [parsed.slots.item, 'please'],
    item_spec_preview: bankEntry
      ? {
          base_mesh: bankEntry.baseMesh,
          socket: bankEntry.socket,
          shader_params: {
            primary_color: COLOR_HEX_MAP[parsed.slots.color ?? 'red'] ?? '#C0392B'
          }
        }
      : null,
    source: bankEntry ? 'bank' : canUseLlm ? 'llm' : 'rule'
  };

  return UnderstandResponseSchema.parse(response);
}

export function understandFromBoard(params: {
  ctx: NpcContext;
  level: LangLevel;
  selection: BoardSelection;
}): UnderstandResponse {
  const bankEntry = lookupPhraseBank({
    ctx: params.ctx,
    level: params.level,
    item: params.selection.item,
    color: params.selection.color ?? null,
    modifiers: params.selection.modifier ? [params.selection.modifier] : []
  });

  const res: UnderstandResponse = {
    normalized: `${params.selection.modifier ?? ''} ${params.selection.color ?? ''} ${params.selection.item}`.trim(),
    intent: params.ctx === 'cafe' ? 'order_drink' : 'order_item',
    slots: {
      item: params.selection.item,
      color: params.selection.color ?? null,
      modifiers: params.selection.modifier ? [params.selection.modifier] : [],
      reason: null
    },
    offers: bankEntry?.offers ?? [
      { stars: 1, text: `${params.selection.item}, please.`, price: 40, bonus: null },
      { stars: 2, text: `Can I have ${params.selection.item}, please?`, price: 32, bonus: null },
      {
        stars: 3,
        text: `Can I have ${params.selection.item} so that I can continue?`,
        price: 20,
        bonus: 'thirst_buff_3m'
      }
    ],
    hint_tags: bankEntry?.hintTags ?? [params.selection.item, 'please'],
    item_spec_preview: bankEntry
      ? {
          base_mesh: bankEntry.baseMesh,
          socket: bankEntry.socket,
          shader_params: {
            primary_color: COLOR_HEX_MAP[params.selection.color ?? 'red'] ?? '#3FA9F5'
          }
        }
      : null,
    source: 'board'
  };

  return UnderstandResponseSchema.parse(res);
}
