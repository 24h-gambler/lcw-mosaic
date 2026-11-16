import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CHOICE, WORLD_BUDDIES, WORLD_SEASONS, WORLD_TIMES, cleanWorldName, randomWorldChoice, readWorldChoice, readWorldSetup } from '@lcw/content';
import { startFlowFor } from '../App.js';
import { GUEST_WORLD_KEY, cleanLessonCode, joinDeviceLesson, lessonLive, liveLessonId, loadMyWorld, makeMyWorld, titleActions, type FetchLike, type KeyStore } from '../start/api.js';
import { revealCards } from '../start/StartFlow.js';
import { BIOME_NAMES_KO, START_STRINGS, ro } from '../start/strings.js';
import { buddyTarget } from '../world/buddy.js';
import { mod } from '../world/season.js';
import { TEACHER_NPC_ID, cleanTeacherName, pickableNpc, plateText, teacherDef, teacherTarget } from '../world/visitor.js';
import type { PlayerIdentity } from '../world/identity.js';

const child: PlayerIdentity = { kind: 'child', token: 'dev-token-0123456789abcdef0123456789', nickname: '지우', level: 'L1', playAllowed: true } as PlayerIdentity;
const guest: PlayerIdentity = { kind: 'guest' } as PlayerIdentity;
const lesson: PlayerIdentity = { kind: 'lesson', code: '123456' } as PlayerIdentity;

function memStore(): KeyStore & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
function fakeFetch(routes: Record<string, (init?: RequestInit) => [number, unknown]>): FetchLike & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const [status, body] = h(init);
    return new Response(JSON.stringify(body), { status });
  }) as FetchLike & { calls: typeof calls };
  f.calls = calls;
  return f;
}
const world = { name: '지우의 마을', season: 'winter', time: 'sunset', buddy: 'bunny', seed: '0123456789abcdef' } as const;

describe('world setup (packages/content, G07)', () => {
  it('takes a child name of Hangul, letters and digits up to 12, and refuses the rest', () => {
    expect(cleanWorldName('  지우의   마을 ')).toBe('지우의 마을');
    expect(cleanWorldName('Mia Town 2')).toBe('Mia Town 2');
    for (const bad of ['', '   ', 'http://x.y', '<b>', '가'.repeat(13), 42, null]) expect(cleanWorldName(bad)).toBeNull();
    expect(readWorldChoice({ name: '마을', season: 'monsoon', time: 'noon', buddy: 'puppy' })).toBeNull();
    expect(readWorldSetup({ ...world, seed: 'NOT-HEX' })).toBeNull();
    expect(readWorldSetup(world)).toEqual(world);
  });

  it('the dice picks only known options, and every option has Korean words', () => {
    for (const r of [0, 0.34, 0.67, 0.9999]) {
      const c = randomWorldChoice(() => r);
      expect(WORLD_SEASONS.map((o) => o.id)).toContain(c.season);
      expect(WORLD_TIMES.map((o) => o.id)).toContain(c.time);
      expect(WORLD_BUDDIES.map((o) => o.id)).toContain(c.buddy);
    }
    for (const o of [...WORLD_SEASONS, ...WORLD_TIMES, ...WORLD_BUDDIES]) expect(o.labelKo.length).toBeGreaterThan(0);
  });
});

