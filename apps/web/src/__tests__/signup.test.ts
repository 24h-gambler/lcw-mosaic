import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignupQueue } from '../DirectorSignups.js';
import { StudentSignupPage, reloadOwnChildren, signupErrorText } from '../StudentSignup.js';
import { SIGNUP_STRINGS_KO } from '../signupStrings.js';
import { StudentApiError, createStudentAccountApi, isOAuthReturn, oauthStartPath } from '../studentAccountApi.js';

const S = SIGNUP_STRINGS_KO.student;
const Q = SIGNUP_STRINGS_KO.queue;
const G = 'a'.repeat(64);

describe('student sign-up client (/signup)', () => {
  it('OAuth return: only the one-use code or an error counts; a bare #g= token is ignored (session fixation)', () => {
    expect(isOAuthReturn(`#oauth=${'c'.repeat(32)}`)).toBe(true);
    expect(isOAuthReturn('#oauth_error=state_mismatch')).toBe(true);
    expect(isOAuthReturn(`#g=${G}`)).toBe(false);
    expect(isOAuthReturn('#oauth=<script>')).toBe(false);
    expect(isOAuthReturn('')).toBe(false);
    expect(oauthStartPath('google')).toBe('/v1/oauth/google/start?role=guardian&return=%2Fsignup');
    expect(oauthStartPath('kakao')).toBe('/v1/oauth/kakao/start?role=guardian&return=%2Fsignup');
  });

  it('the API sends the adult session only where it is needed and never a child field', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.includes('/oauth/config') ? { providers: ['google', 'x'] } : { state: 'pending', claim_token: 'c' }), {
        status: 201
      });
    }) as unknown as typeof fetch;
    const api = createStudentAccountApi('', fetchFn);
    expect(await api.oauthConfig()).toEqual({ providers: ['google'] });
    await api.signup(G, '오레오', '학생 기기');
    expect(calls[1]!.url).toBe('/v1/student/signup');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${G}`);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ nickname: '오레오', label: '학생 기기' });
    await api.status('b'.repeat(64));
    expect(calls[2]!.url).toBe('/v1/student/signup/status');
    // Who consents goes to the server (family_flags), and the approval carries the 4 digits from the student screen.
    await api.attest(G, 'guardian_19');
    expect([calls[3]!.url, JSON.parse(String(calls[3]!.init.body))]).toEqual(['/v1/student/attest', { who: 'guardian_19' }]);
    await api.approve('op', 'sg-1', { player_id: 'stu-29ddc960', check: '1234', confirm: true });
    expect([calls[4]!.url, JSON.parse(String(calls[4]!.init.body))]).toEqual([
      '/v1/admin/student-signups/sg-1/approve',
      { player_id: 'stu-29ddc960', check: '1234', confirm: true }
    ]);
    await api.undo('op', 'sg-1');
    expect(calls[5]!.url).toBe('/v1/admin/student-signups/sg-1/undo');
    // An older server without the OAuth module: no buttons, no throw.
    const old = createStudentAccountApi('', (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch);
    expect(await old.oauthConfig()).toEqual({ providers: [] });
  });

  it("a sign-up under our own child's name says so and points at that child's connect button", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: 'nickname_own_child', player_id: 'kid-1', nickname: 'Lulu' }), { status: 409 })) as unknown as typeof fetch;
    const err = await createStudentAccountApi('', fetchFn)
      .signup(G, 'LULU', '학생 기기')
      .then(
        () => null,
        (e: unknown) => e
      );
    const text = signupErrorText(err);
    expect(text).toBe(S.errOwnChild('Lulu'));
    // The message names the button the screen really shows.
    expect(text).toContain(S.connectAs('Lulu'));
    expect(signupErrorText(new Error('offline'))).toBe(S.errNetwork);
  });

  it('after nickname_own_child the family reloads (new buttons); a lost session signs out; other errors keep the list', async () => {
    const kids = [{ player_id: 'kid-1', nickname: 'Lulu' }] as never[];
    const run = async (familyMe: () => Promise<unknown>) => {
      const got: { children?: unknown; out: number } = { out: 0 };
      await reloadOwnChildren({ familyMe } as never, G, (k) => (got.children = k), () => got.out++);
      return got;
    };
    expect(await run(async () => ({ service_consented: true, children: kids }))).toEqual({ children: kids, out: 0 });
    expect(await run(async () => Promise.reject(new StudentApiError(401, 'unauthorized')))).toEqual({ out: 1 });
    expect(await run(async () => Promise.reject(new Error('offline')))).toEqual({ out: 0 });
  });

  it('first screen: who signs in, the lesson code path stays one tap away', () => {
    const html = renderToStaticMarkup(React.createElement(StudentSignupPage, { hash: '' }));
    expect(html).toContain('data-step="start"');
    expect(html).toContain(S.startBody);
    expect(html).toContain(S.toLesson);
    expect(html).toContain(S.haveCode);
  });

  it("'이미 가입했어요 · 로그인' (?mode=signin, from the world's title) is the same page with a sign-in title", () => {
    const html = renderToStaticMarkup(React.createElement(StudentSignupPage, { hash: '', search: '?mode=signin' }));
    expect(html).toContain(S.titleSignin);
    expect(html).toContain(S.signinBody);
    expect(html).not.toContain(S.startBody);
  });

  it('back from OAuth: the one-use code is exchanged first (checking); a bare #g= token signs nobody in', () => {
    expect(renderToStaticMarkup(React.createElement(StudentSignupPage, { hash: `#oauth=${'c'.repeat(32)}` }))).toContain('data-step="checking"');
    expect(renderToStaticMarkup(React.createElement(StudentSignupPage, { hash: '#oauth_error=handoff_invalid' }))).toContain('data-step="checking"');
    expect(renderToStaticMarkup(React.createElement(StudentSignupPage, { hash: `#g=${G}` }))).toContain('data-step="start"');
    expect(S.oauthError('handoff_invalid')).not.toBe(S.oauthError('provider_error'));
  });
});

