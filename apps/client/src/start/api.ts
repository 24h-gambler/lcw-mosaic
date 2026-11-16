/**
 * Start flow data (docs/08 §8.4 G07, Dan 11-16 R2555): my world (server for a signed-in child, this device for a
 * guest) and the signed-in student's live lesson (student sign-up lane: GET /v1/device/lesson, POST
 * /v1/device/lesson/join). Pure functions over a fetch and a key store, so the flow is tested without a browser.
 */
import { readLearnLang, readWorldSetup, type LearnLang, type WorldSetup, type WorldSetupChoice } from '@lcw/content';
import type { PlayerIdentity } from '../world/identity.js';

export const GUEST_WORLD_KEY = 'lcw.myWorld';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What the start screen knows about my world: made (with its setup), not made yet, or unknown (offline); and the
 * language the child learns as the server keeps it (null before the child chose, or unknown).
 */
export type MyWorldState = ({ made: true; world: WorldSetup } | { made: false } | { made: 'unknown' }) & { learnLang?: LearnLang | null };

const auth = (token: string) => ({ authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' });

export function readGuestWorld(store: KeyStore | null): WorldSetup | null {
  try {
    const raw = store?.getItem(GUEST_WORLD_KEY);
    return raw ? readWorldSetup(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** A device seed for a guest world: 16 hex characters from the browser's random source. */
export function deviceSeed(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(rand(8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * My world as the server keeps it for a signed-in child. A guest has none (Dan 11-16 14:3x: no world before sign-up;
 * the trial is /try), so a guest never asks.
 */
export async function loadMyWorld(id: PlayerIdentity | null, _store: KeyStore | null, fetchFn: FetchLike, base = ''): Promise<MyWorldState> {
  if (id?.kind !== 'child') return { made: 'unknown' };
  try {
    const res = await fetchFn(`${base}/v1/my-world`, { headers: auth(id.token), cache: 'no-store' });
    if (!res.ok) return { made: 'unknown' };
    const body = (await res.json()) as { made?: unknown; world?: unknown; learn_lang?: unknown };
    const w = body.made === true ? readWorldSetup(body.world) : null;
    const learnLang = readLearnLang(body.learn_lang);
    return w ? { made: true, world: w, learnLang } : body.made === false ? { made: false, learnLang } : { made: 'unknown' };
  } catch {
    return { made: 'unknown' };
  }
}

/** Keep the language the child learns with the child (any device of theirs then speaks it). False when not kept. */
export async function saveLearnLang(id: PlayerIdentity | null, lang: LearnLang, fetchFn: FetchLike, base = ''): Promise<boolean> {
  if (id?.kind !== 'child') return false;
  try {
    const res = await fetchFn(`${base}/v1/my-world/lang`, { method: 'POST', headers: auth(id.token), body: JSON.stringify({ learn_lang: lang }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Make my world: a signed-in child only (the server picks the seed). A guest cannot make one (null). */
export async function makeMyWorld(
  id: PlayerIdentity | null,
  choice: WorldSetupChoice & { name: string },
  _store: KeyStore | null,
  fetchFn: FetchLike,
  base = ''
): Promise<WorldSetup | null> {
  if (id?.kind !== 'child') return null;
  try {
    const res = await fetchFn(`${base}/v1/my-world`, { method: 'POST', headers: auth(id.token), body: JSON.stringify(choice) });
    // 409: another device of the same child made it a moment ago; that world is the child's world.
    if (!res.ok && res.status !== 409) return null;
    const body = (await res.json()) as { world?: unknown };
    return readWorldSetup(body.world);
  } catch {
    return null;
  }
}

/** The id of my teacher's lesson running now (signed-in child devices only); null = none. Errors read as none. */
export async function liveLessonId(id: PlayerIdentity | null, fetchFn: FetchLike, base = ''): Promise<string | null> {
  if (id?.kind !== 'child') return null;
  try {
    const res = await fetchFn(`${base}/v1/device/lesson`, { headers: auth(id.token), cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { live?: unknown; lesson_id?: unknown };
    // no id, no auto-join: without it a running lesson cannot be told from the next one (it would join every poll)
    return body.live === true && typeof body.lesson_id === 'string' && body.lesson_id ? body.lesson_id : null;
  } catch {
    return null;
  }
}

export async function lessonLive(id: PlayerIdentity | null, fetchFn: FetchLike, base = ''): Promise<boolean> {
  return (await liveLessonId(id, fetchFn, base)) !== null;
}

export interface DeviceLessonSession {
  token: string;
  lessonId: string;
  nickname: string;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
  voiceStore: boolean;
}

/** '들어가기': the same student session a join code gives, for this device's child (null = no lesson now). */
export async function joinDeviceLesson(id: PlayerIdentity | null, fetchFn: FetchLike, base = ''): Promise<DeviceLessonSession | null> {
  if (id?.kind !== 'child') return null;
  try {
    const res = await fetchFn(`${base}/v1/device/lesson/join`, { method: 'POST', headers: auth(id.token), body: '{}' });
    if (!res.ok) return null;
    const b = (await res.json()) as Record<string, unknown>;
    if (typeof b.student_token !== 'string' || typeof b.lesson_id !== 'string') return null;
    const level = typeof b.level === 'string' && /^L[1-6]$/.test(b.level) ? (b.level as DeviceLessonSession['level']) : 'L1';
    return { token: b.student_token, lessonId: b.lesson_id, nickname: typeof b.nickname === 'string' ? b.nickname : '', level, voiceStore: b.voice_store === true };
  } catch {
    return null;
  }
}

/** A typed lesson code, digits only; null unless exactly six. */
export function cleanLessonCode(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  return d.length === 6 ? d : null;
}

/**
 * Where the title screen starts the child (pure; the screen renders this). A guest gets sign-up, sign-in and the
 * trial only (Dan 11-16 14:3x: no world before sign-up); a signed-in child their lesson, or making / entering their world.
 */
export type TitleAction = 'lesson' | 'continue' | 'make' | 'wait' | 'signup';
export function titleActions(id: PlayerIdentity | null, world: MyWorldState | null, live: boolean): TitleAction[] {
  if (id?.kind === 'guest') return ['signup'];
  if (!id || !world) return ['wait'];
  const out: TitleAction[] = [];
  if (live && id.kind === 'child') out.push('lesson');
  // offline with no answer: let the child in (the world opens with the default look) rather than a dead button
  out.push(world.made === false ? 'make' : 'continue');
  return out;
}

/** Where a guest signs up, signs in on another device (the sign-up lane: /signup?mode=signin), or tries. */
export const SIGN_UP_PATH = '/signup';
export const SIGN_IN_PATH = '/signup?mode=signin';
export const TRY_PATH = '/try';