describe('start flow data (docs/08 §8.4 G07, Dan 11-16 R2555)', () => {
  it('opens unless the address is a lesson, the tab holds a lesson session, or a test link names a scene', () => {
    expect(startFlowFor('', false)).toBe(true);
    expect(startFlowFor('?tier=low', false)).toBe(true);
    expect(startFlowFor('?code=123456', false)).toBe(false);
    expect(startFlowFor('', true)).toBe(false);
    expect(startFlowFor('?scene=cafe', false)).toBe(false);
  });

  it('a guest keeps the world on this device; a second visit finds it', async () => {
    const store = memStore();
    const f = fakeFetch({});
    expect(await loadMyWorld(guest, store, f)).toEqual({ made: false });
    const w = await makeMyWorld(guest, { name: '마을', season: 'spring', time: 'noon', buddy: 'chick' }, store, f, '', () => 'abcdef0123456789');
    expect(w).toEqual({ name: '마을', season: 'spring', time: 'noon', buddy: 'chick', seed: 'abcdef0123456789' });
    expect(JSON.parse(store.m.get(GUEST_WORLD_KEY)!)).toEqual(w);
    expect(await loadMyWorld(guest, store, f)).toEqual({ made: true, world: w });
    expect(f.calls).toHaveLength(0);
  });

  it('a signed-in child asks the server with the device token; the server seed wins, 409 opens the made world', async () => {
    const f = fakeFetch({
      'GET /v1/my-world': () => [200, { made: false }],
      'POST /v1/my-world': () => [409, { error: 'world_already_made', world }]
    });
    expect(await loadMyWorld(child, null, f)).toEqual({ made: false });
    expect(f.calls[0]!.init?.headers).toMatchObject({ authorization: `Bearer ${(child as { token: string }).token}` });
    expect(await makeMyWorld(child, { name: '다른 이름', season: 'spring', time: 'noon', buddy: 'puppy' }, null, f)).toEqual(world);
    const down = fakeFetch({ 'POST /v1/my-world': () => [500, { error: 'x' }] });
    expect(await makeMyWorld(child, { name: '마을', season: 'spring', time: 'noon', buddy: 'puppy' }, null, down)).toBeNull();
    expect(await loadMyWorld(child, null, down)).toEqual({ made: 'unknown' });
  });

  it('the lesson button shows only for a signed-in child while the teacher lesson is live', async () => {
    expect(titleActions(null, null, false)).toEqual(['wait']);
    expect(titleActions(child, { made: false }, true)).toEqual(['lesson', 'make']);
    expect(titleActions(child, { made: true, world }, false)).toEqual(['continue']);
    expect(titleActions(guest, { made: false }, true)).toEqual(['make']);
    // offline: never a dead end
    expect(titleActions(child, { made: 'unknown' }, false)).toEqual(['continue']);
    const live = fakeFetch({ 'GET /v1/device/lesson': () => [200, { live: true, lesson_id: 'l1', started_at: 1 }] });
    expect(await lessonLive(child, live)).toBe(true);
    expect(await liveLessonId(child, live)).toBe('l1');
    expect(await liveLessonId(child, fakeFetch({ 'GET /v1/device/lesson': () => [200, { live: false }] }))).toBeNull();
    // live without an id never auto-joins (it could not be told from the lesson already joined)
    expect(await liveLessonId(child, fakeFetch({ 'GET /v1/device/lesson': () => [200, { live: true }] }))).toBeNull();
    expect(await lessonLive(guest, live)).toBe(false);
    expect(await lessonLive(lesson, live)).toBe(false);
    // the sign-up lane's routes not deployed yet: 404 reads as "no lesson", never an error on screen
    expect(await lessonLive(child, fakeFetch({}))).toBe(false);
  });

  it('들어가기 gives the same student session as a join code', async () => {
    const f = fakeFetch({
      'POST /v1/device/lesson/join': () => [200, { student_token: 's'.repeat(40), lesson_id: 'l1', player_id: 'p1', nickname: '지우', level: 'L2', voice_store: true }]
    });
    expect(await joinDeviceLesson(child, f)).toEqual({ token: 's'.repeat(40), lessonId: 'l1', nickname: '지우', level: 'L2', voiceStore: true });
    expect(await joinDeviceLesson(guest, f)).toBeNull();
    expect(await joinDeviceLesson(child, fakeFetch({ 'POST /v1/device/lesson/join': () => [404, { error: 'no_live_lesson' }] }))).toBeNull();
    expect(cleanLessonCode('12 34-56')).toBe('123456');
    expect(cleanLessonCode('12345')).toBeNull();
  });

  it('reveals nine places: the town in the middle named after the world, eight named places around it', () => {
    const cards = revealCards(world);
    expect(cards).toHaveLength(9);
    expect(cards.filter((c) => c.home)).toHaveLength(1);
    expect(cards[4]!.home).toBe(true);
    expect(cards[4]!.name).toBe('지우의 마을');
    for (const c of cards.filter((x) => !x.home)) expect(Object.values(BIOME_NAMES_KO).map((b) => b.name)).toContain(c.name);
    // the same seed always draws the same world; another seed another world
    expect(revealCards(world)).toEqual(cards);
    const others = ['00000001', 'deadbeef', 'cafe0123', '13572468'].map((seed) => revealCards({ ...world, seed }).map((c) => c.key).join());
    expect(new Set([cards.map((c) => c.key).join(), ...others]).size).toBeGreaterThan(1);
  });

  it('Korean particles follow the world name, and no start word says the forbidden word', () => {
    expect(START_STRINGS.continueWorld('지우의 마을')).toBe('지우의 마을로 가기');
    expect(START_STRINGS.continueWorld('하늘섬')).toBe('하늘섬으로 가기');
    expect(START_STRINGS.continueWorld('Mia Town')).toBe('Mia Town 열기');
    expect(START_STRINGS.reveal.title('하늘섬')).toBe('하늘섬 완성!');
    expect(ro('바다')).toBe('로');
    expect(ro('Town')).toBeNull();
    const all = JSON.stringify(START_STRINGS) + JSON.stringify(BIOME_NAMES_KO);
    expect(all).not.toMatch(/게임|원|₩|\$/);
    expect(DEFAULT_WORLD_CHOICE.season).toBe('spring');
  });
});

