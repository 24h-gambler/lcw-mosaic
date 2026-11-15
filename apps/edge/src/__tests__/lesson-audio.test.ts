import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformDO, isPublicRoute, type LcwEnv } from '../platform.js';
import {
  LESSON_AUDIO_LISTENER_FRESH_MS,
  LESSON_AUDIO_MAX_LISTENERS,
  LESSON_AUDIO_PUB_FRESH_MS,
  checkListenerAnswer,
  checkPublisherOffer,
  cloudflareRealtime,
  sdpSections
} from '../lesson-audio.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const SFU = 'https://sfu.test/v1';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

const sdp = (dirs: Array<[kind: string, mid: string, dir: string]>) =>
  ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', ...dirs.flatMap(([k, m, d]) => [`m=${k} 9 UDP/TLS/RTP/SAVPF 111`, 'c=IN IP4 0.0.0.0', `a=mid:${m}`, `a=${d}`, 'a=rtpmap:111 opus/48000/2'])].join('\r\n') + '\r\n';
const PUB_OFFER = sdp([['audio', '0', 'sendonly']]);
const LISTEN_ANSWER = sdp([['audio', '0', 'recvonly']]);

/** Stand-in for the Cloudflare Realtime HTTPS API: records every call, answers like the OpenAPI examples. */
function fakeSfu(opts: { failPull?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body: any; auth: string | null }> = [];
  let n = 0;
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith(SFU)) throw new Error(`unexpected fetch ${url}`);
    const path = url.slice(SFU.length);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? 'GET', path, body, auth: new Headers(init?.headers).get('authorization') });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/sessions/new')) return json({ sessionId: `sess${++n}` });
    if (path.endsWith('/tracks/new')) {
      const t = body.tracks[0];
      if (t.location === 'local') return json({ requiresImmediateRenegotiation: false, tracks: [{ mid: t.mid, trackName: t.trackName }], sessionDescription: { type: 'answer', sdp: sdp([['audio', t.mid, 'recvonly']]) } });
      if (opts.failPull) return json({ tracks: [{ trackName: t.trackName, errorCode: 'not_found', errorDescription: 'no such track' }] });
      return json({ requiresImmediateRenegotiation: true, tracks: [{ mid: '0', sessionId: t.sessionId, trackName: t.trackName }], sessionDescription: { type: 'offer', sdp: sdp([['audio', '0', 'sendonly']]) } });
    }
    if (path.endsWith('/renegotiate')) return json({});
    if (path.endsWith('/tracks/close')) return json({ tracks: body.tracks });
    if (path.includes('/turn/keys/')) return json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }] }, 201);
    return json({ errorCode: 'not_found' }, 404);
  };
  return { calls, handler };
}

