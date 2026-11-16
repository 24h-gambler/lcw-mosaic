import { describe, expect, it } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import { SIGNUP_PENDING_TTL_MS, maskIdentity, nicknameKey } from '../student-account.js';
import { DEVICE_TOKEN_TTL_MS } from '../family.js';
import { LINKED_DEVICE_TTL_MS } from '../lesson-mode.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const platform = () => new PlatformDO({ storage: fakeDurableStorage() }, { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN } as LcwEnv);
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any };
}

/** A teacher-made row (no guardian of its own), as Oreo stu-29ddc960 in production. */
async function teacherRow(p: PlatformDO, id = 'stu-29ddc960', nickname = 'Oreo') {
  expect((await call(p, 'POST', '/v1/admin/players', { family_id: `fam-${id}`, guardian_id: `g-${id}`, player_id: id, nickname, level: 'L1' })).status).toBe(201);
}
/**
 * The adult signing in on the student device. Stand-in for the guardian lane's OAuth (same guardian_sessions token):
 * a fresh family with one guardian, signed in through the invite exchange.
 */
async function adultSignsIn(p: PlatformDO, fam: string, consent = true) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: `seed-${fam}`, nickname: 'seed' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: `seed-${fam}` });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = s.body.guardian_token as string;
  if (consent) {
    expect((await call(p, 'POST', '/v1/student/attest', { who: 'guardian_19' }, bearer(g))).status).toBe(200);
    expect((await call(p, 'POST', '/v1/family/service-consent', { granted: true }, bearer(g))).status).toBe(200);
  }
  return g;
}
const tokenHash = async (t: string) =>
  Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).toString('hex');
const playerOfDevice = async (p: PlatformDO, token: string) =>
  p.sql.get<{ player_id: string }>('select player_id from devices where token_hash = ?', [await tokenHash(token)])?.player_id;

