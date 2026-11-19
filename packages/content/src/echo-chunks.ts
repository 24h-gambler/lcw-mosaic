const CHUNK_BREAKERS = new Set(['because', 'so', 'for', 'with', 'to', 'if', 'when', 'and']);

const normWord = (w: string): string => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * ECHO (docs/04 4.1, docs/08 8.2 "구 단위로 끊어 따라 말하기"): phrases of 2~4 words, broken at commas and before
 * connectors so a child repeats meaningful pieces. Here (not in the client) because the echo pieces of every offer
 * sentence are fixed lines the model voice reads (tts-lines.ts): the nightly local voice makes them ahead (R2625).
 */
export function chunkPhrases(text: string, maxWords = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const n = normWord(w);
    if (cur.length >= 2 && CHUNK_BREAKERS.has(n)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    if ((/[,.?!]$/.test(w) && cur.length >= 2) || cur.length >= maxWords) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur);
  // A lone word is not a phrase: glue it to its neighbour.
  for (let i = chunks.length - 1; i >= 0 && chunks.length > 1; i--) {
    if (chunks[i]!.length === 1) {
      if (i > 0) chunks[i - 1]!.push(...chunks[i]!);
      else chunks[1]!.unshift(...chunks[0]!);
      chunks.splice(i, 1);
    }
  }
  return chunks.map((c) => c.join(' '));
}
