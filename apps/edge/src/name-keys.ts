import { COMMON_WORDS_EN, FUNCTION_WORDS } from '@lcw/content';
import type { SqliteExecutor } from './storage.js';

/**
 * Every name tied to a child's report, as lowercase match keys for publicSafeText (any case, anywhere in the sentence,
 * on word edges — "hello doyun", "I play with Seoyeon", "doyun's bag"). Server only: the keys are never returned in a
 * response or written to a log (docs/16 §1 "실명 없음"). Over-blocking is the safe side: a nickname that is also an
 * everyday word ('Sun') blocks that word in this child's report.
 *
 * Sources: the child's nickname, every nickname in the same family (siblings), every child who has had a lesson or holds
 * a tutoring seat (the class); the names a guardian typed at sign-up (nickname and label), device
 * labels, the guardian's e-mail name part, and the lesson's teacher names. Korean nicknames also give their romanised
 * spellings (도윤 → doyun), since the child says them in English.
 */
export function reportNameKeys(sql: SqliteExecutor, playerId: string, lessonId?: string): string[] {
  const { direct, loose, teacher } = collectNames(sql, playerId, lessonId);
  const keys = new Set<string>();
  for (const s of direct) for (const k of keysOf(s, false)) keys.add(k);
  for (const s of [...loose, ...teacher]) for (const k of keysOf(s, true)) keys.add(k);
  return [...keys];
}

/**
 * Korean particles a name takes in a teacher's note, longest first. A note word is a name when it is a name exactly
 * after one of these comes off ('도윤이가' = 도윤 + 이가, '김도윤은' = 김도윤 + 은); '지우개' is not 지우 + anything.
 */
const KO_PARTICLES = [
  '이에게서', '이한테서', '이한테', '이에게', '이하고', '이처럼', '이까지', '이부터', '이에요', '이예요', '이랑', '이가', '이는',
  '이도', '이를', '이의', '이와', '이만', '이야', '이네', '한테서', '에게서', '한테', '에게', '하고', '처럼', '까지', '부터', '에요',
  '예요', '께서', '랑', '이', '가', '는', '은', '도', '를', '을', '의', '와', '과', '만', '야', '아', '네', '씨', '님', '께', ''
];
/**
 * What may follow a name in one Korean word, as up to four pieces: the particles, and the endings and titles a teacher
 * stacks on them ('도윤이한테도' 이한테+도, '서연이는요' 이는+요, '도윤이였어요' 이+였어요, '김도윤학생이' 학생+이, '서연이네서'
 * 이네+서). '지우개' is 지우 + 개, and 개 is none of these, so it stays.
 */
const KO_TITLES = new Set(['학생', '군', '양']);
const KO_TAIL = new Set([
  ...KO_PARTICLES.filter(Boolean),
  ...KO_TITLES,
  ...'요 서 에서 네서 로 으로 이로 라고 이라고 라는 이라는 였어요 였어 였다 였고 였는데 이었어요 이었다 이었고 이었는데 이였어요 이였다 이었어 이에요 예요 이야 이지 지 이죠 죠 이고 이며 이랑도 이랑은'.split(' ')
]);
const KO_TAIL_MAX = Math.max(...[...KO_TAIL].map((t) => t.length));

/** The tail of a word split into grammar pieces, the longest first piece first; null when it is not grammar. */
function tailPieces(tail: string, depth = 0): string[] | null {
  if (!tail) return [];
  if (depth >= 4) return null;
  for (let len = Math.min(KO_TAIL_MAX, tail.length); len >= 1; len--) {
    const head = tail.slice(0, len);
    if (!KO_TAIL.has(head)) continue;
    const rest = tailPieces(tail.slice(len), depth + 1);
    if (rest) return [head, ...rest];
  }
  return null;
}

/** Particles that only follow a person ('나은이랑', '하늘아'): needed before a name that is also a Korean word. */
const KO_PERSON_PARTICLES = new Set(
  KO_PARTICLES.filter((p) => p.startsWith('이') || ['랑', '한테', '한테서', '에게', '에게서', '하고', '야', '아', '네', '씨', '님', '께', '께서'].includes(p))
);
/** Names that are also everyday Korean words ('더 나은 문장', '하나 더'): masked only with a person particle. */
const KO_NAME_WORDS = new Set(
  (
    '나은 하나 나라 바다 하늘 사랑 보람 아름 이슬 가을 노을 구름 다솜 한결 소리 미소 별 봄 솔 새봄 나래 가람 슬기 다운 지혜 ' +
    '소망 기쁨 믿음 온유 한별 초롱 마루 누리 아라 단비 우리 다름 마음 가온 해솔 은하 이름 하루 여름 겨울 보배 새롬'
  ).split(' ')
);
/** Words in a device or sign-up label that are not a person ('거실 태블릿', '하린이 폰'). */
const KO_LABEL_WORDS = new Set(
  '거실 안방 방 집 학교 학원 태블릿 아이패드 패드 폰 핸드폰 휴대폰 노트북 컴퓨터 엄마 아빠 공부 공부용 놀이 기기 새 가족 아이'.split(' ')
);
const KO_SURNAMES = new Set(
  (
    '김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 류 유 홍 전 고 문 양 손 배 백 허 남 심 노 하 곽 성 차 주 우 구 민 진 ' +
    '나 지 엄 채 원 천 방 공 현 함 변 염 여 추 도 소 석 선 설 마 길 연 위 표 명 기 반 라 왕 금 옥 육 인 맹 제 모 탁 국 어 은 편 ' +
    '용 예 경 봉 사 부 황보 남궁 제갈 선우 독고 사공'
  ).split(' ')
);