describe('student sign-up on the guardian account (student-account.ts)', () => {
  it('adult signs in → consent → nickname → pending in the console → linked to the teacher-made Oreo row → device continues as Oreo', async () => {
    const p = platform();
    await teacherRow(p);
    const g = await adultSignsIn(p, 'fam-oauth-1');
    const sign = await call(p, 'POST', '/v1/student/signup', { nickname: '오레오', label: '수업 PC' }, bearer(g));
    expect(sign.status).toBe(201);
    expect(sign.body).toMatchObject({ state: 'pending' });
    const claim = sign.body.claim_token as string;
    expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(claim))).body).toEqual({ state: 'pending' });
    const list = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      nickname: '오레오',
      signer: { provider: 'invite', hint: '', attest: 'guardian_19' },
      family_students: [{ player_id: 'seed-fam-oauth-1', nickname: 'seed', linked_devices: 0 }]
    });
    expect(sign.body.check).toMatch(/^\d{4}$/);
    // The console never lists the 4 digits; a wrong number is refused, the student screen's number approves.
    expect(JSON.stringify(list[0])).not.toContain(sign.body.check);
    const wrong = String((Number(sign.body.check) + 1) % 10000).padStart(4, '0');
    expect((await call(p, 'POST', `/v1/admin/student-signups/${list[0].id}/approve`, { player_id: 'stu-29ddc960', check: wrong })).body).toEqual({
      error: 'check_mismatch'
    });
    expect((await call(p, 'POST', `/v1/admin/student-signups/${list[0].id}/approve`, { player_id: 'stu-29ddc960' })).status).toBe(400);
    const ok = await call(p, 'POST', `/v1/admin/student-signups/${list[0].id}/approve`, { player_id: 'stu-29ddc960', check: sign.body.check });
    expect(ok.body).toEqual({ ok: true, player_id: 'stu-29ddc960', nickname: 'Oreo' });
    // The teacher-made row joined the signing family, with the service consent; the same player_id.
    expect(p.sql.get('select family_id from players where id = ?', ['stu-29ddc960'])).toEqual({ family_id: 'fam-oauth-1' });
    expect(p.db.hasActiveConsent('stu-29ddc960', 'service')).toBe(true);
    expect(p.sql.all('select nickname from student_signups')).toEqual([{ nickname: '' }]);
    // Device A collects its token once.
    const a = await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(claim));
    expect(a.body).toMatchObject({ state: 'approved', nickname: 'Oreo', level: 'L1' });
    expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(claim))).body).toEqual({ state: 'approved', already_claimed: true });
    expect(await playerOfDevice(p, a.body.device_token)).toBe('stu-29ddc960');
    expect((await call(p, 'GET', '/v1/device/me', undefined, bearer(a.body.device_token))).body).toMatchObject({ nickname: 'Oreo' });
    // Device B: the same adult signs in there and links it through the guardian's own device code.
    const me = await call(p, 'GET', '/v1/family/me', undefined, bearer(g));
    expect(me.body.children.map((k: any) => k.player_id)).toContain('stu-29ddc960');
    const code = await call(p, 'POST', '/v1/family/children/stu-29ddc960/device-code', {}, bearer(g));
    const b = await call(p, 'POST', '/v1/device/link', { code: code.body.code, label: '집 태블릿' }, anon);
    expect(await playerOfDevice(p, b.body.device_token)).toBe('stu-29ddc960');
    // Or the teacher makes the code for a consented student.
    const tcode = await call(p, 'POST', '/v1/admin/students/stu-29ddc960/device-code', {});
    expect(tcode.status).toBe(201);
    const c2 = await call(p, 'POST', '/v1/device/link', { code: tcode.body.code, label: '교실 PC' }, anon);
    expect(await playerOfDevice(p, c2.body.device_token)).toBe('stu-29ddc960');
  });

  it('nothing about the child before the consent; no guardian session → no signup (docs/16 §2-1)', async () => {
    const p = platform();
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer('a'.repeat(64)))).status).toBe(401);
    const g = await adultSignsIn(p, 'fam-no-consent', false);
    // Who consents first (guardian 19+ / student 14+, family_flags), then the consent; nothing stored before both.
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer(g))).body).toEqual({ error: 'age_attest_required' });
    expect((await call(p, 'POST', '/v1/student/attest', { who: 'teen' }, bearer(g))).status).toBe(400);
    expect((await call(p, 'POST', '/v1/student/attest', { who: 'self_14' }, anon)).status).toBe(401);
    expect((await call(p, 'POST', '/v1/student/attest', { who: 'self_14' }, bearer(g))).status).toBe(200);
    expect(p.sql.get("select v from family_flags where family_id = 'fam-no-consent' and k = 'age_attest'")).toEqual({ v: 2 });
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer(g))).body).toEqual({ error: 'service_consent_required' });
    expect(p.sql.all('select * from student_signups')).toEqual([]);
    expect((await call(p, 'POST', '/v1/family/service-consent', { granted: true }, bearer(g))).status).toBe(200);
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer(g))).status).toBe(201);
    // One account: at most 5 sign-ups a day (the queue's 40 cannot be filled by one account).
    for (let i = 0; i < 4; i++) expect((await call(p, 'POST', '/v1/student/signup', { nickname: `학생${i}` }, bearer(g))).status).toBe(201);
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '여섯째' }, bearer(g))).body).toEqual({ error: 'too_many_pending' });
  });

  it('a student who already has a real guardian is never moved; a new student can be made from the signup', async () => {
    const p = platform();
    const g1 = await adultSignsIn(p, 'fam-real');
    expect((await call(p, 'POST', '/v1/family/children', { nickname: 'Juno', birth_year: 2016 }, bearer(g1))).status).toBe(201);
    const juno = (await call(p, 'GET', '/v1/family/me', undefined, bearer(g1))).body.children.find((k: any) => k.nickname === 'Juno').player_id;
    const g2 = await adultSignsIn(p, 'fam-other');
    // 'Juno' is a student with a real guardian: the name is taken, three free ones are offered.
    const taken = await call(p, 'POST', '/v1/student/signup', { nickname: ' juno ' }, bearer(g2));
    expect(taken).toEqual({ status: 409, body: { error: 'nickname_taken', suggestions: ['juno2', 'juno3', 'juno4'] } });
    const s = await call(p, 'POST', '/v1/student/signup', { nickname: 'Juno2' }, bearer(g2));
    expect(s.body.teacher_match).toBe(false);
    const id = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    // The teacher picking the real Juno by mistake still cannot move him.
    expect((await call(p, 'POST', `/v1/admin/student-signups/${id}/approve`, { player_id: juno, check: s.body.check })).body).toEqual({ error: 'player_has_guardian' });
    expect(p.sql.get('select family_id from players where id = ?', [juno])).toEqual({ family_id: 'fam-real' });
    const made = await call(p, 'POST', `/v1/admin/student-signups/${id}/approve`, { new_student: { level: 'L2' }, check: s.body.check });
    expect(made.body).toMatchObject({ ok: true, nickname: 'Juno2' });
    expect(p.sql.get('select family_id, level from players where id = ?', [made.body.player_id])).toEqual({ family_id: 'fam-other', level: 'L2' });
    expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(s.body.claim_token))).body).toMatchObject({ state: 'approved', nickname: 'Juno2' });
  });

  it('one name, one student: a waiting name is taken; the teacher-made row with that name waits for the 4-digit check', async () => {
    expect(nicknameKey(' O-reo ')).toBe(nicknameKey('ＯＲＥＯ'));
    const p = platform();
    await teacherRow(p);
    const g = await adultSignsIn(p, 'fam-oreo');
    const a = await call(p, 'POST', '/v1/student/signup', { nickname: 'oreo' }, bearer(g));
    expect(a.status).toBe(201);
    expect(a.body.teacher_match).toBe(true);
    const row = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0];
    expect(row.match).toEqual({ player_id: 'stu-29ddc960', nickname: 'Oreo' });
    // A second 'Oreo' while the first waits: taken (no two requests for one row).
    const g2 = await adultSignsIn(p, 'fam-oreo-2');
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'O reo' }, bearer(g2))).body).toMatchObject({ error: 'nickname_taken' });
    // Not as a new student under the teacher's student's name: join the row (with the screen's 4 digits) or reject.
    expect((await call(p, 'POST', `/v1/admin/student-signups/${row.id}/approve`, { new_student: { level: 'L1' }, check: a.body.check })).body).toEqual({
      error: 'nickname_taken'
    });
    expect((await call(p, 'POST', `/v1/admin/student-signups/${row.id}/approve`, { player_id: 'stu-29ddc960', check: a.body.check })).body).toMatchObject({
      ok: true,
      player_id: 'stu-29ddc960'
    });
    // Linked now: the name belongs to a guardian's child, nobody else can sign up as Oreo.
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'OREO' }, bearer(g2))).body).toMatchObject({ error: 'nickname_taken', suggestions: ['OREO2', 'OREO3', 'OREO4'] });
    // A rejected or expired request frees the name again.
    const b = await call(p, 'POST', '/v1/student/signup', { nickname: 'Mint' }, bearer(g2));
    const bid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === 'Mint').id;
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'mint' }, bearer(g))).status).toBe(409);
    await call(p, 'POST', `/v1/admin/student-signups/${bid}/reject`, {});
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'mint' }, bearer(g))).status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('smoke and demo rows never own or match a name; two teacher rows with one name are not guessed', async () => {
    const p = platform();
    // The demo row and a smoke check's row: not students (hidden from the console list too).
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-demo', guardian_id: 'g-demo', player_id: 'player-demo', nickname: 'Demo' });
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-smoke', guardian_id: 'g-smoke', player_id: 'smoke-live-1', nickname: 'Smoke' });
    const g = await adultSignsIn(p, 'fam-d');
    const demo = await call(p, 'POST', '/v1/student/signup', { nickname: 'demo' }, bearer(g));
    expect(demo.status).toBe(201);
    expect(demo.body.teacher_match).toBe(false);
    expect((await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].match).toBeNull();
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'SMOKE' }, bearer(g))).body.teacher_match).toBe(false);
    // The row's own guardian signs in while the sign-up waits: no pick any more, and the console is told why.
    await teacherRow(p, 'stu-kiki', 'Kiki');
    // (another family: one family sends at most 5 sign-ups a day)
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'kiki' }, bearer(await adultSignsIn(p, 'fam-k')))).status).toBe(201);
    const kiki = () => call(p, 'GET', '/v1/admin/student-signups').then((r) => r.body.signups.find((s: any) => s.nickname === 'kiki'));
    expect(await kiki()).toMatchObject({ match: { player_id: 'stu-kiki' }, match_ambiguous: false, name_taken: false });
    const kinv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: 'stu-kiki' });
    expect((await call(p, 'POST', '/v1/family/session', { invite: kinv.body.invite_path.split('#k=')[1] }, anon)).status).toBe(200);
    expect(await kiki()).toMatchObject({ match: null, match_ambiguous: false, name_taken: true, taken_by: { player_id: 'stu-kiki', nickname: 'Kiki' } });
    // Two teacher-made rows called Mina: the sign-up waits for the teacher, who picks (no row guessed).
    await teacherRow(p, 'stu-mina-1', 'Mina');
    await teacherRow(p, 'stu-mina-2', 'Mina');
    const mina = await call(p, 'POST', '/v1/student/signup', { nickname: 'mina' }, bearer(g));
    expect(mina.body.teacher_match).toBe(true);
    expect((await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === 'mina')).toMatchObject({
      match: null,
      match_ambiguous: true
    });
    // The match is counted again on every listing: a second 'Juno' row made after the sign-up stops the pick.
    await teacherRow(p, 'stu-juno-1', 'Juno');
    const juno = await call(p, 'POST', '/v1/student/signup', { nickname: 'juno' }, bearer(g));
    const list1 = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === 'juno');
    expect(list1).toMatchObject({ match: { player_id: 'stu-juno-1', nickname: 'Juno' }, match_ambiguous: false });
    await teacherRow(p, 'stu-juno-2', 'JUNO');
    expect((await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === 'juno')).toMatchObject({
      match: null,
      match_ambiguous: true
    });
    // Smoke and demo rows cannot be a sign-up's target even by id (any case for 'smoke-').
    await call(p, 'POST', '/v1/admin/players', { family_id: 'fam-smk', guardian_id: 'g-smk', player_id: 'SMOKE-upper', nickname: 'Upper' });
    for (const pid of ['player-demo', 'smoke-live-1', 'SMOKE-upper'])
      expect((await call(p, 'POST', `/v1/admin/student-signups/${list1.id}/approve`, { player_id: pid, check: juno.body.check, confirm: true })).body).toEqual({
        error: 'player_not_found'
      });
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'upper' }, bearer(g))).body.teacher_match).toBe(false);
  });

  it("a name held by the signing family's own child is that child; a name held by another waiting sign-up says so", async () => {
    const p = platform();
    const g = await adultSignsIn(p, 'fam-lulu');
    const a = await call(p, 'POST', '/v1/student/signup', { nickname: 'lulu' }, bearer(g));
    expect(a.status).toBe(201);
    // The guardian adds the child 'Lulu' on the family page while the sign-up waits: the console's match is that child.
    expect((await call(p, 'POST', '/v1/family/children', { nickname: 'Lulu', birth_year: 2016 }, bearer(g))).status).toBe(201);
    const lulu = (await call(p, 'GET', '/v1/family/me', undefined, bearer(g))).body.children.find((k: any) => k.nickname === 'Lulu').player_id;
    const row = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0];
    expect(row).toMatchObject({ match: { player_id: lulu, nickname: 'Lulu' }, match_own_family: true, name_taken: false });
    expect((await call(p, 'POST', `/v1/admin/student-signups/${row.id}/approve`, { player_id: lulu, check: a.body.check })).body).toMatchObject({ ok: true, player_id: lulu });
    // Signing up again under the own child's name: told it is our child (join it), not 'someone else has it'.
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'LULU' }, bearer(g))).body).toEqual({ error: 'nickname_own_child', player_id: lulu, nickname: 'Lulu' });

    // Two waiting sign-ups with one name (only possible by a race; put straight into the table): taken_by null.
    const g2 = await adultSignsIn(p, 'fam-nori');
    await call(p, 'POST', '/v1/student/signup', { nickname: 'nori' }, bearer(g2));
    p.sql.run(
      "insert into student_signups (id, family_id, guardian_id, nickname, claim_hash, label, created_at, expires_at, state) values ('sg-race', 'fam-x', 'g-x', 'Nori', 'race-hash', '', ?, ?, 'pending')",
      [Date.now(), Date.now() + 3_600_000]
    );
    const nori = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === 'nori');
    expect(nori).toMatchObject({ match: null, name_taken: true, taken_by: null });
  });

  it('a pending nickname is not kept: cleared on reject or after 3 hours; bad nicknames refused', async () => {
    const p = platform();
    const g = await adultSignsIn(p, 'fam-n');
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'http://x.test' }, bearer(g))).status).toBe(400);
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: '01012345678' }, bearer(g))).status).toBe(400);
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'a', birth_year: 2016 }, bearer(g))).status).toBe(400);
    // The world's chat filter: bad words and personal data are refused as a name.
    expect((await call(p, 'POST', '/v1/student/signup', { nickname: 'fuck' }, bearer(g))).body).toMatchObject({ error: 'invalid', reason: 'profanity' });
    const realNow = Date.now;
    try {
      const t0 = realNow();
      const a = await call(p, 'POST', '/v1/student/signup', { nickname: '하나' }, bearer(g));
      const b = await call(p, 'POST', '/v1/student/signup', { nickname: '두리' }, bearer(g));
      const rid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups.find((s: any) => s.nickname === '두리').id;
      expect((await call(p, 'POST', `/v1/admin/student-signups/${rid}/reject`, {})).status).toBe(200);
      expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(b.body.claim_token))).body.state).toBe('rejected');
      Date.now = () => t0 + SIGNUP_PENDING_TTL_MS + 60_000;
      expect((await call(p, 'GET', '/v1/admin/student-signups')).body.signups).toHaveLength(0);
      expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(a.body.claim_token))).body.state).toBe('expired');
      expect(p.sql.all<{ nickname: string }>('select nickname from student_signups').map((r) => r.nickname)).toEqual(['', '']);
    } finally {
      Date.now = realNow;
    }
  });

  it('console routes need the operator; the teacher device code needs consent; only the student routes are public', async () => {
    const p = platform();
    await teacherRow(p);
    expect((await call(p, 'POST', '/v1/admin/students/stu-29ddc960/device-code', {})).body).toEqual({ error: 'service_consent_required' });
    for (const [m, path] of [
      ['GET', '/v1/admin/student-signups'],
      ['POST', '/v1/admin/student-signups/sg-x/approve'],
      ['POST', '/v1/admin/student-signups/sg-x/reject'],
      ['POST', '/v1/admin/students/stu-29ddc960/device-code']
    ] as const) {
      expect((await call(p, m, path, m === 'POST' ? { player_id: 'stu-29ddc960' } : undefined, anon)).status, path).toBe(401);
    }
    expect((await call(p, 'GET', '/v1/student/signup/status', undefined, bearer('f'.repeat(64)))).status).toBe(404);
    expect(isPublicRoute('POST', '/v1/student/signup')).toBe(true);
    expect(isPublicRoute('GET', '/v1/student/signup/status')).toBe(true);
    expect(isPublicRoute('GET', '/v1/admin/student-signups')).toBe(false);
    expect(isPublicRoute('POST', '/v1/join')).toBe(true);
    expect(isPublicRoute('GET', '/v1/device/lesson')).toBe(true);
    expect(isPublicRoute('POST', '/v1/device/lesson/join')).toBe(true);
  });

  it("a signed-in student device sees the teacher's lesson by itself and joins it without a code", async () => {
    expect(LINKED_DEVICE_TTL_MS).toBe(DEVICE_TOKEN_TTL_MS);
    const p = platform();
    await teacherRow(p);
    await teacherRow(p, 'stu-other', 'Mia');
    const g = await adultSignsIn(p, 'fam-acc');
    const signed = (await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer(g))).body;
    const claim = signed.claim_token;
    const sid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    await call(p, 'POST', `/v1/admin/student-signups/${sid}/approve`, { player_id: 'stu-29ddc960', check: signed.check });
    const dev = (await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(claim))).body.device_token as string;
    // The console knows Oreo has a signed-in device (the code folds away); Mia has none.
    const rows = (await call(p, 'GET', '/v1/admin/students')).body as any[];
    expect(rows.find((r) => r.player_id === 'stu-29ddc960').linked_devices).toBe(1);
    expect(rows.find((r) => r.player_id === 'stu-other').linked_devices).toBe(0);
    // No lesson yet; joining refuses.
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev))).body).toEqual({ live: false });
    expect((await call(p, 'POST', '/v1/device/lesson/join', {}, bearer(dev))).body).toEqual({ error: 'no_live_lesson' });
    // Another student's lesson is not Oreo's.
    await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-other' });
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev))).body).toEqual({ live: false });
    // The teacher starts Oreo's lesson → the device sees it → '들어가기' gives the same session as the code.
    const started = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-29ddc960' });
    expect(started.body.linked_devices).toBe(1);
    const live = await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev));
    expect(live.body).toMatchObject({ live: true, lesson_id: started.body.lesson_id });
    const joined = await call(p, 'POST', '/v1/device/lesson/join', {}, bearer(dev));
    expect(joined.body).toMatchObject({ lesson_id: started.body.lesson_id, player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1', voice_store: false });
    const st = await call(p, 'GET', '/v1/lesson/state', undefined, bearer(joined.body.student_token));
    expect(st.status).toBe(200);
    // The code path still works alongside.
    expect((await call(p, 'POST', '/v1/join', { code: started.body.join_code }, anon)).body).toMatchObject({ player_id: 'stu-29ddc960' });
    // Lesson over → nothing to join.
    expect((await call(p, 'POST', `/v1/admin/lessons/${started.body.lesson_id}/end`, {})).status).toBe(200);
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev))).body).toEqual({ live: false });
    // Not a device token → 401; a revoked device → 401.
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(g))).status).toBe(401);
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, anon)).status).toBe(401);
    p.sql.run('update devices set revoked_at = 1');
    expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev))).status).toBe(401);
  });

  it("the world's poll marks '접속 중' (world_seen_at, ≤1 write/10 s); re-attaching keeps earlier tokens; withdrawn consent stops it", async () => {
    const p = platform();
    await teacherRow(p);
    const g = await adultSignsIn(p, 'fam-seen');
    const signed = (await call(p, 'POST', '/v1/student/signup', { nickname: '오레오' }, bearer(g))).body;
    const sid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    await call(p, 'POST', `/v1/admin/student-signups/${sid}/approve`, { player_id: 'stu-29ddc960', check: signed.check });
    const dev = (await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(signed.claim_token))).body.device_token as string;
    const oreo = async () => ((await call(p, 'GET', '/v1/admin/students')).body as any[]).find((r) => r.player_id === 'stu-29ddc960');
    expect((await oreo()).world_seen_at).toBeNull();
    const realNow = Date.now;
    try {
      const t0 = realNow();
      Date.now = () => t0;
      await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev));
      expect((await oreo()).world_seen_at).toBe(t0);
      Date.now = () => t0 + 5_000; // within 10 s: no write
      await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev));
      expect((await oreo()).world_seen_at).toBe(t0);
      Date.now = () => t0 + 12_000;
      await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev));
      expect((await oreo()).world_seen_at).toBe(t0 + 12_000);
      // The live list carries it too, and attaching twice (refresh) leaves the first token working.
      const started = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'stu-29ddc960' });
      const live = (await call(p, 'GET', '/v1/admin/lessons/live')).body.lessons.find((l: any) => l.lesson_id === started.body.lesson_id);
      expect(live.world_seen_at).toBe(t0 + 12_000);
      const j1 = await call(p, 'POST', '/v1/device/lesson/join', {}, bearer(dev));
      const j2 = await call(p, 'POST', '/v1/device/lesson/join', {}, bearer(dev));
      expect(j1.body.student_token).not.toBe(j2.body.student_token);
      expect((await call(p, 'GET', '/v1/lesson/state', undefined, bearer(j1.body.student_token))).status).toBe(200);
      expect((await call(p, 'GET', '/v1/lesson/state', undefined, bearer(j2.body.student_token))).status).toBe(200);
      // Consent withdrawn (family service flag off): the world no longer attaches lessons.
      p.sql.run("update family_flags set v = 0 where family_id = 'fam-seen' and k = 'service'");
      expect((await call(p, 'GET', '/v1/device/lesson', undefined, bearer(dev))).body).toEqual({ error: 'service_consent_required' });
      expect((await call(p, 'POST', '/v1/device/lesson/join', {}, bearer(dev))).status).toBe(403);
    } finally {
      Date.now = realNow;
    }
  });

  it('a row that already has signed-in devices needs confirm; a wrong approval is undone (row back, devices out)', async () => {
    const p = platform();
    await teacherRow(p);
    // First adult links Oreo; the teacher later sees the second (stranger's) 'Oreo' request.
    const g1 = await adultSignsIn(p, 'fam-first');
    const a = (await call(p, 'POST', '/v1/student/signup', { nickname: 'Oreo' }, bearer(g1))).body;
    const aid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    await call(p, 'POST', `/v1/admin/student-signups/${aid}/approve`, { player_id: 'stu-29ddc960', check: a.check });
    const devA = (await call(p, 'GET', '/v1/student/signup/status', undefined, bearer(a.claim_token))).body.device_token as string;
    expect(await playerOfDevice(p, devA)).toBe('stu-29ddc960');
    // Undo: back to the teacher's placeholder family, device A stops, the consent for it withdrawn.
    const recent = (await call(p, 'GET', '/v1/admin/student-signups/recent')).body.approved;
    expect(recent).toMatchObject([{ id: aid, player_id: 'stu-29ddc960', nickname: 'Oreo', moved: true }]);
    expect((await call(p, 'POST', `/v1/admin/student-signups/${aid}/undo`, {})).body).toEqual({ ok: true, player_id: 'stu-29ddc960', moved_back: true });
    expect(p.sql.get('select family_id from players where id = ?', ['stu-29ddc960'])).toEqual({ family_id: 'fam-stu-29ddc960' });
    expect((await call(p, 'GET', '/v1/device/me', undefined, bearer(devA))).status).toBe(401);
    expect(p.db.hasActiveConsent('stu-29ddc960', 'service')).toBe(false);
    expect((await call(p, 'POST', `/v1/admin/student-signups/${aid}/undo`, {})).status).toBe(404);
    // A device signed in by the teacher's code would make the next link need a second confirm.
    p.sql.run("insert into family_flags (family_id, k, v, at) values ('fam-stu-29ddc960', 'service', 1, 0)");
    const tcode = await call(p, 'POST', '/v1/admin/students/stu-29ddc960/device-code', {});
    await call(p, 'POST', '/v1/device/link', { code: tcode.body.code, label: '교실' }, anon);
    p.sql.run("delete from family_flags where family_id = 'fam-stu-29ddc960'");
    const g2 = await adultSignsIn(p, 'fam-second');
    const b = (await call(p, 'POST', '/v1/student/signup', { nickname: 'Oreo' }, bearer(g2))).body;
    const bid = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    expect((await call(p, 'POST', `/v1/admin/student-signups/${bid}/approve`, { player_id: 'stu-29ddc960', check: b.check })).body).toEqual({
      error: 'player_has_devices',
      devices: 1
    });
    expect((await call(p, 'POST', `/v1/admin/student-signups/${bid}/approve`, { player_id: 'stu-29ddc960', check: b.check, confirm: true })).body).toMatchObject({
      ok: true
    });
  });

  it('undo withdraws every consent the signing family turned on (voice clips queued, lesson-window listeners hung up)', async () => {
    const p = platform();
    await teacherRow(p);
    const g = await adultSignsIn(p, 'fam-wrong');
    const a = (await call(p, 'POST', '/v1/student/signup', { nickname: 'Oreo' }, bearer(g))).body;
    const id = (await call(p, 'GET', '/v1/admin/student-signups')).body.signups[0].id;
    await call(p, 'POST', `/v1/admin/student-signups/${id}/approve`, { player_id: 'stu-29ddc960', check: a.check });
    for (const scope of ['voice_store', 'lesson_window'])
      expect((await call(p, 'PUT', `/v1/family/children/stu-29ddc960/consents/${scope}`, { granted: true }, bearer(g))).status).toBe(200);
    const me = (await call(p, 'GET', '/v1/family/me', undefined, bearer(g))).body;
    expect(me.children.find((k: any) => k.player_id === 'stu-29ddc960').consents).toMatchObject({ voice_store: true, lesson_window: true });
    p.sql.run(
      "insert into lesson_audio_listeners (id, lesson_id, player_id, guardian_id, sfu_session, mid, track_name, created_at, seen_at) values ('l-1', 'les-x', 'stu-29ddc960', ?, 'sfu', null, 't', 0, 0)",
      ['g-fam-wrong']
    );
    expect((await call(p, 'POST', `/v1/admin/student-signups/${id}/undo`, {})).body).toMatchObject({ ok: true, moved_back: true });
    expect(p.db.listConsents('stu-29ddc960')).toEqual(Object.fromEntries(Object.keys(p.db.listConsents('stu-29ddc960')).map((k) => [k, false])));
    const log = p.sql.all<{ scope: string }>("select scope from consent_log where player_id = 'stu-29ddc960' and granted = 0 order by scope");
    expect(log.map((r) => r.scope)).toEqual(['lesson_window', 'service', 'voice_store']);
    expect(p.sql.get('select closed_at, close_reason from lesson_audio_listeners where id = ?', ['l-1'])).toMatchObject({ close_reason: 'signup_undone' });
    // The signing family no longer sees the row at all.
    const after = (await call(p, 'GET', '/v1/family/me', undefined, bearer(g))).body;
    expect(after.children.map((k: any) => k.player_id)).not.toContain('stu-29ddc960');
  });

  it('the console line shows the provider and a masked hint, never the address', () => {
    expect(maskIdentity('oreo.mom@gmail.com', '1234567890')).toBe('o***@g***.com');
    expect(maskIdentity(null, 'kakao-98765')).toBe('…8765');
    expect(maskIdentity('broken', 'ab')).toBe('…');
  });
});
