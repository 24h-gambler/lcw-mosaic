/**
 * Turns a pinned phrase into an expression a parent reads and understands at once (report "오늘 수업에서 나온
 * 표현", WP-310 lesson-born expressions). Teachers' F2 notes and core-pattern tags are often fragments ("Can I
 * have", "for your", "so that"); a fragment is grown to the smallest whole unit that contains it — the child's own
 * sentence from this lesson first, then the plan's target sentence — and dropped when nothing contains it.
 * Pure: no clock, no I/O.
 */

/** Words that carry no meaning on their own: a phrase made only of these is a fragment. */
export const EXPRESSION_FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the i you he she it we they me him us them my your his her our their its mine yours ' +
    'can could may might will would shall should must do does did have has had be am is are was were been being ' +
    'to for of in on at by with from into onto about as up out off over under than then ' +
    'so that and but or nor because if when while though although since until unless ' +
    'not no this these those there here what which who whom whose where why how ' +
    "i'm i'll i'd you're it's don't can't let's"
  ).split(/\s+/)
);

/** Connectors that start a new clause; a long sentence is cut at these so the unit stays short. */
const CLAUSE_STARTERS = ['so that', 'because', 'when', 'if', 'but', 'and then', 'so'];
/** A sentence up to this many words is kept whole; longer ones are cut into clauses. */
export const EXPRESSION_WHOLE_SENTENCE_MAX_WORDS = 10;
export const EXPRESSION_MAX_WORDS = 14;
const QUESTION_STARTERS = new Set(['can', 'could', 'may', 'do', 'does', 'did', 'is', 'are', 'will', 'would', 'what', 'where', 'how', 'why', 'who', 'which', 'when']);

export interface ExpressionTarget {
  text: string;
  hintTags?: readonly string[];
}

export interface ExpressionContext {
  /** The child's lines in this lesson, the most relevant first (e.g. nearest to the pin). */
  utterances: readonly string[];
  /** The lesson plan's target sentences. */
  targets?: readonly ExpressionTarget[];
}

