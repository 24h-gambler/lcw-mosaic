import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, workerHandler, type LcwEnv } from '../platform.js';
import { FAMILY_FAILS_PER_HOUR } from '../family.js';
import { REPORT_SHARE_TTL_MS, lessonSummaryKo, pickQuotes, tidyQuote } from '../parent-report.js';
import { REPORT_SHARE_META_KO, rewriteReportShell } from '../report-page.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

function platform() {
  return new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

async function seedKid(p: PlatformDO, id = 'kid-1', family = 'fam-kim', guardian = 'g-kim') {
  await call(p, 'POST', '/v1/admin/players', { family_id: family, guardian_id: guardian, player_id: id, nickname: 'Juno', birth_year: 2016, level: 'L1' });
}

/** One lesson through the real routes: utterances in three stages + pins, then end. */
async function runLesson(p: PlatformDO) {
  await seedKid(p);
  const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
  const j = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
  const st = bearer(j.body.student_token);
  const lessonId = s.body.lesson_id as string;
  const say = (body: Record<string, unknown>) => call(p, 'POST', '/v1/lesson/utterance', body, st);
  // warmup (free)
  await say({ transcript: 'i like playing soccer with my dad on sunday', dur_ms: 4200 });
  await say({ transcript: 'my name is juno and i am nine years old', dur_ms: 0 }); // names the child → never quoted
  await say({ transcript: 'juno loves big red fire trucks and cars', dur_ms: 0 }); // nickname inside → never quoted
  await say({ transcript: 'hi', dur_ms: 600 }); // too short → not passed
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'cafe_order', targets: ['Can I have a warm honey tea?'] });
  await say({ target_text: 'Can I have a warm honey tea?', transcript: 'can i have a warm honey tea', chosen_stars: 2, dur_ms: 2500 });
  await say({ target_text: 'Can I have a warm honey tea?', transcript: 'can I have a warm honey tea', chosen_stars: 1, dur_ms: 2400 }); // duplicate sentence
  await say({ target_text: 'Can I have a warm honey tea?', transcript: 'banana', chosen_stars: 1, dur_ms: 900 });
  await say({ target_text: 'Can I have a warm honey tea?', transcript: '꿀차 주세요 please', chosen_stars: 1, dur_ms: 1500 });
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/stage`, { stage_id: 'open_question', targets: [] });
  await say({ transcript: 'I want a jetpack so that I can fly to school', dur_ms: 3900 });
  await say({ transcript: 'my phone is 010-1234-5678 call me', dur_ms: 2000 }); // PII → never quoted
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 1000, note: 'so that' });
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 2000, note: 'So that' });
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 3000, note: '천천히' });
  // fragments teachers type (main c851190 report showed "Can I have", "for your" as chips)
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 3500, note: 'Can I have' });
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 3600, note: 'for your' });
  // a fragment that only the phone line contains must not pull that line into the public page
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 3700, note: 'call me' });
  // the teacher's own remark is not the child's expression
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'expression', at_ms: 3800, note: 'nice pronunciation' });
  await call(p, 'POST', `/v1/admin/lessons/${lessonId}/pins`, { kind: 'coaching', at_ms: 4000, note: '' });
  const end = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, { teacher_comment: '카페 주문을 끝까지 영어로 했습니다.', next_lesson_at: '11월 19일 수요일 17:30' });
  expect(end.status).toBe(200);
  return { lessonId, token: end.body.share_token as string, end };
}

afterEach(() => vi.useRealTimers());

describe('lesson report facts for parents (WP-308, docs/07 §5)', () => {
  it('report carries this lesson only: quotes, speaking time, stages, expressions; numbers match the summary', async () => {
    const p = platform();
    const { token } = await runLesson(p);
    const r = await call(p, 'GET', `/v1/reports/${token}`, undefined, {});
    expect(r.status).toBe(200);
    const L = r.body.facts.lesson;
    expect(L.utterances).toBe(10);
    expect(L.passes).toBe(7); // two self-intro lines, soccer, honey tea ×2, jetpack, phone line (free talk passes by length)
    expect(L.speaking_sec).toBe(18); // 4.2+0.6+2.5+2.4+0.9+1.5+3.9+2.0 = 18.0 s
    // Three different sentences, in lesson order, none Korean, none with PII, duplicate collapsed
    expect(L.quotes.map((q: any) => q.text)).toEqual([
      'I like playing soccer with my dad on sunday',
      'Can I have a warm honey tea',
      'I want a jetpack so that I can fly to school'
    ]);
    expect(L.quotes.every((q: any) => q.stage_title_ko.length > 0)).toBe(true);
    // whole units a parent understands: fragments grow to the child's own clause/sentence, "for your" (nothing said it) drops
    expect(L.expressions).toEqual(['so that I can fly to school', 'Can I have a warm honey tea?']);
    expect(L.coaching_moments).toBe(1);
    expect(L.stages.map((s: any) => s.id)).toEqual(['warmup_anchor', 'cafe_order', 'open_question']);
    expect(L.stages.map((s: any) => s.title_ko)).toEqual(['인사와 고정 과제', '카페 주문', '열린 질문']);
    expect(L.lesson_number).toBe(1);
    expect(L.summary_ko).toBe(lessonSummaryKo(L));
    for (const n of L.summary_ko.match(/\d+/g) ?? []) {
      expect([L.utterances, L.passes, Math.floor(L.speaking_sec / 60), L.speaking_sec % 60, L.speaking_sec, L.free_words].map(String)).toContain(n);
    }
    // The summary sentence is this lesson's, in the units the page shows, and carries only fact numbers
    expect(r.body.body).toBe(L.summary_ko);
    expect(r.body.body).not.toContain('이번 주');
    expect(r.body.body).toContain('18초');
    expect(lessonSummaryKo({ utterances: 3, passes: 2, speaking_sec: 2, free_words: 0 })).toContain('2초');
    expect(lessonSummaryKo({ utterances: 3, passes: 2, speaking_sec: 125, free_words: 0 })).toContain('2분 5초');
    expect(lessonSummaryKo({ utterances: 3, passes: 2, speaking_sec: 125, free_words: 0 })).not.toContain('0분');
    expect(r.body.teacher_comment).toBe('카페 주문을 끝까지 영어로 했습니다.');
    expect(r.body.next_lesson_at).toBe('11월 19일 수요일 17:30');
    expect(r.body.expires_at - r.body.created_at).toBe(REPORT_SHARE_TTL_MS);
  });

  it('public report never carries ids or the child name, and is private/no-referrer/noindex', async () => {
    const p = platform();
    const { token } = await runLesson(p);
    const r = await call(p, 'GET', `/v1/reports/${token}`, undefined, {});
    const s = JSON.stringify(r.body);
    for (const bad of ['kid-1', 'g-kim', 'fam-kim', 'Juno', 'player_id', 'guardian_id', 'nickname']) expect(s).not.toContain(bad);
    expect(Object.keys(r.body).sort()).toEqual(
      ['body', 'clips', 'created_at', 'expires_at', 'facts', 'kind', 'next_lesson_at', 'ref_id', 'teacher_comment'].sort()
    );
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('teacher preview (operator token) does not count as the parent opening the report', async () => {
    const p = platform();
    const { token } = await runLesson(p);
    const opened = () => p.sql.get<{ r: number | null; d: number | null; s: string }>(
      'select r.opened_at as r, d.opened_at as d, d.status as s from reports r join report_deliveries d on d.share_token = r.share_token where r.share_token = ?',
      [token]
    )!;
    const pv = await call(p, 'GET', `/v1/reports/${token}?preview=1`, undefined, op);
    expect(pv.status).toBe(200);
    expect(pv.body.teacher_comment).toBe('카페 주문을 끝까지 영어로 했습니다.');
    expect(opened()).toEqual({ r: null, d: null, s: 'sent' });
    // ?preview=1 without the operator token is just a parent open
    await call(p, 'GET', `/v1/reports/${token}?preview=1`, undefined, {});
    expect(opened().r).not.toBeNull();
    expect(opened().s).toBe('opened');
  });

  it('share link dies after 30 days and when the guardian revokes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
    const p = platform();
    const { token } = await runLesson(p);
    vi.setSystemTime(new Date(Date.now() + REPORT_SHARE_TTL_MS - 60_000));
    expect((await call(p, 'GET', `/v1/reports/${token}`, undefined, {})).status).toBe(200);
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect((await call(p, 'GET', `/v1/reports/${token}`, undefined, {})).body.error).toBe('report_expired');

    vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
    const g = await guardianSession(p, 'kid-1');
    expect((await call(p, 'POST', `/v1/family/reports/${token}/revoke`, {}, bearer(g))).status).toBe(200);
    const after = await call(p, 'GET', `/v1/reports/${token}`, undefined, {});
    expect(after.status).toBe(410);
    expect(after.body.error).toBe('report_revoked');
  });

  it('never quotes a sentence carrying the child name or a self-introduction', async () => {
    const p = platform();
    const { token } = await runLesson(p);
    const r = await call(p, 'GET', `/v1/reports/${token}`, undefined, {});
    const s = JSON.stringify(r.body).toLowerCase();
    expect(s).not.toContain('juno');
    expect(s).not.toContain('my name is');
  });

  it('quote picking: per-stage best first, dedupe, tidy casing only', () => {
    const row = (t: string, stars: number, ctx: string, at: number, mode = 'guided') => ({
      final_text: t, stars, mode, ctx, words: t.split(' ').length, dur_ms: 1000, confidence: 0.9, hint_level: 'full', created_at: at
    });
    const q = pickQuotes(
      [row('a b c d e f g h', 3, 'x', 1), row('a b c d e f g h!', 3, 'x', 2), row('one two', 1, 'y', 3), row('zz top go', 2, 'x', 4), row('low conf here', 3, 'z', 5)].map((r, i) =>
        i === 4 ? { ...r, confidence: 0.3 } : r
      ),
      () => 'T'
    );
    expect(q.map((x) => x.text)).toEqual(['A b c d e f g h', 'One two', 'Zz top go']);
    expect(tidyQuote(" i think i'm ok ")).toBe("I think I'm ok");
  });
});

async function guardianSession(p: PlatformDO, playerId: string): Promise<string> {
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  expect(inv.status).toBe(201);
  expect(inv.body.invite_path).toMatch(/^\/family#k=[0-9a-f]{48}$/);
  const k = inv.body.invite_path.split('#k=')[1];
  const s = await call(p, 'POST', '/v1/family/session', { invite: k }, anon);
  expect(s.status).toBe(200);
  return s.body.guardian_token as string;
}

describe('family account, consents, device link (WP-301, docs/16 §3)', () => {
  it('invite → session (one-time) → service consent gate → separate consent toggles', async () => {
    const p = platform();
    await seedKid(p);
    const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-1' });
    const k = inv.body.invite_path.split('#k=')[1];
    expect((await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'kid-1' }, anon)).status).toBe(401);
    const s1 = await call(p, 'POST', '/v1/family/session', { invite: k }, anon);
    expect(s1.status).toBe(200);
    expect((await call(p, 'POST', '/v1/family/session', { invite: k }, anon)).status).toBe(404); // one-time
    const g = bearer(s1.body.guardian_token);

    const me0 = await call(p, 'GET', '/v1/family/me', undefined, g);
    expect(me0.body.service_consented).toBe(false);
    expect(me0.body.children).toHaveLength(1);
    expect(me0.body.children[0].consents).toEqual({
      voice_store: false, lesson_window: false, showroom_public: false, public_server: false, friend_voice: false
    });
    expect((await call(p, 'PUT', '/v1/family/children/kid-1/consents/voice_store', { granted: true }, g)).body.error).toBe('service_consent_required');
    expect((await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g)).status).toBe(200);
    expect((await call(p, 'GET', '/v1/family/me', undefined, g)).body.service_consented).toBe(true);

    const on = await call(p, 'PUT', '/v1/family/children/kid-1/consents/lesson_window', { granted: true }, g);
    expect(on.body).toEqual({ scope: 'lesson_window', active: true });
    const me1 = await call(p, 'GET', '/v1/family/me', undefined, g);
    expect(me1.body.children[0].consents).toMatchObject({ lesson_window: true, voice_store: false });
    expect((await call(p, 'PUT', '/v1/family/children/kid-1/consents/everything', { granted: true }, g)).status).toBe(400);
    expect((await call(p, 'PUT', '/v1/family/children/kid-1/consents/voice_store', { granted: 'yes' }, g)).status).toBe(400);
    const log = p.sql.all<{ scope: string; granted: number }>('select scope, granted from consent_log order by id');
    expect(log.map((l) => `${l.scope}:${l.granted}`)).toEqual(['service:1', 'lesson_window:1']);

    expect((await call(p, 'POST', '/v1/family/logout', {}, g)).status).toBe(200);
    expect((await call(p, 'GET', '/v1/family/me', undefined, g)).status).toBe(401);
  });

  it('voice is stored only while voice_store is on, and revoking strips it (AGENTS 4.5)', async () => {
    const p = platform();
    await seedKid(p);
    const g = bearer(await guardianSession(p, 'kid-1'));
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    const utt = (id: string) => ({
      id, player_id: 'kid-1', world_id: 'w', session_id: 's', session_kind: 'solo' as const, ctx: 'cafe', mode: 'free' as const,
      interlocutor: 'npc' as const, first_text: 'hello there', target_text: '', final_text: 'hello there', words: 2, l1_words: 0,
      dur_ms: 1000, latency_ms: 500, stars: 1, hint_level: 'none' as const, attempts: 1, score: 1, confidence: 1, source: 't',
      audio_first: `audio/${id}`, audio_final: `audio/${id}`, created_at: 1
    });
    expect(p.db.logUtterance(utt('u1')).storedAudio).toBe(false);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/voice_store', { granted: true }, g);
    expect(p.db.logUtterance(utt('u2')).storedAudio).toBe(true);
    await call(p, 'PUT', '/v1/family/children/kid-1/consents/voice_store', { granted: false }, g);
    const left = p.sql.all<{ n: number }>('select count(*) as n from utterances where audio_first is not null or audio_final is not null');
    expect(left[0]!.n).toBe(0);
  });

  it('guardian creates a child profile and links a device with a one-time 6-digit code', async () => {
    const p = platform();
    await seedKid(p);
    const g = bearer(await guardianSession(p, 'kid-1'));
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    expect((await call(p, 'POST', '/v1/family/children', { nickname: '010-1234-5678', birth_year: 2017 }, g)).status).toBe(422);
    const kid = await call(p, 'POST', '/v1/family/children', { nickname: 'Sora', birth_year: 2017 }, g);
    expect(kid.status).toBe(201);
    const pid = kid.body.player_id as string;
    expect(p.db.hasActiveConsent(pid, 'service')).toBe(true);

    const code = await call(p, 'POST', `/v1/family/children/${pid}/device-code`, {}, g);
    expect(code.body.code).toMatch(/^\d{6}$/);
    const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: '거실 태블릿' }, anon);
    expect(link.status).toBe(200);
    expect(link.body.nickname).toBe('Sora');
    expect(JSON.stringify(link.body)).not.toContain(pid);
    expect((await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon)).status).toBe(404); // one-time
    const dev = bearer(link.body.device_token);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).body).toMatchObject({ nickname: 'Sora', voice_store: false });

    const me = await call(p, 'GET', '/v1/family/me', undefined, g);
    const sora = me.body.children.find((c: any) => c.player_id === pid);
    expect(sora.devices).toHaveLength(1);
    expect(sora.devices[0].label).toBe('거실 태블릿');
    expect((await call(p, 'DELETE', `/v1/family/devices/${sora.devices[0].id}`, undefined, g)).status).toBe(200);
    expect((await call(p, 'GET', '/v1/device/me', undefined, dev)).status).toBe(401);
  });

  it('a guardian cannot touch another family; wrong codes are rate-limited', async () => {
    const p = platform();
    await seedKid(p, 'kid-1', 'fam-kim', 'g-kim');
    await seedKid(p, 'kid-2', 'fam-lee', 'g-lee');
    const g = bearer(await guardianSession(p, 'kid-1'));
    await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
    expect((await call(p, 'PUT', '/v1/family/children/kid-2/consents/voice_store', { granted: true }, g)).status).toBe(404);
    expect((await call(p, 'POST', '/v1/family/children/kid-2/device-code', {}, g)).status).toBe(404);
    expect((await call(p, 'GET', '/v1/family/me', undefined, g)).body.children.map((c: any) => c.player_id)).toEqual(['kid-1']);
    expect((await call(p, 'GET', '/v1/family/me', undefined, anon)).status).toBe(401);
    expect((await call(p, 'GET', '/v1/family/me', undefined, op)).status).toBe(401); // operator token is not a guardian
    let last = 0;
    for (let i = 0; i <= FAMILY_FAILS_PER_HOUR; i++) last = (await call(p, 'POST', '/v1/device/link', { code: '000000' }, anon)).status;
    expect(last).toBe(429);
    let lastInv = 0;
    for (let i = 0; i <= FAMILY_FAILS_PER_HOUR; i++) lastInv = (await call(p, 'POST', '/v1/family/session', { invite: 'a'.repeat(48) }, anon)).status;
    expect(lastInv).toBe(429);
  });

  it('guardian sees lesson reports in the family space and can revoke only their own', async () => {
    const p = platform();
    const { token } = await runLesson(p);
    await seedKid(p, 'kid-2', 'fam-lee', 'g-lee');
    const other = bearer(await guardianSession(p, 'kid-2'));
    expect((await call(p, 'POST', `/v1/family/reports/${token}/revoke`, {}, other)).status).toBe(404);
    const g = bearer(await guardianSession(p, 'kid-1'));
    const me = await call(p, 'GET', '/v1/family/me', undefined, g);
    expect(me.body.children[0].reports).toHaveLength(1);
    expect(me.body.children[0].reports[0]).toMatchObject({ share_path: `/r/${token}`, expired: false, revoked: false });
  });
});

describe('/r/<token> HTML shell (KakaoTalk preview)', () => {
  const shell = '<!doctype html><html lang="ko"><head><meta charset="UTF-8" /><title>LCW — 사이트</title><meta property="og:title" content="사이트" /><meta name="description" content="x" /></head><body><div id="root"></div></body></html>';

  it('swaps the site tags for name-free report tags with noindex/no-referrer', () => {
    const html = rewriteReportShell(shell, 'https://lcw.example');
    expect(html).toContain(`<title>${REPORT_SHARE_META_KO.title}</title>`);
    expect(html).toContain('property="og:image" content="https://lcw.example/og-report.png"');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).not.toContain('LCW — 사이트');
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(html).not.toMatch(/og:url/);
  });

  it('worker serves /r/* through the shell rewrite with private headers', async () => {
    const hits: string[] = [];
    const env = {
      PLATFORM: undefined as never,
      ASSETS: { fetch: async (r: Request) => { hits.push(new URL(r.url).pathname); return new Response(shell, { headers: { 'content-type': 'text/html' } }); } }
    } as LcwEnv;
    const res = await workerHandler.fetch(new Request('https://lcw.example/r/abcdef0123456789abcdef0123456789'), env);
    expect(hits).toEqual(['/']);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain(REPORT_SHARE_META_KO.title);
    expect(html).not.toContain('abcdef0123456789');
  });
});
