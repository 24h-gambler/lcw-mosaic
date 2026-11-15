/**
 * Voice clips (voice.ts, docs/02 §10, docs/16): stored only with voice_store on, uploaded once per spoken turn,
 * heard only by that child's guardian through short signed URLs, never through the forwardable report link, counted
 * (not heard) by the operator, deleted at once when the consent goes off and 12 months after the last seat ends.
 */
import { describe, expect, it } from 'vitest';
import { PlatformDO, type LcwEnv } from '../platform.js';
import { MemoryR2Bucket, REPORT_CLIPS_MAX, VOICE_KEEP_AFTER_SEAT_MS, VOICE_MAX_BYTES, VOICE_PLAY_URL_TTL_MS, sniffAudioMime } from '../voice.js';
import { fakeDurableStorage } from './fake-do.js';

const TOKEN = 'op-token-0123456789abcdef';
const op = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const anon = { 'content-type': 'application/json' };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const DAY = 86_400_000;

function setup(withR2 = true) {
  const r2 = new MemoryR2Bucket();
  const p = new PlatformDO(
    { storage: fakeDurableStorage() },
    { PLATFORM: undefined as never, LCW_OPERATOR_TOKEN: TOKEN, ...(withR2 ? { VOICE: r2 } : {}) } as LcwEnv
  );
  return { p, r2 };
}

