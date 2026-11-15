/**
 * Guardian and child-device API client (WP-301; server: apps/edge/src/family.ts). Tokens live on the device in
 * localStorage behind try/catch: a private window simply asks for the invite link again.
 */
import type { LessonWindowStatus } from '@lcw/schemas';
import { LessonApiError, NETWORK_ERROR_CODE, localStore, readKey, writeKey, type FetchLike, type KeyValue } from './lessonApi.js';

export const GUARDIAN_TOKEN_KEY = 'lcw.guardianToken';
export const DEVICE_TOKEN_KEY = 'lcw.deviceToken';
export const DEVICE_NICKNAME_KEY = 'lcw.deviceNickname';

export const GUARDIAN_CONSENT_SCOPES = ['voice_store', 'lesson_window', 'showroom_public', 'public_server', 'friend_voice'] as const;
export type GuardianConsentScope = (typeof GUARDIAN_CONSENT_SCOPES)[number];

export interface FamilyReport {
  share_path: string;
  lesson_day: string;
  created_at: number;
  opened: boolean;
  expired: boolean;
  revoked: boolean;
}
export interface FamilyDevice {
  id: string;
  label: string;
  created_at: number;
  last_seen_at: number | null;
}
export interface FamilyChild {
  player_id: string;
  nickname: string;
  level: string;
  birth_year: number | null;
  consents: Record<GuardianConsentScope, boolean>;
  devices: FamilyDevice[];
  lessons: number;
  last_lesson_at: number | null;
  reports: FamilyReport[];
}
export interface LessonWindowCaption {
  id: string;
  at: number;
  who: 'child' | 'teacher';
  speaker_ko: string;
  text: string;
  pass?: boolean;
  stars?: number;
}
export interface LessonWindowPayload {
  live: boolean;
  status: LessonWindowStatus | null;
  started_at: number | null;
  minutes: Array<{ minute: number; student_ms: number; teacher_ms: number }>;
  captions: LessonWindowCaption[];
  next_lesson_at: string | null;
  audio: { direction: 'recvonly'; available: boolean; reason: string | null };
  poll_ms: number;
  server_now: number;
}
export interface DashboardWeek {
  week_start: number;
  free_words: number;
  speaking_min: number;
  free_utterances: number;
  speech_wpm: number | null;
  response_sec: number | null;
  mean_words: number | null;
  connectors_per_100: number | null;
  think_speak: number | null;
  think_speak_4w: number | null;
  modes: Record<'lesson' | 'solo', { free: number; guided: number; read: number; recall: number }>;
  lesson_days: number;
  play_days: number;
  cum_free_words: number;
  cum_vocab: number;
  cum_mastered: number;
}
export interface DashboardPayload {
  child: { nickname: string; level: string };
  series: {
    weeks: DashboardWeek[];
    projection: Record<'cum_free_words' | 'cum_vocab' | 'cum_mastered', Array<{ week_start: number; value: number }>>;
    calendar: Array<{ day: string; free_words: number }>;
    connectors: Array<{ expr: string; count: number }>;
    has_data: boolean;
  };
  week_line: { text: string; words: number; at: number } | null;
  review: Array<{ text: string; due_at: number }>;
  lessons: Array<{
    id: string;
    started_at: number;
    ended_at: number | null;
    duration_min: number;
    student_min: number;
    teacher_min: number;
    student_share: number | null;
    utterances: number;
    passes: number;
    report_path: string | null;
  }>;
  next_lesson_at: string | null;
  lesson_live: boolean;
  lesson_window_on: boolean;
  voice_store_on: boolean;
  server_now: number;
}
export interface FamilyMe {
  service_consented: boolean;
  children: FamilyChild[];
}

export function createFamilyApi(opts: { fetch?: FetchLike; base?: string } = {}) {
  const base = opts.base ?? '';
  const doFetch: FetchLike = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token: string | null, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new LessonApiError(NETWORK_ERROR_CODE, 0);
    }
    let data: unknown = null;
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const code =
        data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `http_${res.status}`;
      throw new LessonApiError(code, res.status);
    }
    return data as T;
  }
  const enc = encodeURIComponent;
  return {
    startSession: (invite: string) => request<{ guardian_token: string; expires_at: number }>('POST', '/v1/family/session', null, { invite }),
    logout: (g: string) => request<{ ok: boolean }>('POST', '/v1/family/logout', g, {}),
    me: (g: string) => request<FamilyMe>('GET', '/v1/family/me', g),
    acceptService: (g: string) => request<{ ok: boolean }>('POST', '/v1/family/service-consent', g, { granted: true }),
    setConsent: (g: string, playerId: string, scope: GuardianConsentScope, granted: boolean) =>
      request<{ scope: string; active: boolean }>('PUT', `/v1/family/children/${enc(playerId)}/consents/${scope}`, g, { granted }),
    addChild: (g: string, input: { nickname: string; birth_year: number }) =>
      request<{ player_id: string }>('POST', '/v1/family/children', g, input),
    deviceCode: (g: string, playerId: string) =>
      request<{ code: string; expires_at: number }>('POST', `/v1/family/children/${enc(playerId)}/device-code`, g, {}),
    removeDevice: (g: string, id: string) => request<{ ok: boolean }>('DELETE', `/v1/family/devices/${enc(id)}`, g),
    revokeReport: (g: string, sharePath: string) =>
      request<{ ok: boolean }>('POST', `/v1/family/reports/${enc(sharePath.replace(/^\/r\//, ''))}/revoke`, g, {}),
    linkDevice: (code: string, label: string) =>
      request<{ device_token: string; nickname: string; level: string }>('POST', '/v1/device/link', null, { code, label }),
    dashboard: (g: string, playerId: string) => request<DashboardPayload>('GET', `/v1/family/children/${enc(playerId)}/dashboard`, g),
    lessonWindow: (g: string, playerId: string, after = 0) =>
      request<LessonWindowPayload>('GET', `/v1/family/children/${enc(playerId)}/lesson-window${after > 0 ? `?after=${after}` : ''}`, g),
    deviceMe: (d: string) => request<{ nickname: string; level: string; voice_store: boolean }>('GET', '/v1/device/me', d)
  };
}
export type FamilyApi = ReturnType<typeof createFamilyApi>;

/** `#k=<48 hex>` from the invite link, or null. */
export function inviteFromHash(hash: string): string | null {
  const m = /(?:^#|&)k=([0-9a-f]{48})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

export const loadGuardianToken = (store: KeyValue | null = localStore()) => readKey(store, GUARDIAN_TOKEN_KEY);
export const saveGuardianToken = (t: string | null, store: KeyValue | null = localStore()) => writeKey(store, GUARDIAN_TOKEN_KEY, t);
export const loadDevice = (store: KeyValue | null = localStore()) => ({
  token: readKey(store, DEVICE_TOKEN_KEY),
  nickname: readKey(store, DEVICE_NICKNAME_KEY)
});
export function saveDevice(token: string | null, nickname: string | null, store: KeyValue | null = localStore()): boolean {
  return writeKey(store, DEVICE_TOKEN_KEY, token) && writeKey(store, DEVICE_NICKNAME_KEY, nickname);
}
