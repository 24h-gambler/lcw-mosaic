import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMON_WORDS_EN, NAME_LIKE_WORDS } from '@lcw/content';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { FAMILY_FAILS_PER_HOUR } from '../family.js';
import { maskNickname, pickQuotes, publicFacts, publicSafeText } from '../parent-report.js';
import { fakeDurableStorage } from './fake-do.js';

/**
 * docs/16 §1 "실명 없음": the report link can be forwarded, so nothing on it may name the child — whatever name the
 * child says out loud (not only the registered nickname), the school, or where they live.
 */

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}

describe('public text filter (quotes, expressions)', () => {
  const names = ['juno'];
  it.each([
    'My name is Jiwoo',
    'my name is jiwoo and I like cats',
    "I'm Jiwoo Kim and I like soccer",
    'i am minseo',
    'This is Juno\'s red helmet',
    'JUNO-KIM likes cars',
    'I go to Hannuri Elementary in Mapo',
    'I live in Seoul',
    'call me at home please',
    'I am nine years old',
    'my phone is 010-1234-5678',
    '꿀차 please',
    // A name at the start of the sentence (#131 review: the capital check skipped the first word).
    'Jiwoo, can I have a warm tea?',
    'Minseo likes cookies',
    'Hannuri is my favorite place',
    // Lowercase from the recognizer: the first-word check runs in any case (#131 review 2).
    'minji likes cookies',
    'seojun and I played soccer',
    // English names and given names that are also words.
    'Emma likes pizza',
    'Joy is my best friend',
    'Grace, can you help me?',
    // Someone being called: a word before the comma that is not a greeting or a family word.
    'Doyun, look at this',
    'Hannah, can I have a tea?'
  ])('blocks %s', (t) => {
    expect(publicSafeText(t, names)).toBe(false);
  });
  it.each([
    'Can I have a warm honey tea',
    'I want a jetpack so that I can fly to school',
    "I'm hungry so I want a sandwich",
    'I like playing soccer on Sunday',
    'I am happy because it is warm',
    'Hello, can I have a cookie?',
    'Thank you so much',
    "Let's trade my apple",
    'Here you are',
    'Warm milk please',
    'Okay, let me try',
    'Mom, can I have a cookie?'
  ])('allows %s', (t) => {
    expect(publicSafeText(t, names)).toBe(true);
  });

  // #131 review 1: a lesson-only starter list dropped 11 of 25 ordinary sentences, so a lesson without a script often
  // had nothing to quote. Everyday sentences a child says must reach the report.
  const ORDINARY = [
    'Yesterday I played soccer with my friends',
    'Okay let me try',
    'Pizza is my favorite food',
    'Dogs are cute',
    'Sometimes I eat ramen for lunch',
    'Tomorrow we go to the zoo',
    'My mom likes coffee',
    'Cats are so soft',
    'Today I am very happy',
    'After school I go to the park',
    'Last weekend we went to the beach',
    'Chocolate is very sweet',
    'Basketball is fun',
    'Ice cream is cold and yummy',
    'Every morning I eat cereal',
    'Before dinner I do my homework',
    'Lunch was delicious',
    'Red is my favorite color',
    'Elephants are big',
    'Can you help me please',
    'Do you like dinosaurs',
    'We played a game together',
    'They are my friends',
    'Snow is white and cold',
    'Maybe I want a cookie',
    'Wow that is so cool',
    'Sorry I am late',
    'Look at the big dog',
    'Grandma made kimchi for us',
    'Piano is hard but fun',
    'Summer is very hot',
    'Monkeys like bananas',
    'Usually I sleep at ten',
    'Strawberries are my favorite fruit',
    'Swimming is my favorite sport',
    'Teacher, can I go to the bathroom',
    'Breakfast was eggs and toast',
    'Penguins are so cute',
    'Taekwondo is so fun',
    'Never give up'
  ];
  it('keeps ordinary children\'s sentences (at most 1 in 40 over-blocked)', () => {
    const dropped = ORDINARY.filter((t) => !publicSafeText(t, names));
    expect(dropped.length, `dropped: ${dropped.join(' | ')}`).toBeLessThanOrEqual(1);
  });

  // #154 review: 9 of 15 new sentences were dropped (words not on the list); and a comma rule dropped the child's café
  // orders ('Water, please.'). Neither set was used to build the list.
  it.each([
    'Unicorns are my favorite',
    'Spaghetti is yummy',
    'Lego is fun to build',
    'Kimbap is my favorite lunch',
    'Jellyfish are so soft',
    'Octopus has eight legs',
    'Bubble tea please',
    'Water, please.',
    'Milk, please.',
    'Lemonade, please.',
    'Great, thank you',
    'Awesome, I did it',
    'Sounds like a great plan',
    'Tap the word cards',
    'Table lamp please'
  ])('allows %s', (t) => {
    expect(publicSafeText(t, names)).toBe(true);
  });

  it('names in our own content never become sentence starters (NPCs, voices)', () => {
    for (const n of ['Hannah', 'Luna', 'Mia', 'Toby', 'Athena', 'Hera', 'Apollo', 'Delia'])
      expect(publicSafeText(`${n} likes cookies`, names), n).toBe(false);
  });

  it('the everyday word list holds no given names and only plain lowercase words', () => {
    expect(COMMON_WORDS_EN.length).toBeGreaterThan(500);
    expect(COMMON_WORDS_EN.filter((w) => !/^[a-z]+$/.test(w))).toEqual([]);
    const listed = new Set(COMMON_WORDS_EN);
    expect(NAME_LIKE_WORDS.filter((w) => listed.has(w))).toEqual([]);
    // Romanised Korean given names children in our lessons have.
    for (const n of ['minji', 'jiwoo', 'seojun', 'doyun', 'hayun', 'yuna', 'juno', 'siwoo', 'jihoo', 'seoyeon', 'jimin', 'minho'])
      expect(listed.has(n), n).toBe(false);
  });

  it('pickQuotes skips self-introductions even when the name is not the nickname', () => {
    const row = (t: string, ctx: string, at: number) => ({
      final_text: t, stars: 3, mode: 'free', ctx, words: t.split(' ').length, dur_ms: 1000, confidence: 0.9, hint_level: 'none', created_at: at
    });
    const q = pickQuotes([row("I'm Jiwoo Kim and I like soccer", 'warmup', 1), row('I like drawing because it makes me happy', 'warmup', 2)], () => 'T', ['juno']);
    expect(q.map((x) => x.text)).toEqual(['I like drawing because it makes me happy']);
  });
});

