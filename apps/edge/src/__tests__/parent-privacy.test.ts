import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    'Hannuri is my favorite place'
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
    'Warm milk please'
  ])('allows %s', (t) => {
    expect(publicSafeText(t, names)).toBe(true);
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