describe('world look pieces', () => {
  it('the animal friend stands a step ahead and beside the player (seen in first person), never on the player', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -2]) {
      const t = buddyTarget(10, 20, yaw);
      const d = Math.hypot(t.x - 10, t.z - 20);
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(2.6);
      // ahead: in front of the player's facing, and to one side
      expect((t.x - 10) * Math.sin(yaw) + (t.z - 20) * Math.cos(yaw)).toBeGreaterThan(2);
    }
    expect(mod(-1, 22)).toBe(21);
    expect(mod(45, 22)).toBe(1);
  });
});

describe('the teacher in my world (Dan 11-16 12:10)', () => {
  it('is NPC teacher with a name plate, standing a few steps from the child and never on them', () => {
    const d = teacherDef('  Ms.   Kim ');
    expect(d.id).toBe(TEACHER_NPC_ID);
    expect(d.nameEn).toBe('Ms. Kim');
    expect(plateText('Ms. Kim')).toBe('Ms. Kim 선생님');
    expect(plateText('')).toBe('선생님');
    expect(plateText('선생님')).toBe('선생님');
    expect(plateText('김 선생님')).toBe('김 선생님');
    expect(teacherDef('선생님').nameKo).toBe('선생님');
    expect(teacherDef('').nameKo).toBe('선생님');
    expect([...cleanTeacherName('가'.repeat(30))]).toHaveLength(16);
    const t = teacherTarget(10, 20, 0, 10, 20)!;
    expect(Math.hypot(t[0] - 10, t[1] - 20)).toBeCloseTo(2.4, 5);
    // in front of the child's facing (seen in first person)
    expect(t[1] - 20).toBeGreaterThan(1);
    // already close enough: stays put
    expect(teacherTarget(10, 20, 0, 12, 21)).toBeNull();
    expect(teacherTarget(10, 20, 0, 18, 20)).not.toBeNull();
  });

  it('is never what E, a tap or the dialog frame picks, so the stage NPC answers in a lesson', () => {
    expect(pickableNpc(teacherDef('Kim'), true)).toBe(false);
    expect(pickableNpc(teacherDef('Kim'), false)).toBe(false);
    expect(pickableNpc({ id: 'cafe_owner' }, true)).toBe(true);
    expect(pickableNpc({ id: 'errand_neighbor', soloOnly: true }, true)).toBe(false);
    expect(pickableNpc({ id: 'errand_neighbor', soloOnly: true }, false)).toBe(true);
  });
});
