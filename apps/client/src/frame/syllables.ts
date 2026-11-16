/**
 * Syllable split for the target sentence (docs/08 11장 읽기: "목표 문장 음절 구분 표시 옵션", G14 설정 `syllables`).
 * A reading aid, not a dictionary: vowel groups make the beats, one consonant between them starts the next beat
 * (ba·na·na), two or more split after the first (win·dow) unless they are a digraph (ch sh th ph wh ck ng qu),
 * a final silent "e" stays with the beat before it (have, please, choc·o·late), and consonant + "le" is its own beat
 * (ta·ble). Words of three letters or fewer stay whole. Punctuation and capitals are kept.
 */
export const SYLLABLE_MARK = '·';

const VOWEL = /[aeiouy]/;
const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'ck', 'ng', 'qu', 'gh']);

function isVowelAt(w: string, i: number): boolean {
  const c = w[i]!;
  if (c === 'y') return i > 0 && !VOWEL.test(w[i - 1]!); // y is a vowel after a consonant (ba·by), a consonant first (yes)
  if (c === 'u' && i > 0 && w[i - 1] === 'q') return false; // "qu" acts as one consonant
  return 'aeiou'.includes(c);
}

/** Split one lower-case word of letters into syllables. */
export function syllablesOf(word: string): string[] {
  const w = word.toLowerCase();
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return [word];
  // vowel groups
  const groups: Array<[number, number]> = [];
  for (let i = 0; i < w.length; i++) {
    if (!isVowelAt(w, i)) continue;
    const start = i;
    while (i + 1 < w.length && isVowelAt(w, i + 1)) i++;
    groups.push([start, i]);
  }
  // a final silent e: consonant + e at the end joins the beat before (not "le" after a consonant: ta·ble)
  const last = groups[groups.length - 1];
  if (groups.length > 1 && last && last[0] === w.length - 1 && w.endsWith('e')) {
    const consonantLe = w.endsWith('le') && w.length >= 3 && !isVowelAt(w, w.length - 3);
    if (!consonantLe) groups.pop();
  }
  // "-es"/"-ed" after a silent-e stem stays one beat in most words a child meets (likes, liked) unless t/d before -ed
  if (groups.length > 1) {
    const g = groups[groups.length - 1]!;
    if (g[0] === g[1] && g[0] === w.length - 2 && w[g[0]] === 'e' && (w.endsWith('es') || w.endsWith('ed'))) {
      const before = w[w.length - 3]!;
      const keep = w.endsWith('ed') ? before === 't' || before === 'd' : ['s', 'x', 'z', 'h', 'c', 'g'].includes(before);
      if (!keep) groups.pop();
    }
  }
  if (groups.length <= 1) return [word];
  const cuts: number[] = [];
  for (let k = 0; k + 1 < groups.length; k++) {
    const a = groups[k]![1] + 1; // first consonant after this vowel group
    const b = groups[k + 1]![0]; // next vowel group
    const n = b - a;
    let cut: number;
    if (n <= 1) cut = a; // V·CV
    else if (n === 2 && DIGRAPHS.has(w.slice(a, b))) cut = a; // keep the digraph with the next beat (ma·chine)
    else cut = a + 1; // VC·CV
    // consonant + le: the consonant opens the last beat (ta·ble, lit·tle)
    if (k + 1 === groups.length - 1 && w.endsWith('le') && b === w.length - 1) cut = Math.max(a, b - 2);
    cuts.push(cut);
  }
  const out: string[] = [];
  let p = 0;
  for (const c of cuts) {
    if (c <= p || c >= word.length) continue;
    out.push(word.slice(p, c));
    p = c;
  }
  out.push(word.slice(p));
  return out;
}

/** One token as shown (keeps leading/trailing punctuation): "cookie," -> "coo·kie,". */
export function syllabify(token: string): string {
  const m = /^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/.exec(token);
  if (!m) return token;
  return `${m[1]}${syllablesOf(m[2]!).join(SYLLABLE_MARK)}${m[3]}`;
}

/** A whole sentence, word by word. */
export function syllabifySentence(text: string): string {
  return text
    .split(/(\s+)/)
    .map((t) => (/^\s+$/.test(t) ? t : syllabify(t)))
    .join('');
}