describe('public facts are an allow-list', () => {
  it('keeps numbers, numbers-only progress and checked lesson texts; drops transcripts, notes and unknown keys', () => {
    const out = publicFacts(
      {
        free_utterances: 3,
        think_speak_index: null,
        notes: 'teacher note about Juno',
        player_id: 'kid-1',
        pin_windows: [{ lines: [{ text: 'my name is juno' }] }],
        progress: { student_ms: 1000, exchanges: 4, note: 'x', mode_breakdown: { free: 2, guided: 1 } },
        lesson: {
          utterances: 5,
          quotes: [{ text: 'Juno likes cars', stars: 2 }, { text: 'Can I have a warm honey tea', stars: 2, stage_title_ko: '카페 주문' }],
          expressions: ['so that', 'call me Juno'],
          // A lowercase name in a lesson target is filtered on the public path too (#131 review 2).
          home_practice: ['minji likes cookies', 'Can I have a warm honey tea, please?'],
          stages: [{ id: 'cafe_order', title_ko: '카페 주문', utterances: 2, passes: 1, transcript: 'x' }],
          raw: 'anything'
        }
      },
      ['Juno']
    ) as any;
    expect(Object.keys(out).sort()).toEqual(['free_utterances', 'lesson', 'progress', 'think_speak_index']);
    expect(out.progress).toEqual({ student_ms: 1000, exchanges: 4, mode_breakdown: { free: 2, guided: 1 } });
    expect(out.lesson.quotes.map((q: any) => q.text)).toEqual(['Can I have a warm honey tea']);
    expect(out.lesson.expressions).toEqual(['so that']);
    expect(out.lesson.home_practice).toEqual(['Can I have a warm honey tea, please?']);
    // A report stored before parentKo/parentMain: the plan's parent wording and its scene flag come back by stage id.
    expect(out.lesson.stages[0]).toEqual({ id: 'cafe_order', title_ko: '카페에서 음료 주문하기', main: true, utterances: 2, passes: 1 });
    expect(out.lesson.raw).toBeUndefined();
  });

  it('teacher text: the nickname becomes 아이', () => {
    expect(maskNickname('지우가 카페 주문을 끝까지 했어요. 지우는 다음에 because 를 써 봐요.', '지우')).toBe(
      '아이가 카페 주문을 끝까지 했어요. 아이는 다음에 because 를 써 봐요.'
    );
    expect(maskNickname('그대로', '')).toBe('그대로');
  });

  it('end to end: a lesson where the child says another real name, school and town leaks none of it', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'kid-x', nickname: '지우', birth_year: 2016, level: 'L1' });
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-x' });
    const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
    const st = { authorization: `Bearer ${j.body.student_token}`, 'content-type': 'application/json' };
    for (const t of ['my name is jiwoo kim and I like cats', "I'm Jiwoo and I like soccer", 'I go to Hannuri Elementary in Mapo', 'I like drawing because it makes me happy']) {
      await call(p, 'POST', '/v1/lesson/utterance', { transcript: t, dur_ms: 2000 }, st);
    }
    await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/pins`, { kind: 'expression', at_ms: 1, note: 'my name is jiwoo kim and I like cats' });
    const end = await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/end`, { teacher_comment: '지우가 오늘 처음으로 영어 주문을 했어요.' });
    const r = await call(p, 'GET', `/v1/reports/${end.body.share_token}`, undefined, {});
    const text = JSON.stringify(r.body).toLowerCase();
    for (const bad of ['jiwoo', 'hannuri', 'mapo', '지우', 'kid-x', 'my name']) expect(text).not.toContain(bad);
    expect(r.body.facts.lesson.quotes.map((q: any) => q.text)).toEqual(['I like drawing because it makes me happy']);
    expect(r.body.teacher_comment).toBe('아이가 오늘 처음으로 영어 주문을 했어요.');
  });
});