describe('director console: 승인 대기 (DirectorSignups.tsx)', () => {
  it('lists each waiting sign-up with the student rows to link to, a new-student and a reject button', () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [
          {
            id: 'sg-1',
            nickname: '오레오',
            created_at: now - 3 * 60_000,
            expires_at: now + 1e7,
            signer: { provider: 'google', hint: 'o***@g***.com', attest: 'guardian_19' },
            family_students: []
          }
        ],
        initialStudents: [{ player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1' } as never]
      })
    );
    expect(html).toContain(`${Q.title} (1)`);
    expect(html).toContain('오레오');
    expect(html).toContain('3분 전');
    expect(html).toContain('Oreo · stu-29ddc960');
    expect(html).toContain(Q.approve);
    expect(html).toContain(Q.newStudent);
    expect(html).toContain(Q.reject);
    expect(html).toContain(Q.deviceTitle);
    // Who signed and the 4-digit check from the student screen (the digits themselves are never listed).
    expect(html).toContain(Q.signer('google', 'o***@g***.com'));
    expect(html).toContain(Q.attest('guardian_19'));
    expect(html).toContain(Q.checkLabel);
    expect(html).toContain('data-testid="signup-check-input"');
  });

  it("a name that matched the teacher's student starts on that student, with a line saying so", () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [
          {
            id: 'sg-2',
            nickname: 'oreo',
            created_at: now - 60_000,
            expires_at: now + 1e7,
            family_students: [],
            match: { player_id: 'stu-29ddc960', nickname: 'Oreo' }
          }
        ],
        initialStudents: [
          { player_id: 'stu-aaaa', nickname: 'Mia', level: 'L1' } as never,
          { player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1' } as never
        ]
      })
    );
    expect(html).toContain(Q.match('Oreo').replace(/'/g, '&#x27;'));
    expect(html).toMatch(/<option value="stu-29ddc960" selected="">/);
  });

  it('a match that is not in the student list (a hidden smoke or demo row) is not picked or shown', () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [
          { id: 'sg-3', nickname: 'demo', created_at: now - 60_000, expires_at: now + 1e7, family_students: [], match: { player_id: 'player-demo', nickname: 'Demo' } }
        ],
        initialStudents: [{ player_id: 'stu-29ddc960', nickname: 'Oreo', level: 'L1' } as never]
      })
    );
    expect(html).not.toContain('data-testid="signup-match"');
    expect(html).toContain('<option value="" selected="">');
  });

  it('two students with the sign-up name: no pick, one line asking the teacher to choose', () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [{ id: 'sg-4', nickname: 'mina', created_at: now - 60_000, expires_at: now + 1e7, family_students: [], match: null, match_ambiguous: true }],
        initialStudents: [{ player_id: 'stu-mina-1', nickname: 'Mina', level: 'L1' } as never, { player_id: 'stu-mina-2', nickname: 'Mina', level: 'L1' } as never]
      })
    );
    expect(html).toContain(Q.ambiguous('mina').replace(/'/g, '&#x27;'));
    expect(html).toContain('<option value="" selected="">');
  });

  it("a name a guardian's student took after the sign-up: one line saying link or reject", () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [
          { id: 'sg-5', nickname: 'kiki', created_at: now - 60_000, expires_at: now + 1e7, family_students: [], match: null, name_taken: true, taken_by: { player_id: 'stu-kiki', nickname: 'Kiki' } }
        ],
        initialStudents: [{ player_id: 'stu-kiki', nickname: 'Kiki', level: 'L1' } as never]
      })
    );
    expect(html).toContain(Q.nameTakenNow('kiki', 'Kiki (stu-kiki)').replace(/'/g, '&#x27;'));
    // Nothing picked in advance.
    expect(html).toContain('<option value="" selected="">');
  });

  it('a name another waiting sign-up holds says so (no student to point at); an own-family match says it is this family', () => {
    const now = Date.parse('2026-11-16T06:00:00Z');
    const html = renderToStaticMarkup(
      React.createElement(SignupQueue, {
        token: 'op',
        now: () => now,
        pollMs: 1e9,
        initialSignups: [
          { id: 'sg-6', nickname: 'nori', created_at: now - 60_000, expires_at: now + 1e7, family_students: [], match: null, name_taken: true, taken_by: null },
          { id: 'sg-7', nickname: 'lulu', created_at: now - 60_000, expires_at: now + 1e7, family_students: [], match: { player_id: 'kid-1', nickname: 'Lulu' }, match_own_family: true }
        ],
        initialStudents: [{ player_id: 'kid-1', nickname: 'Lulu', level: 'L1' } as never]
      })
    );
    expect(html).toContain(Q.nameTakenNow('nori').replace(/'/g, '&#x27;'));
    expect(html).toContain(Q.matchOwn('Lulu').replace(/'/g, '&#x27;'));
    expect(html).toMatch(/<option value="kid-1" selected="">/);
  });

  it('empty queue says where sign-ups come from', () => {
    const html = renderToStaticMarkup(React.createElement(SignupQueue, { token: 'op', pollMs: 1e9 }));
    expect(html).toContain(Q.empty);
  });
});
