import { COMMON_WORDS_EN, FUNCTION_WORDS } from '@lcw/content';
import type { SqliteExecutor } from './storage.js';

/**
 * Every name tied to a child's report, as lowercase match keys for publicSafeText (any case, anywhere in the sentence,
 * on word edges — "hello doyun", "I play with Seoyeon", "doyun's bag"). Server only: the keys are never returned in a
 * response or written to a log (docs/16 §1 "실명 없음"). Over-blocking is the safe side: a nickname that is also an
 * everyday word ('Sun') blocks that word in this child's report.
 *
 * Sources: the child's nickname, every nickname in the same family (siblings), every tutor student's nickname (the same
 * teacher's class), the names a guardian typed at sign-up (signup nickname and label), device labels, the guardian's
 * e-mail name part, and the lesson's teacher names. Korean nicknames also give their romanised spellings (도윤 →
 * doyun), since the child says them in English.
 */
export function reportNameKeys(sql: SqliteExecutor, playerId: string, lessonId?: string): string[] {
  const { direct, loose, teacher } = collectNames(sql, playerId, lessonId);
  const keys = new Set<string>();
  for (const s of direct) for (const k of keysOf(s, false)) keys.add(k);
  for (const s of [...loose, ...teacher]) for (const k of keysOf(s, true)) keys.add(k);
  return [...keys];
}

/**
 * Masks every name tied to the child in free text that goes out on the public link (the teacher's comment, the next
 * lesson line): Korean names as written ('지우가' → '아이가'), English names and romanised spellings on word edges in
 * any case ('Minji did well' → '아이 did well'). Longest names first, so '김지우' is not left as '김아이'.
 */