const tokens = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function clean(raw: string): string {
  return raw
    .replace(/[“”"«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.,!?;:\s]+/, '');
}

function contentWords(ws: readonly string[]): number {
  return ws.filter((w) => !EXPRESSION_FUNCTION_WORDS.has(w) && !/^_+$/.test(w)).length;
}

/** True when the phrase stands on its own: some meaning word, enough words, and it does not stop mid-phrase. */
export function isWholeExpression(text: string): boolean {
  const ws = tokens(text);
  if (ws.length < 3 || ws.length > EXPRESSION_MAX_WORDS) return false;
  if (contentWords(ws) < 1) return false;
  const last = ws[ws.length - 1]!;
  // "I want to trade my", "Can I have a": a phrase that ends on a function word is cut off.
  return !EXPRESSION_FUNCTION_WORDS.has(last) || last === 'it' || last === 'them' || last === 'me' || last === 'you' || last === 'us';
}

function indexOfPhrase(hay: readonly string[], needle: readonly string[]): number {
  if (!needle.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Clause [start, end) word ranges of a sentence, cut before each clause starter (not at the first word). */
function clauses(ws: readonly string[]): Array<[number, number]> {
  const cuts = [0];
  for (let i = 1; i < ws.length; i++) {
    for (const s of CLAUSE_STARTERS) {
      const sw = s.split(' ');
      if (indexOfPhrase(ws.slice(i, i + sw.length), sw) === 0) {
        if (i - cuts[cuts.length - 1]! >= 2) cuts.push(i);
        break;
      }
    }
  }
  return cuts.map((c, k) => [c, cuts[k + 1] ?? ws.length] as [number, number]);
}

/** Capital first letter, '?' for questions, '.' otherwise; inner wording as the child said it. */
export function formatExpression(text: string): string {
  let t = clean(text).replace(/[.,;:\s]+$/, '');
  if (!t) return '';
  const first = tokens(t)[0] ?? '';
  const isClause = CLAUSE_STARTERS.some((s) => t.toLowerCase().startsWith(`${s} `));
  t = t[0]!.toUpperCase() + t.slice(1);
  t = t.replace(/\bi\b/g, 'I');
  if (/[?!]$/.test(t)) return t;
  if (isClause) return t.charAt(0).toLowerCase() + t.slice(1); // "because I need a helmet": a clause, no full stop
  return QUESTION_STARTERS.has(first) && first !== 'when' ? `${t}?` : `${t}.`;
}

/** The smallest whole unit of `sentence` that contains `needle`, or null when the sentence does not contain it. */
function unitAround(sentence: string, needle: readonly string[]): string | null {
  const words = clean(sentence).split(' ').filter(Boolean);
  const ws = words.map((w) => tokens(w).join(' '));
  const at = indexOfPhrase(ws, needle);
  if (at < 0) return null;
  if (words.length <= EXPRESSION_WHOLE_SENTENCE_MAX_WORDS) return words.join(' ');
  for (const [a, b] of clauses(ws)) {
    if (at >= a && at < b) {
      // The needle runs over the clause end ("so" inside "so that"): widen to the next clause.
      const end = Math.max(b, Math.min(ws.length, at + needle.length));
      const unit = words.slice(a, end).join(' ');
      return isWholeExpression(unit) ? unit : words.slice(0, Math.min(words.length, Math.max(end, EXPRESSION_MAX_WORDS))).join(' ');
    }
  }
  return words.slice(0, EXPRESSION_MAX_WORDS).join(' ');
}

/**
 * A pinned phrase as a parent-readable expression, or null to leave it out.
 * - Already whole ("I like drawing because it makes me happy"): kept (long ones cut to the clause).
 * - A fragment ("Can I have", "so that", "for your"): grown from the child's lines, then the plan targets.
 * - Nothing contains it and it carries under two meaning words: dropped.
 */
export function meaningfulExpression(raw: string, ctx: ExpressionContext): string | null {
  const text = clean(raw);
  const ws = tokens(text);
  if (!ws.length || !/[a-z]/i.test(text)) return null;
  if (isWholeExpression(text)) return formatExpression(text);
  if (ws.length > EXPRESSION_MAX_WORDS) {
    // A whole long line: the clause with a core pattern of the plan, else the first whole clause.
    const words = text.split(' ').filter(Boolean);
    const parts = clauses(words.map((w) => tokens(w).join(' '))).map(([a, b]) => words.slice(a, b).join(' ')).filter(isWholeExpression);
    const tags = (ctx.targets ?? []).flatMap((t) => t.hintTags ?? []).map((t) => tokens(t));
    // A clause that opens with a core pattern ("because …", "so that …") is the lesson's point; then any clause with one.
    const withTag =
      parts.find((c) => tags.some((tg) => indexOfPhrase(tokens(c), tg) === 0)) ??
      parts.find((c) => tags.some((tg) => indexOfPhrase(tokens(c), tg) >= 0));
    const pick = withTag ?? parts[0];
    return pick ? formatExpression(pick) : null;
  }
  // One stray word ("the", "yes") is not a pinned phrase; a one-word core pattern of the plan ("because") is.
  const planTags = new Set((ctx.targets ?? []).flatMap((t) => t.hintTags ?? []).map((t) => tokens(t).join(' ')));
  if (ws.length === 1 && !planTags.has(ws[0]!)) return null;
  // Plan sentences with blanks ("My name is ___.") are patterns, not something the child said.
  const sources = [...ctx.utterances, ...(ctx.targets ?? []).map((t) => t.text).filter((t) => !t.includes('_'))];
  for (const s of sources) {
    const unit = unitAround(s, ws);
    if (unit && isWholeExpression(unit)) return formatExpression(unit);
  }
  return contentWords(ws) >= 2 && ws.length >= 2 && !EXPRESSION_FUNCTION_WORDS.has(ws[ws.length - 1]!) ? formatExpression(text) : null;
}

/** meaningfulExpression over a list, duplicates (same words) collapsed, order kept. */
export function meaningfulExpressions(raws: readonly string[], ctx: ExpressionContext, max = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raws) {
    const e = meaningfulExpression(r, ctx);
    if (!e) continue;
    const k = tokens(e).join(' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}