function platform(withRealtime = true, extra: Partial<LcwEnv> = {}) {
  const env = {
    PLATFORM: undefined as never,
    LCW_OPERATOR_TOKEN: TOKEN,
    ...(withRealtime ? { REALTIME_APP_ID: 'app1', REALTIME_APP_TOKEN: 'sfu-secret', REALTIME_API_BASE: SFU } : {}),
    ...extra
  } as LcwEnv;
  return new PlatformDO({ storage: fakeDurableStorage() }, env);
}
async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(new Request(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}
async function family(p: PlatformDO, playerId: string, fam: string, windowOn = true) {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname: 'Juno', birth_year: 2016, level: 'L1' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  if (windowOn) await call(p, 'PUT', `/v1/family/children/${playerId}/consents/lesson_window`, { granted: true }, g);
  return g;
}
const listenPath = (pid: string, lid = '') => `/v1/family/children/${pid}/lesson-window/audio${lid ? `/${lid}` : ''}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SDP checks', () => {
  it('reads kind, mid and direction per m= section', () => {
    expect(sdpSections(sdp([['audio', '0', 'sendonly'], ['video', '1', 'recvonly']]))).toEqual([
      { kind: 'audio', mid: '0', direction: 'sendonly' },
      { kind: 'video', mid: '1', direction: 'recvonly' }
    ]);
  });
  it('publisher: audio only and the named mid sends', () => {
    expect(checkPublisherOffer(PUB_OFFER, '0')).toBeNull();
    expect(checkPublisherOffer(sdp([['audio', '0', 'sendonly'], ['video', '1', 'sendonly']]), '0')).toBe('audio_only');
    expect(checkPublisherOffer(PUB_OFFER, '3')).toBe('unknown_mid');
    expect(checkPublisherOffer(sdp([['audio', '0', 'recvonly']]), '0')).toBe('not_sending');
    expect(checkPublisherOffer('garbage', '0')).toBe('bad_sdp');
  });
  it('listener: anything that would send (or no direction = sendrecv) is refused', () => {
    expect(checkListenerAnswer(LISTEN_ANSWER)).toBeNull();
    expect(checkListenerAnswer(sdp([['audio', '0', 'inactive']]))).toBeNull();
    expect(checkListenerAnswer(sdp([['audio', '0', 'sendrecv']]))).toBe('listen_only');
    expect(checkListenerAnswer(sdp([['audio', '0', 'sendonly']]))).toBe('listen_only');
    expect(checkListenerAnswer(LISTEN_ANSWER.replace('a=recvonly\r\n', ''))).toBe('listen_only');
    expect(checkListenerAnswer(sdp([['video', '0', 'recvonly']]))).toBe('audio_only');
  });
});

describe('Realtime client (Cloudflare HTTPS API shapes)', () => {
  it('pushes with the offer, pulls without one, and keeps the secret in the header only', async () => {
    const f = fakeSfu();
    const rt = cloudflareRealtime({ appId: 'app1', appToken: 'sfu-secret', apiBase: SFU }, f.handler as never);
    const s = await rt.newSession();
    await rt.pushTrack(s, PUB_OFFER, '0', 'lesson-x');
    const pulled = await rt.pullTrack(await rt.newSession(), s, 'lesson-x');
    expect(pulled.mid).toBe('0');
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /apps/app1/sessions/new',
      'POST /apps/app1/sessions/sess1/tracks/new',
      'POST /apps/app1/sessions/new',
      'POST /apps/app1/sessions/sess2/tracks/new'
    ]);
    expect(f.calls[1]!.body).toEqual({ sessionDescription: { type: 'offer', sdp: PUB_OFFER }, tracks: [{ location: 'local', mid: '0', trackName: 'lesson-x' }] });
    expect(f.calls[3]!.body).toEqual({ tracks: [{ location: 'remote', sessionId: 'sess1', trackName: 'lesson-x' }] });
    expect(f.calls.every((c) => c.auth === 'Bearer sfu-secret')).toBe(true);
    expect(JSON.stringify(f.calls.map((c) => c.body))).not.toContain('sfu-secret');
  });
  it('item errors inside a 200 are errors; TURN falls back to STUN when the key call fails', async () => {
    const f = fakeSfu({ failPull: true });
    const rt = cloudflareRealtime({ appId: 'app1', appToken: 't', apiBase: SFU }, f.handler as never);
    await expect(rt.pullTrack('s', 'p', 'x')).rejects.toThrow('realtime_not_found');
    expect(await rt.iceServers()).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
    const withTurn = cloudflareRealtime({ appId: 'app1', appToken: 't', apiBase: SFU, turnKeyId: 'k', turnKeyToken: 'kt' }, f.handler as never);
    expect((await withTurn.iceServers())[1]).toMatchObject({ username: 'u', credential: 'c' });
    const broken = cloudflareRealtime({ appId: 'a', appToken: 't', apiBase: SFU, turnKeyId: 'k', turnKeyToken: 'kt' }, (async () => {
      throw new Error('down');
    }) as never);
    expect(await broken.iceServers()).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  });
});

describe('live lesson listening (WP-307: teacher publishes one way, guardian receives only)', () => {
  it('without the SFU secrets: routes answer 503 and the window says text only', async () => {
    const p = platform(false);
    const g = await family(p, 'kid-1', 'fam-a');
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' });
    expect((await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/audio/ice`)).status).toBe(503);
    expect((await call(p, 'POST', `/v1/admin/lessons/${s.body.lesson_id}/audio/publish`, { sdp: PUB_OFFER, mid: '0' })).body.error).toBe('realtime_not_configured');
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).body.error).toBe('realtime_not_configured');
    const w = await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g);
    expect(w.body.audio).toEqual({ direction: 'recvonly', available: false, reason: 'realtime_not_configured', stream_id: null, listener: null });
  });

  it('teacher publishes → window shows the stream → guardian pulls, answers recvonly → teacher sees 1 listener', async () => {
    const f = fakeSfu();
    vi.stubGlobal('fetch', f.handler);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const lessonId = (await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })).body.lesson_id as string;

    // before the teacher publishes
    let w = await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g);
    expect(w.body.audio).toMatchObject({ available: false, reason: 'no_teacher_stream' });
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).body.error).toBe('no_teacher_stream');

    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/ice`)).body.ice_servers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
    // a camera or a non-sending offer is refused before any SFU call
    const before = f.calls.length;
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: sdp([['audio', '0', 'sendonly'], ['video', '1', 'sendonly']]), mid: '0' })).body.error).toBe('audio_only');
    expect(f.calls.length).toBe(before);
    const pub = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: PUB_OFFER, mid: '0' });
    expect(pub.status).toBe(200);
    expect(pub.body.sdp).toContain('a=recvonly');
    expect(pub.body.stream_id).toMatch(/^lesson-[0-9a-f]{16}$/);

    w = await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g);
    expect(w.body.audio).toEqual({ direction: 'recvonly', available: true, reason: null, stream_id: pub.body.stream_id, listener: null });

    const start = await call(p, 'POST', listenPath('kid-1'), {}, g);
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ listener_id: expect.stringMatching(/^[0-9a-f]{24}$/), stream_id: pub.body.stream_id });
    expect(start.body.sdp).toContain('a=sendonly');
    expect(Object.keys(start.body).sort()).toEqual(['ice_servers', 'listener_id', 'sdp', 'stream_id']);
    const lid = start.body.listener_id as string;
    const pull = f.calls.filter((c) => c.path.endsWith('/tracks/new'))[1]!;
    expect(pull.body.tracks[0]).toEqual({ location: 'remote', sessionId: 'sess1', trackName: pub.body.stream_id });

    // not counted until answered
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body).toEqual({ live: true, listeners: 0 });
    // an answer that would send the guardian's mic is never forwarded, and the half-open listener is closed
    const sending = await call(p, 'PUT', listenPath('kid-1', lid), { sdp: sdp([['audio', '0', 'sendrecv']]) }, g);
    expect(sending).toEqual({ status: 400, body: { error: 'listen_only' } });
    expect(f.calls.some((c) => c.path.endsWith('/renegotiate'))).toBe(false);
    expect((await call(p, 'PUT', listenPath('kid-1', lid), { sdp: LISTEN_ANSWER }, g)).body.error).toBe('listener_closed');

    const again = await call(p, 'POST', listenPath('kid-1'), {}, g);
    const lid2 = again.body.listener_id as string;
    expect((await call(p, 'PUT', listenPath('kid-1', lid2), { sdp: LISTEN_ANSWER }, g)).body).toEqual({ ok: true });
    const reneg = f.calls.find((c) => c.path.endsWith('/renegotiate'))!;
    expect(reneg.body).toEqual({ sessionDescription: { type: 'answer', sdp: LISTEN_ANSWER } });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body).toEqual({ live: true, listeners: 1 });
    w = await call(p, 'GET', `/v1/family/children/kid-1/lesson-window?listener=${lid2}`, undefined, g);
    expect(w.body.audio.listener).toBe('open');
    expect((await call(p, 'GET', `/v1/family/children/kid-1/lesson-window?listener=${lid}`, undefined, g)).body.audio.listener).toBe('closed');

    // the guardian hangs up → closed at the SFU, teacher count drops
    expect((await call(p, 'DELETE', listenPath('kid-1', lid2), undefined, g)).body).toEqual({ ok: true });
    const close = f.calls.filter((c) => c.path.endsWith('/tracks/close')).pop()!;
    expect(close.body).toEqual({ tracks: [{ mid: '0' }], force: true });
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body.listeners).toBe(0);
  });

  it('only this family, only with lesson_window, never the operator; consent off hangs up at once', async () => {
    const f = fakeSfu();
    vi.stubGlobal('fetch', f.handler);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const other = await family(p, 'kid-2', 'fam-b');
    const noWindow = await family(p, 'kid-3', 'fam-c', false);
    const lessonId = (await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })).body.lesson_id as string;
    await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-3' });
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: PUB_OFFER, mid: '0' });

    expect((await call(p, 'POST', listenPath('kid-1'), {}, other)).status).toBe(404);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, op)).status).toBe(401);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, anon)).status).toBe(401);
    expect((await call(p, 'POST', listenPath('kid-3'), {}, noWindow)).body.error).toBe('lesson_window_consent_required');

    const lid = (await call(p, 'POST', listenPath('kid-1'), {}, g)).body.listener_id as string;
    await call(p, 'PUT', listenPath('kid-1', lid), { sdp: LISTEN_ANSWER }, g);
    // another family cannot answer or hang up this listener
    expect((await call(p, 'PUT', listenPath('kid-2', lid), { sdp: LISTEN_ANSWER }, other)).status).toBe(404);
    expect((await call(p, 'DELETE', listenPath('kid-1', lid), undefined, other)).status).toBe(404);

    const off = await call(p, 'PUT', '/v1/family/children/kid-1/consents/lesson_window', { granted: false }, g);
    expect(off.body.listeners_closed).toBe(1);
    expect(f.calls.filter((c) => c.path.endsWith('/tracks/close')).length).toBe(1);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body.listeners).toBe(0);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).status).toBe(403);
  });

  it('freshness: a silent console stops being offered, stale listeners free their place, ending the lesson ends the stream', async () => {
    const f = fakeSfu();
    vi.stubGlobal('fetch', f.handler);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const lessonId = (await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })).body.lesson_id as string;
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: PUB_OFFER, mid: '0' });

    for (let i = 0; i < LESSON_AUDIO_MAX_LISTENERS; i++) expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).status).toBe(201);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).body.error).toBe('too_many_listeners');
    vi.setSystemTime(Date.now() + LESSON_AUDIO_LISTENER_FRESH_MS + 1000);
    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).status).toBe(201);

    vi.setSystemTime(Date.now() + LESSON_AUDIO_PUB_FRESH_MS + 1000);
    expect((await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g)).body.audio.reason).toBe('no_teacher_stream');
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).body.error).toBe('no_teacher_stream');
    // the console's beat brings it back
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body.live).toBe(true);
    expect((await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g)).body.audio.available).toBe(true);

    await call(p, 'POST', `/v1/admin/lessons/${lessonId}/end`, {});
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/beat`)).body.live).toBe(false);
    expect((await call(p, 'POST', listenPath('kid-1'), {}, g)).body.error).toBe('no_teacher_stream');
  });

  it('republish replaces the stream and closes the old listeners; stop closes everything', async () => {
    const f = fakeSfu();
    vi.stubGlobal('fetch', f.handler);
    const p = platform();
    const g = await family(p, 'kid-1', 'fam-a');
    const lessonId = (await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-1' })).body.lesson_id as string;
    const a = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: PUB_OFFER, mid: '0' });
    const lid = (await call(p, 'POST', listenPath('kid-1'), {}, g)).body.listener_id as string;
    await call(p, 'PUT', listenPath('kid-1', lid), { sdp: LISTEN_ANSWER }, g);
    const b = await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/publish`, { sdp: PUB_OFFER, mid: '0' });
    expect(b.body.stream_id).not.toBe(a.body.stream_id);
    const w = await call(p, 'GET', `/v1/family/children/kid-1/lesson-window?listener=${lid}`, undefined, g);
    expect(w.body.audio).toMatchObject({ stream_id: b.body.stream_id, listener: 'closed' });
    const lid2 = (await call(p, 'POST', listenPath('kid-1'), {}, g)).body.listener_id as string;
    await call(p, 'PUT', listenPath('kid-1', lid2), { sdp: LISTEN_ANSWER }, g);
    expect((await call(p, 'POST', `/v1/admin/lessons/${lessonId}/audio/stop`)).body).toEqual({ ok: true, listeners_closed: 1 });
    expect((await call(p, 'GET', '/v1/family/children/kid-1/lesson-window', undefined, g)).body.audio.available).toBe(false);
  });

  it('route gates: listener routes are guardian-public, teacher routes need the operator token, the old uplink stays 403', async () => {
    expect(isPublicRoute('POST', '/v1/family/children/kid-1/lesson-window/audio')).toBe(true);
    expect(isPublicRoute('PUT', '/v1/family/children/kid-1/lesson-window/audio/0123456789abcdef01234567')).toBe(true);
    expect(isPublicRoute('POST', '/v1/admin/lessons/l1/audio/publish')).toBe(false);
    const p = platform();
    expect((await call(p, 'POST', '/v1/admin/lessons/l1/audio/publish', { sdp: PUB_OFFER, mid: '0' }, anon)).status).toBe(401);
  });
});