export function reportNameMasker(sql: SqliteExecutor, playerId: string, lessonId?: string): (text: string) => string {
  const { direct, loose } = collectNames(sql, playerId, lessonId);
  const hangul = new Set<string>();
  // Korean words only from names (a label's '거실' is a room, not a person).
  for (const s of direct)
    for (const w of s.split(/[^가-힣]+/)) {
      if (w.length >= 2) hangul.add(w);
      if (w.length >= 3) hangul.add(w.slice(1));
    }
  const latin = new Set([...direct.flatMap((s) => keysOf(s, false)), ...loose.flatMap((s) => keysOf(s, true))]);
  const hangulList = [...hangul].sort((a, b) => b.length - a.length);
  // One pattern for all keys (thousands of them for a big class), longest first; keys are [a-z0-9 ] only.
  const alts = [...latin]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.split(' ').join('[^A-Za-z0-9가-힣]+'));
  const latinRe = alts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${alts.join('|')})(?![A-Za-z0-9])`, 'gi') : null;
  return (text: string) => {
    let t = text;
    for (const n of hangulList) t = t.split(n).join('아이');
    return latinRe ? t.replace(latinRe, '아이') : t;
  };
}

/**
 * The raw names: `direct` are names (nicknames), `loose` are texts that may hold a name among ordinary words, `teacher`
 * the teachers' names (kept out of the child's quotes, but not masked in the teacher's own comment).
 */
function collectNames(sql: SqliteExecutor, playerId: string, lessonId?: string): { direct: string[]; loose: string[]; teacher: string[] } {
  const child = sql.get<{ family_id: string; nickname: string }>('select family_id, nickname from players where id = ?', [playerId]);
  const fam = child?.family_id ?? '';
  const direct: string[] = [child?.nickname ?? ''];
  const loose: string[] = [];
  // A table missing in an older database holds no names: that source adds nothing.
  const col = <T extends Record<string, unknown>>(q: string, p: unknown[], k: keyof T): string[] => {
    try {
      return sql.all<T>(q, p).map((r) => String(r[k] ?? ''));
    } catch {
      return [];
    }
  };

  direct.push(
    ...col<{ nickname: string }>(
      `select nickname from players where family_id = ? or tutor_student = 1 or id in (select distinct player_id from lessons)`,
      [fam],
      'nickname'
    ),
    ...col<{ nickname: string }>('select nickname from student_signups where family_id = ? or player_id = ?', [fam, playerId], 'nickname')
  );
  loose.push(
    ...col<{ label: string }>('select label from student_signups where family_id = ? or player_id = ?', [fam, playerId], 'label'),
    ...col<{ label: string }>('select label from devices where family_id = ? or player_id = ?', [fam, playerId], 'label'),
    ...col<{ email: string }>(
      `select email from oauth_identities where role = 'guardian' and subject_id in (select id from guardians where family_id = ?)`,
      [fam],
      'email'
    ).map((e) => e.split('@')[0] ?? '')
  );
  const teacher = col<{ name: string }>('select name from operators', [], 'name');
  if (lessonId) {
    teacher.push(
      ...col<{ name: string }>('select name from lesson_teacher where lesson_id = ?', [lessonId], 'name'),
      ...col<{ account_name: string }>('select account_name from lesson_teacher where lesson_id = ?', [lessonId], 'account_name')
    );
  }
  const keep = (xs: string[]) => xs.filter((x) => x.trim());
  return { direct: keep(direct), loose: keep(loose), teacher: keep(teacher) };
}

/** Lowercase words only, the same as parent-report norm(): "Juno's" → "juno s", "JUNO-KIM" → "juno kim". */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const ORDINARY = new Set([...COMMON_WORDS_EN, ...FUNCTION_WORDS].map((w) => w.toLowerCase().replace(/'/g, '')));

/**
 * Keys of one name: the whole name, each word of it, and the romanised spellings of Korean words. `loose` sources
 * (labels, e-mail names, teacher names) hold ordinary words too ("Living room tablet"): those keep only words that are
 * not everyday English and at least 3 letters.
 */
function keysOf(name: string, loose: boolean): string[] {
  const out: string[] = [];
  // Split on spaces and punctuation, so "Hope's iPad" gives 'hope' (and 's' falls out by length).
  const words = name.trim().split(/[^A-Za-z0-9가-힣]+/).filter(Boolean);
  const add = (k: string) => {
    const n = norm(k);
    if (n.length < 2) return;
    if (loose && (n.length < 3 || n.split(' ').every((w) => ORDINARY.has(w)))) return;
    out.push(n);
  };
  if (!loose) add(name);
  for (const w of words) {
    if (/[가-힣]/.test(w)) {
      const hangul = w.replace(/[^가-힣]/g, '');
      // Joined and spaced by syllable ('seoyeon', 'seo yeon'); a three-syllable name is surname + given name, and the
      // given name alone is how a friend calls the child.
      const parts = hangul.length >= 3 ? [hangul, hangul.slice(1)] : [hangul];
      for (const h of parts) for (const sep of ['', ' ']) for (const r of romanise(h, sep)) add(r);
    } else add(w);
  }
  return out;
}

// Revised Romanisation plus the spellings families use (우 woo, 유 yoo, 이 ee, ㅓ u: 정 jung, ㅅ sh: 신 shin).
const INITIALS = [['g', 'k'], ['kk'], ['n'], ['d', 't'], ['tt'], ['r', 'l'], ['m'], ['b', 'p'], ['pp'], ['s', 'sh'], ['ss'], [''], ['j'], ['jj'], ['ch'], ['k'], ['t'], ['p'], ['h']];
const MEDIALS = [['a'], ['ae'], ['ya'], ['yae'], ['eo', 'u', 'uh'], ['e'], ['yeo', 'yu', 'you'], ['ye'], ['o'], ['wa'], ['wae'], ['oe', 'we'], ['yo'], ['u', 'oo', 'woo'], ['wo'], ['we'], ['wi'], ['yu', 'yoo'], ['eu'], ['ui', 'ee', 'i'], ['i', 'ee']];
const FINALS = [[''], ['k', 'g'], ['k'], ['k'], ['n'], ['n'], ['n'], ['t'], ['l', 'r'], ['k'], ['m'], ['l'], ['l'], ['l'], ['p'], ['l'], ['m'], ['p', 'b'], ['p'], ['t'], ['t'], ['ng'], ['t'], ['t'], ['k'], ['t'], ['p'], ['t']];
const MAX_SPELLINGS = 256;

/** Romanised spellings of a Hangul word, at most MAX_SPELLINGS (the most usual first). */
export function romanise(hangul: string, sep = ''): string[] {
  let acc = [''];
  for (const ch of hangul) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) continue;
    const ini = INITIALS[Math.floor(c / 588)]!;
    const med = MEDIALS[Math.floor((c % 588) / 28)]!;
    const fin = FINALS[c % 28]!;
    const syl: string[] = [];
    // 아 with no final consonant is often written 'ah' (서아 → seoah).
    const meds = Math.floor((c % 588) / 28) === 0 && c % 28 === 0 ? [...med, 'ah'] : med;
    for (const i of ini) for (const m of meds) for (const f of fin) syl.push(i + m + f);
    const next: string[] = [];
    for (const a of acc) for (const s of syl) if (next.length < MAX_SPELLINGS) next.push(a ? a + sep + s : s);
    acc = next;
  }
  return acc.filter(Boolean);
}