async function call(p: PlatformDO, method: string, path: string, body?: unknown, headers: Record<string, string> = op) {
  const res = await p.fetch(
    new Request(`https://x${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof Uint8Array ? new Blob([body as BlobPart]) : JSON.stringify(body)
    })
  );
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let b: any = text;
  try {
    b = JSON.parse(text);
  } catch {
    /* binary or plain text */
  }
  return { status: res.status, body: b, bytes: buf, headers: res.headers };
}

async function family(p: PlatformDO, playerId: string, fam: string, nickname = 'Juno') {
  await call(p, 'POST', '/v1/admin/players', { family_id: fam, guardian_id: `g-${fam}`, player_id: playerId, nickname, birth_year: 2016, level: 'L2' });
  const inv = await call(p, 'POST', '/v1/admin/family-invites', { player_id: playerId });
  const s = await call(p, 'POST', '/v1/family/session', { invite: inv.body.invite_path.split('#k=')[1] }, anon);
  const g = bearer(s.body.guardian_token);
  await call(p, 'POST', '/v1/family/service-consent', { granted: true }, g);
  return g;
}
async function device(p: PlatformDO, g: Record<string, string>, playerId: string) {
  const code = await call(p, 'POST', `/v1/family/children/${playerId}/device-code`, undefined, g);
  const link = await call(p, 'POST', '/v1/device/link', { code: code.body.code }, anon);
  return bearer(link.body.device_token);
}
const voiceOn = (p: PlatformDO, g: Record<string, string>, pid: string, granted = true) =>
  call(p, 'PUT', `/v1/family/children/${pid}/consents/voice_store`, { granted }, g);

let dlg = 0;
const say = (p: PlatformDO, dev: Record<string, string>, transcript = 'can i have a tea', stt_source = 'browser') =>
  call(
    p,
    'POST',
    '/v1/converse/score',
    {
      dialog_id: `dlg-${++dlg}`,
      npc_ctx: 'cafe',
      target_text: 'Can I have a tea?',
      transcript,
      chosen_stars: 1,
      hint_level: 'none',
      latency_ms: 900,
      dur_ms: 1800,
      stt_source,
      confidence: 0.9,
      echo: false,
      attempts: 1,
      mode: 'free'
    },
    dev
  );

/** A minimal WebM (EBML magic) of n bytes. */
const webm = (n = 2000, fill = 7) => {
  const b = new Uint8Array(n).fill(fill);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
};
const upload = (p: PlatformDO, token: string, bytes: Uint8Array, type = 'audio/webm') =>
  call(p, 'POST', `/v1/voice/upload/${token}`, bytes, { 'content-type': type });

async function weeklyReport(p: PlatformDO, pid: string, share: string) {
  (p as any).db.saveReport({ id: `rep-${share}`, playerId: pid, kind: 'weekly', refId: '2026-W46', facts: {}, body: 'b', clips: [], shareToken: share, nowMs: Date.now() });
}

describe('voice clips (voice.ts)', () => {
  it('container sniffing accepts WebM, Ogg and MP4 only', () => {
    expect(sniffAudioMime(webm())).toBe('audio/webm');
    expect(sniffAudioMime(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('audio/ogg');
    expect(sniffAudioMime(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]))).toBe('audio/mp4');
    expect(sniffAudioMime(new TextEncoder().encode('<html>not audio</html>'))).toBeNull();
  });

  it('no consent, typed input or no R2 binding → no upload offer and nothing stored', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v1', 'fam-v1');
    const dev = await device(p, g, 'kid-v1');
    const off = await say(p, dev);
    expect(off.status).toBe(200);
    expect(off.body.audio_upload).toBeUndefined();
    await voiceOn(p, g, 'kid-v1');
    expect((await say(p, dev, 'can i have a tea', 'keyboard')).body.audio_upload).toBeUndefined();
    expect((await say(p, dev, 'can i have a tea', 'board')).body.audio_upload).toBeUndefined();
    expect(r2.objects.size).toBe(0);

    const bare = setup(false).p;
    const g2 = await family(bare, 'kid-v1b', 'fam-v1b');
    const dev2 = await device(bare, g2, 'kid-v1b');
    await voiceOn(bare, g2, 'kid-v1b');
    expect((await say(bare, dev2)).body.audio_upload).toBeUndefined();
  });

  it('a speech turn with consent uploads once; non-audio, oversize and replays are refused', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v2', 'fam-v2');
    const dev = await device(p, g, 'kid-v2');
    await voiceOn(p, g, 'kid-v2');
    const turn = await say(p, dev);
    const offer = turn.body.audio_upload;
    expect(offer).toMatchObject({ max_bytes: VOICE_MAX_BYTES });
    expect(offer.token).toMatch(/^[0-9a-f]{48}$/);

    expect((await upload(p, offer.token, new TextEncoder().encode('<script>alert(1)</script> padding'))).status).toBe(415);
    expect((await upload(p, offer.token, webm(VOICE_MAX_BYTES + 1))).status).toBe(413);
    const ok = await upload(p, offer.token, webm(3000));
    expect(ok.status).toBe(201);
    expect((await upload(p, offer.token, webm(3000))).status).toBe(401);
    expect((await upload(p, 'f'.repeat(48), webm(3000))).status).toBe(401);
    expect(r2.objects.size).toBe(1);
    const [key, obj] = [...r2.objects.entries()][0]!;
    // Opaque key: no child id, nickname or words in R2.
    expect(key).toMatch(/^clips\/[0-9a-f]{24}$/);
    expect(obj.mime).toBe('audio/webm');
    const row = (p as any).sql.get("select audio_final from utterances where player_id = 'kid-v2' and audio_final is not null");
    expect(row.audio_final).toMatch(/^[0-9a-f]{24}$/);
    // A client-chosen audio_key in the score body is never stored.
    const sneaky = await call(p, 'POST', '/v1/converse/score', { ...{ dialog_id: 'x1', npc_ctx: 'cafe', target_text: '', transcript: 'water please', chosen_stars: 1, hint_level: 'none', stt_source: 'browser' }, audio_key: 'evil/key' }, dev);
    expect(JSON.stringify((p as any).sql.all("select audio_first, audio_final from utterances where player_id = 'kid-v2'"))).not.toContain('evil');
    expect([200, 400]).toContain(sneaky.status);
  });

  it('only the guardian of that child hears it, through short signed URLs; the report link carries no audio', async () => {
    const { p } = setup();
    const g = await family(p, 'kid-v3', 'fam-v3', 'Mina');
    const gOther = await family(p, 'kid-v3x', 'fam-v3x');
    const dev = await device(p, g, 'kid-v3');
    await voiceOn(p, g, 'kid-v3');
    const clip = webm(5000, 9);
    for (let i = 0; i < REPORT_CLIPS_MAX + 2; i++) {
      const t = await say(p, dev, i % 2 ? 'can i have a tea please' : 'can i have a tea');
      expect((await upload(p, t.body.audio_upload.token, clip)).status).toBe(201);
    }
    const share = 's'.repeat(32);
    await weeklyReport(p, 'kid-v3', share);

    const pub = await call(p, 'GET', `/v1/reports/${share}`, undefined, anon);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).not.toMatch(/voice\/clips|audio/);

    expect((await call(p, 'GET', `/v1/family/reports/${share}/clips`, undefined, anon)).status).toBe(401);
    expect((await call(p, 'GET', `/v1/family/reports/${share}/clips`, undefined, op)).status).toBe(401);
    expect((await call(p, 'GET', `/v1/family/reports/${share}/clips`, undefined, gOther)).status).toBe(404);
    const list = await call(p, 'GET', `/v1/family/reports/${share}/clips`, undefined, g);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    expect(list.body.voice_store).toBe(true);
    expect(list.body.clips).toHaveLength(REPORT_CLIPS_MAX);
    const c0 = list.body.clips[0];
    expect(c0.text).toMatch(/can i have a tea/);
    expect(JSON.stringify(list.body)).not.toContain('kid-v3');

    const heard = await call(p, 'GET', c0.url, undefined, {});
    expect(heard.status).toBe(200);
    expect(heard.headers.get('content-type')).toBe('audio/webm');
    expect(heard.headers.get('cache-control')).toBe('private, no-store');
    expect(heard.bytes).toEqual(clip);
    const part = await call(p, 'GET', c0.url, undefined, { range: 'bytes=0-99' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${clip.length}`);
    expect(part.bytes.length).toBe(100);

    const u = new URL(`https://x${c0.url}`);
    const tampered = `${u.pathname}?e=${u.searchParams.get('e')}&s=${'0'.repeat(64)}`;
    expect((await call(p, 'GET', tampered, undefined, {})).status).toBe(403);
    const longer = `${u.pathname}?e=${Number(u.searchParams.get('e')) + 3_600_000}&s=${u.searchParams.get('s')}`;
    expect((await call(p, 'GET', longer, undefined, {})).status).toBe(403);
    // Another clip id with this signature does not open.
    const other = list.body.clips[1].url.split('?')[0];
    expect((await call(p, 'GET', `${other}?${u.searchParams.toString()}`, undefined, {})).status).toBe(403);
    expect(Number(u.searchParams.get('e')) - Date.now()).toBeLessThanOrEqual(VOICE_PLAY_URL_TTL_MS);
  });

  it('operator sees counts and sizes only — no URL, no audio', async () => {
    const { p } = setup();
    const g = await family(p, 'kid-v4', 'fam-v4');
    const dev = await device(p, g, 'kid-v4');
    await voiceOn(p, g, 'kid-v4');
    const t = await say(p, dev);
    await upload(p, t.body.audio_upload.token, webm(4000));
    const v = await call(p, 'GET', '/v1/admin/voice');
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ store_bound: true, clips_total: 1, bytes_total: 4000, purge_queue: 0 });
    expect(v.body.players[0]).toMatchObject({ player_id: 'kid-v4', clips: 1, bytes: 4000, keep_until: null });
    expect(JSON.stringify(v.body)).not.toMatch(/clips\/|url|\?e=/);
    expect((await call(p, 'GET', '/v1/admin/voice', undefined, anon)).status).toBe(401);
  });

  it('consent off deletes every clip from R2 before answering; a pending upload is refused', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v5', 'fam-v5');
    const dev = await device(p, g, 'kid-v5');
    await voiceOn(p, g, 'kid-v5');
    const t1 = await say(p, dev);
    await upload(p, t1.body.audio_upload.token, webm());
    const pending = await say(p, dev);
    await weeklyReport(p, 'kid-v5', 'q'.repeat(32));
    const url = (await call(p, 'GET', `/v1/family/reports/${'q'.repeat(32)}/clips`, undefined, g)).body.clips[0].url;
    expect(r2.objects.size).toBe(1);

    const off = await voiceOn(p, g, 'kid-v5', false);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ active: false, voice_purge: { deleted: 1, pending: 0 } });
    expect(r2.objects.size).toBe(0);
    expect((p as any).sql.get("select count(*) as n from utterances where player_id = 'kid-v5' and audio_final is not null").n).toBe(0);
    expect((await call(p, 'GET', url, undefined, {})).status).toBe(404);
    expect((await upload(p, pending.body.audio_upload.token, webm())).status).toBe(401);
    expect(r2.objects.size).toBe(0);
    const list = await call(p, 'GET', `/v1/family/reports/${'q'.repeat(32)}/clips`, undefined, g);
    expect(list.body).toEqual({ voice_store: false, clips: [] });
  });

  it('R2 refusing the delete keeps the clip queued (already unreachable) and the hourly cron finishes it', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v6', 'fam-v6');
    const dev = await device(p, g, 'kid-v6');
    await voiceOn(p, g, 'kid-v6');
    await upload(p, (await say(p, dev)).body.audio_upload.token, webm());
    r2.failDeletes = true;
    const off = await voiceOn(p, g, 'kid-v6', false);
    expect(off.body.voice_purge).toEqual({ deleted: 0, pending: 1 });
    expect(r2.objects.size).toBe(1);
    expect((p as any).sql.get("select count(*) as n from voice_clips where player_id = 'kid-v6'").n).toBe(0);
    const failed = await call(p, 'POST', '/internal/cron', { cron: '0 * * * *' }, { 'x-lcw-internal': 'cron', 'content-type': 'application/json' });
    expect(failed.body.voice).toMatchObject({ failed: 1, left: 1 });
    r2.failDeletes = false;
    const ok = await call(p, 'POST', '/internal/cron', { cron: '0 * * * *' }, { 'x-lcw-internal': 'cron', 'content-type': 'application/json' });
    expect(ok.body.voice).toMatchObject({ deleted: 1, left: 0 });
    expect(r2.objects.size).toBe(0);
    const runs = (p as any).sql.all("select ok from ops_runs where task = 'hourly_voice_purge' order by at");
    expect(runs.map((r: { ok: number }) => r.ok)).toEqual([0, 1]);
  });

  it('consent turned off between the turn and the upload stores nothing', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v7', 'fam-v7');
    const dev = await device(p, g, 'kid-v7');
    await voiceOn(p, g, 'kid-v7');
    const t = await say(p, dev);
    await voiceOn(p, g, 'kid-v7', false);
    await voiceOn(p, g, 'kid-v7', true);
    // the old token was voided by the revoke even though consent is on again
    expect((await upload(p, t.body.audio_upload.token, webm())).status).toBe(401);
    expect(r2.objects.size).toBe(0);
  });

  it('daily retention: 12 months after the last seat ended the clips go; before that they stay', async () => {
    const { p, r2 } = setup();
    const now = Date.now();
    for (const [pid, endedAgo] of [
      ['kid-old', VOICE_KEEP_AFTER_SEAT_MS + DAY],
      ['kid-new', VOICE_KEEP_AFTER_SEAT_MS - DAY]
    ] as const) {
      const g = await family(p, pid, `fam-${pid}`);
      const dev = await device(p, g, pid);
      await voiceOn(p, g, pid);
      await upload(p, (await say(p, dev)).body.audio_upload.token, webm());
      (p as any).sql.run(
        "insert into seats (id, payer_id, player_id, plan, period, starts_at, ends_at, status) values (?, ?, ?, 'solo', 'month', ?, ?, 'active')",
        [`seat-${pid}`, `g-fam-${pid}`, pid, now - endedAgo - 30 * DAY, now - endedAgo]
      );
    }
    expect(r2.objects.size).toBe(2);
    const r = await call(p, 'POST', '/internal/cron', { cron: '0 3 * * *' }, { 'x-lcw-internal': 'cron', 'content-type': 'application/json' });
    expect(r.body.voice).toMatchObject({ expired_players: 1, deleted: 1, left: 0 });
    expect(r2.objects.size).toBe(1);
    expect((p as any).sql.all('select player_id from voice_clips').map((x: { player_id: string }) => x.player_id)).toEqual(['kid-new']);
    expect((p as any).sql.get("select ok from ops_runs where task = 'daily_voice_retention'").ok).toBe(1);
  });

  it('lesson turns get the same offer; /v1/join tells the device whether to record', async () => {
    const { p, r2 } = setup();
    const g = await family(p, 'kid-v8', 'fam-v8');
    const s = await call(p, 'POST', '/v1/admin/lessons/start', { player_id: 'kid-v8' });
    const j0 = await call(p, 'POST', '/v1/join', { code: s.body.join_code }, anon);
    expect(j0.body.voice_store).toBe(false);
    const st0 = bearer(j0.body.student_token);
    expect((await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like drawing', dur_ms: 2000 }, st0)).body.audio_upload).toBeUndefined();
    await voiceOn(p, g, 'kid-v8');
    const u = await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like drawing because it is fun', dur_ms: 3000 }, st0);
    expect(u.status).toBe(200);
    expect((await upload(p, u.body.audio_upload.token, webm())).status).toBe(201);
    expect(r2.objects.size).toBe(1);
    const typed = await call(p, 'POST', '/v1/lesson/utterance', { transcript: 'i like drawing', dur_ms: 2000, stt_source: 'keyboard' }, st0);
    expect(typed.body.audio_upload).toBeUndefined();
  });
});