describe('access edges', () => {
  it('only the listed family/device routes are public (no prefix opening)', () => {
    expect(isPublicRoute('GET', '/v1/family/me')).toBe(true);
    expect(isPublicRoute('POST', '/v1/device/link')).toBe(true);
    expect(isPublicRoute('GET', '/v1/family/anything-new')).toBe(false);
    expect(isPublicRoute('POST', '/v1/device/admin')).toBe(false);
    expect(isPublicRoute('GET', '/v1/family/children')).toBe(false);
  });

  it('wrong codes from one client do not lock another client out', async () => {
    const p = platform();
    const a = { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.1' };
    const b = { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.2' };
    let last = 0;
    for (let i = 0; i <= FAMILY_FAILS_PER_HOUR; i++) last = (await call(p, 'POST', '/v1/device/link', { code: '000000' }, a)).status;
    expect(last).toBe(429);
    expect((await call(p, 'POST', '/v1/device/link', { code: '000000' }, b)).status).toBe(404);
  });

  it('opening a revoked or expired link does not count as the parent opening it', async () => {
    const p = platform();
    await call(p, 'POST', '/v1/admin/players', { family_id: 'f', guardian_id: 'g', player_id: 'kid-y', nickname: 'Momo' });
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-y' });
    const end = await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/end`, {});
    const token = end.body.share_token as string;
    p.sql.run('insert into report_revocations (share_token, revoked_at) values (?, ?)', [token, Date.now()]);
    expect((await call(p, 'GET', `/v1/reports/${token}`, undefined, {})).status).toBe(410);
    expect(p.sql.get<{ o: number | null }>('select opened_at as o from reports where share_token = ?', [token])!.o).toBeNull();
  });
});

describe('source hygiene', () => {
  it('no control characters in source files (a heredoc once turned \\b into a backspace and disabled a privacy filter)', () => {
    const roots = ['apps/edge/src', 'apps/web/src', 'packages'].map((r) => join(__dirname, '../../../..', r));
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const f = join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(e.name) && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(f, 'utf8'))) bad.push(f);
      }
    };
    roots.forEach(walk);
    expect(bad).toEqual([]);
  });
});