/** '아이' ends in a vowel: the particle that followed a name ending in a consonant takes its vowel form. */
function particleAfterAi(p: string): string {
  if (p === '이') return '';
  if (p === '이에요' || p === '이예요' || p === '에요') return '예요';
  if (p.startsWith('이었')) return '였' + p.slice(2);
  if (p === '으로') return '로';
  if (p.startsWith('이') && p.length > 1) return p.slice(1);
  return ({ 은: '는', 을: '를', 과: '와', 아: '야' } as Record<string, string>)[p] ?? p;
}

/**
 * Masks every name tied to the child in free text that goes out on the public link (the teacher's comment, the next
 * lesson line). Word by word, never inside a word:
 * - a Korean word whose stem (after a particle) is a name — a Korean name, surname + given name ('김도윤'), or a
 *   registered English name written in Hangul ('민지', '조이') — becomes '아이' with the particle in its vowel form
 *   ('도윤이가' → '아이가'); a name that is also a Korean word ('나은') only with a person particle;
 * - English and romanised names on word edges in any case, one to four words ('Minji', 'Seo-yeon', 'SeoYeon').
 * Set lookups only: the cost does not grow with the number of names (a class of 240 took 1.6 s with one big pattern).
 */
export function reportNameMasker(sql: SqliteExecutor, playerId: string, lessonId?: string): (text: string) => string {
  const { direct, loose } = collectNames(sql, playerId, lessonId);
  const hangul = new Set<string>();
  const addKo = (w: string) => {
    if (w.length < 2) return;
    hangul.add(w);
    // A three-syllable name is surname + given name; the given name alone is how a friend calls the child.
    if (w.length >= 3 && KO_SURNAMES.has(w[0]!)) hangul.add(w.slice(1));
  };
  for (const s of direct) for (const w of s.split(/[^가-힣]+/)) addKo(w);
  for (const s of loose)
    for (const raw of s.split(/[^가-힣]+/)) {
      // A label is a few words; a 2–3 syllable word that is not a room or a device is a name ('하린이 태블릿' → 하린).
      const w = raw.length === 3 && raw.endsWith('이') ? raw.slice(0, 2) : raw;
      if (w.length >= 2 && w.length <= 3 && !KO_LABEL_WORDS.has(w) && !KO_LABEL_WORDS.has(raw)) addKo(w);
    }
  const latin = new Set([...direct.flatMap((s) => keysOf(s, false)), ...loose.flatMap((s) => keysOf(s, true))]);
  const latinOne = new Set([...latin].filter((k) => !k.includes(' ')));

  const isKoName = (stem: string, particle: string): boolean => {
    const personal = KO_PERSON_PARTICLES.has(particle) || KO_TITLES.has(particle) || particle.startsWith('이');
    const ok = (name: string) => !KO_NAME_WORDS.has(name) || personal;
    // '윌이랑' (Will), '선이한테' (Sun): a one-syllable stem is a name only before 이랑, 이한테, 이가 … (not the bare 이).
    if (KO_LABEL_WORDS.has(stem)) return false;
    if (stem.length === 1) return particle.length >= 2 && particle.startsWith('이') && romanise(stem, '', true).some((r) => latinOne.has(r));
    if (hangul.has(stem)) return ok(stem);
    for (const cut of [1, 2]) if (stem.length > cut + 1 && KO_SURNAMES.has(stem.slice(0, cut)) && hangul.has(stem.slice(cut))) return true;
    // A registered English name written in Hangul ('민지' for Minji, '조이' for Joy).
    if (stem.length >= 2 && stem.length <= 4 && ok(stem)) {
      const cands = [stem, ...(stem.length >= 3 && KO_SURNAMES.has(stem[0]!) ? [stem.slice(1)] : [])];
      for (const cand of cands) if (romanise(cand, '', true).some((r) => latinOne.has(r))) return true;
    }
    return false;
  };
  // A note repeats words ('했어요', '오늘'): each word is worked out once.
  const memo = new Map<string, string>();
  const maskKo = (word: string): string => {
    const hit = memo.get(word);
    if (hit !== undefined) return hit;
    const out = maskKoWord(word);
    memo.set(word, out);
    return out;
  };
  const maskKoWord = (word: string): string => {
    // The name is the front of the word and everything after it is grammar: the longest such name wins.
    for (let cut = word.length; cut >= 1; cut--) {
      const pieces = tailPieces(word.slice(cut));
      if (!pieces) continue;
      const first = pieces[0] ?? '';
      if (!isKoName(word.slice(0, cut), first)) continue;
      // '김도윤학생이' → '아이가': the title goes, and the particle after it (which followed a consonant) takes its vowel form.
      if (KO_TITLES.has(first)) {
        const next = pieces[1] ?? '';
        return '아이' + (next === '이' ? '가' : particleAfterAi(next)) + pieces.slice(2).join('');
      }
      return '아이' + particleAfterAi(first) + pieces.slice(1).join('');
    }
    return word;
  };
  const maskLatin = (text: string): string => {
    const toks = [...text.matchAll(/[A-Za-z0-9]+/g)];
    let out = '';
    let at = 0;
    for (let i = 0; i < toks.length; ) {
      let hit = 0;
      for (let len = Math.min(4, toks.length - i); len >= 1 && !hit; len--) {
        const span = toks.slice(i, i + len);
        // Words of one name sit next to each other ('Seo-yeon'; "Minji's" is Minji + s).
        const joined = span.every((t, j) => j === 0 || /^[\s'.-]*$/.test(text.slice(span[j - 1]!.index! + span[j - 1]![0].length, t.index!)));
        const ws = span.map((t) => t[0].toLowerCase());
        // 'Seo Yeon' / 'seo-yeon' for a child registered as Seoyeon: spaced or joined.
        if (joined && (latin.has(ws.join(' ')) || (len > 1 && latin.has(ws.join(''))))) hit = len;
      }
      if (hit) {
        const first = toks[i]!;
        const last = toks[i + hit - 1]!;
        out += text.slice(at, first.index!) + '아이';
        at = last.index! + last[0].length;
        i += hit;
      } else i++;
    }
    return out + text.slice(at);
  };
  return (text: string) => maskLatin(text.replace(/[가-힣]+/g, maskKo));
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
    // Siblings and the class: every child who has had a lesson or holds a tutoring seat (players.tutor_student is set by
    // no product code, so it only widens this). A lookup per name keeps the cost flat in the size of the class.
    ...col<{ nickname: string }>(
      `select nickname from players where family_id = ? or tutor_student = 1 or id in (select distinct player_id from lessons)
         or id in (select player_id from seats where plan = 'tutoring')`,
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
      // A room or a device in a label ('거실 태블릿') is not a name: its spellings would hide ordinary words.
      if (loose && (KO_LABEL_WORDS.has(hangul) || KO_LABEL_WORDS.has(hangul.replace(/이$/, '')))) continue;
      // Joined and spaced by syllable ('seoyeon', 'seo yeon'); a three-syllable name is surname + given name, and the
      // given name alone is how a friend calls the child. A label says '하린이 태블릿': that 하린이 is 하린.
      const parts = hangul.length >= 3 ? [hangul, hangul.slice(1)] : [hangul];
      if (loose && hangul.length === 3 && hangul.endsWith('이')) parts.push(hangul.slice(0, 2));
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
export function romanise(hangul: string, sep = '', loanword = false): string[] {
  let acc = [''];
  const chars = [...hangul];
  chars.forEach((ch, idx) => {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) return;
    const ini = INITIALS[Math.floor(c / 588)]!;
    const mi = Math.floor((c % 588) / 28);
    const med = MEDIALS[mi]!;
    const fin = FINALS[c % 28]!;
    const syl: string[] = [];
    // 아 with no final consonant is often written 'ah' (서아 → seoah).
    let meds = mi === 0 && c % 28 === 0 ? [...med, 'ah'] : med;
    let inis = ini;
    let fins = fin;
    // An English name written in Hangul ('조이' Joy, '그레이스' Grace, '윌' Will): a last 이 may be y, an open 으 is silent
    // or a silent e, 에이 is 'a' (레이 ra), ㅅ may be c (스 ce), ㅋ c, a final ㄹ ll.
    if (loanword) {
      const prev = idx > 0 ? chars[idx - 1]!.charCodeAt(0) - 0xac00 : -1;
      const prevOpenE = prev >= 0 && prev <= 11171 && prev % 28 === 0 && [1, 5].includes(Math.floor((prev % 588) / 28));
      if (c % 28 === 0) {
        if (mi === 20 && idx === chars.length - 1) meds = [...meds, 'y'];
        if (mi === 20 && Math.floor(c / 588) === 11 && prevOpenE) meds = [...meds, ''];
        if (mi === 18) meds = [...meds, '', 'e'];
        if (mi === 1 || mi === 5) meds = [...meds, 'a', 'e'];
      }
      const i0 = Math.floor(c / 588);
      if (i0 === 9) inis = [...ini, 'c'];
      if (i0 === 15) inis = [...ini, 'c'];
      if (c % 28 === 8) fins = [...fin, 'll'];
    }
    const meds2 = [...new Set(meds)];
    for (const i of inis) for (const m of meds2) for (const f of fins) syl.push(i + m + f);
    const next: string[] = [];
    const cap = loanword ? MAX_SPELLINGS * 8 : MAX_SPELLINGS;
    for (const a of acc) for (const s of syl) if (next.length < cap) next.push(a ? a + sep + s : s);
    acc = next;
  });
  return acc.filter(Boolean);
}
