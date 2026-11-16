/**
 * Guardian and child-device API client (WP-301; server: apps/edge/src/family.ts). Tokens live on the device in
 * localStorage behind try/catch: a private window simply asks for the invite link again.
 */
import type { LessonWindowStatus } from '@lcw/schemas';
import type { DashboardSeries } from '@lcw/metrics';
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
/** A voice clip under a report (edge voice.ts reportClips): the guardian's own device only, URL valid 15 minutes. */
export interface ReportClip {
  id: string;
  text: string;
  at: number;
  dur_ms: number;
  stars: number;
  url: string;
}
export interface ReportClips {
  voice_store: boolean;
  clips: ReportClip[];
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
  audio: {
    direction: 'recvonly';
    available: boolean;
    reason: string | null;
    /** Changes when the teacher republishes (a listening window reconnects). */
    stream_id?: string | null;
    /** The polling window's own listener: 'closed' → the server hung it up (republish, consent off). */
    listener?: 'open' | 'closed' | null;
  };
  poll_ms: number;
  server_now: number;
}
/** The dashboard series type comes from where it is computed (packages/metrics), so the screen cannot drift. */
export type { DashboardWeek, DashboardSeries, DashboardBaseline } from '@lcw/metrics';
export interface DashboardPayload {
  child: { nickname: string; level: string };
  series: DashboardSeries;
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
export type SeatState = 'active' | 'expiring' | 'read_only' | 'archived' | 'refunded';
export type SeatRefundMode = 'refund_difference' | 'convert_to_solo_days';
export interface FamilySeat {
  id: string;
  /** null for the other family's Duo seat: no name, no id. */
  child: { player_id: string; nickname: string } | null;
  plan: 'solo' | 'duo' | 'tutoring' | string;
  term: 'month' | 'year' | string;
  starts_at: number;
  ends_at: number;
  state: SeatState;
  read_only_until: number | null;
  is_payer: boolean;
  /** Payment history (issue + paid extensions), newest first. Only for the payer. */
  payments: SeatPayment[] | null;
  /** Exclusive end of the refund window (KST 24:00 of the 7th day after payment); show `refund_until - 1`'s date. */
  refund_until: number | null;
  /** First use of the seat (server record: world opened, solo play, or a tutoring lesson). From then on no refund. */
  first_used_at: number | null;
  /** In the refund window and not used yet. */
  refundable: boolean;
  /** Why a live seat cannot be refunded by the rule: used, or past the 7 days (null when refundable or not live). */
  refund_block: 'seat_used' | 'outside_refund_window' | 'nothing_paid' | null;
  can_request_refund: boolean;
  pending_request: { id: string; requested_at: number; status: 'pending' | 'review'; awaiting_payer_choice: boolean } | null;
  /** The payer must choose how the Duo partial refund is settled (the other family asked). */
  can_choose_mode: boolean;
  notice: { kind: '7d' | '1d' | 'expired' | string; at: number } | null;
  /** Payer of a live Duo inside the 7 days: the two ways one seat can leave. */
  duo_options: { refund_difference_krw: number; solo_days: number } | null;
}
export interface SeatPayment {
  order_id: string;
  kind: 'issue' | 'extend';
  plan: string;
  days: number | null;
  amount_krw: number;
  paid_at: number;
  refund_until: number;
  refunded_krw: number;
  refunded: boolean;
  /** This payment's days have been used (the seat's first use; for an extension, use from its first day). */
  used: boolean;
}
export interface AdminSeat {
  id: string;
  player_id: string;
  nickname: string;
  plan: string;
  term: string;
  starts_at: number;
  ends_at: number;
  state: SeatState;
  payer_id: string;
  payments: SeatPayment[];
  /** First use of the seat (server record) and how ('world' | 'play' | 'lesson'); null before use. */
  first_used_at: number | null;
  first_used_via: string | null;
  /** The rule refund button applies now (a payment is inside its window, not used, not tutoring). */
  rule_refund_open: boolean;
  /** Duo partial refund cannot run until the payer chooses the settlement. */
  awaiting_payer_choice: boolean;
}
export interface SeatInboxItem {
  id: string;
  seat_id: string;
  requested_by: string;
  requested_at: number;
  mode: SeatRefundMode | null;
  status: 'pending' | 'review';
  reason: string | null;
  note: string;
  plan: string;
  nickname: string | null;
  paid_at: number;
  amount_krw: number;
  term: string;
  usage: { lessons: number; utterances: number };
  refund_until: number;
  /** First use of the seat; a request made after it never reaches the inbox, one made before is judged as of then. */
  first_used_at: number | null;
  awaiting_payer_choice: boolean;
}
export interface SeatInbox {
  requests: SeatInboxItem[];
  expiring: Array<{ id: string; player_id: string; nickname: string; plan: string; term: string; ends_at: number }>;
}
export interface IssueSeatInput {
  payer_player_id: string;
  plan: 'solo' | 'duo' | 'tutoring';
  term: 'month' | 'year';
  player_ids: string[];
  amount_krw?: number;
  paid_at?: number;
  note?: string;
}
export interface ListenStart {
  listener_id: string;
  sdp: string;
  ice_servers: RTCIceServer[];
  stream_id: string;
}
export interface PushState {
  public_key: string;
  devices: number;
  this_device: boolean;
  /** False until the operator turns sending on (notices are kept until then). */
  sending: boolean;
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
    reportClips: (g: string, shareToken: string) =>
      request<ReportClips>('GET', `/v1/family/reports/${enc(shareToken.replace(/^\/r\//, ''))}/clips`, g),
    revokeReport: (g: string, sharePath: string) =>
      request<{ ok: boolean }>('POST', `/v1/family/reports/${enc(sharePath.replace(/^\/r\//, ''))}/revoke`, g, {}),
    linkDevice: (code: string, label: string) =>
      request<{ device_token: string; nickname: string; level: string }>('POST', '/v1/device/link', null, { code, label }),
    dashboard: (g: string, playerId: string) => request<DashboardPayload>('GET', `/v1/family/children/${enc(playerId)}/dashboard`, g),
    lessonWindow: (g: string, playerId: string, after = 0, listener: string | null = null) => {
      const q = [after > 0 ? `after=${after}` : '', listener ? `listener=${enc(listener)}` : ''].filter(Boolean).join('&');
      return request<LessonWindowPayload>('GET', `/v1/family/children/${enc(playerId)}/lesson-window${q ? `?${q}` : ''}`, g);
    },
    // Live lesson sound, receive-only (lesson-audio.ts on the server, lessonAudio.ts here).
    listenStart: (g: string, playerId: string) =>
      request<ListenStart>('POST', `/v1/family/children/${enc(playerId)}/lesson-window/audio`, g, {}),
    listenAnswer: (g: string, playerId: string, listenerId: string, sdp: string) =>
      request<{ ok: boolean }>('PUT', `/v1/family/children/${enc(playerId)}/lesson-window/audio/${enc(listenerId)}`, g, { sdp }),
    listenStop: (g: string, playerId: string, listenerId: string) =>
      request<{ ok: boolean }>('DELETE', `/v1/family/children/${enc(playerId)}/lesson-window/audio/${enc(listenerId)}`, g),
    // Teacher console (operator token): publish the lesson sound one way.
    audioIce: (op: string, lessonId: string) => request<{ ice_servers: RTCIceServer[] }>('POST', `/v1/admin/lessons/${enc(lessonId)}/audio/ice`, op, {}),
    audioPublish: (op: string, lessonId: string, input: { sdp: string; mid: string }) =>
      request<{ sdp: string; stream_id: string }>('POST', `/v1/admin/lessons/${enc(lessonId)}/audio/publish`, op, input),
    audioBeat: (op: string, lessonId: string) => request<{ live: boolean; listeners: number }>('POST', `/v1/admin/lessons/${enc(lessonId)}/audio/beat`, op, {}),
    audioStop: (op: string, lessonId: string) =>
      request<{ ok: boolean; listeners_closed: number }>('POST', `/v1/admin/lessons/${enc(lessonId)}/audio/stop`, op, {}),
    pushState: (g: string, endpoint: string | null) =>
      request<PushState>('GET', `/v1/family/push${endpoint ? `?endpoint=${enc(endpoint)}` : ''}`, g),
    pushSubscribe: (g: string, sub: { endpoint: string; keys: { p256dh: string; auth: string }; label?: string }) =>
      request<{ id: string }>('POST', '/v1/family/push/subscribe', g, sub),
    pushUnsubscribe: (g: string, endpoint: string) => request<{ ok: boolean }>('POST', '/v1/family/push/unsubscribe', g, { endpoint }),
    pushTest: (g: string) => request<{ sending: boolean; sent: boolean }>('POST', '/v1/family/push/test', g, {}),
    deviceMe: (d: string) =>
      request<{ nickname: string; level: string; voice_store: boolean; play_allowed: boolean; seat: { state: SeatState } | null }>(
        'GET',
        '/v1/device/me',
        d
      ),
    seats: (g: string) => request<{ seats: FamilySeat[]; server_now: number }>('GET', '/v1/family/seats', g),
    requestRefund: (g: string, seatId: string, input: { mode?: SeatRefundMode; note?: string }) =>
      request<{ id: string; status: 'pending' | 'review'; mode?: SeatRefundMode; awaiting_payer_choice?: boolean }>(
        'POST',
        `/v1/family/seats/${enc(seatId)}/refund-request`,
        g,
        input
      ),
    // operator (lcw.operatorToken)
    adminSeats: (op: string) => request<AdminSeat[]>('GET', '/v1/admin/seats', op),
    adminSeatInbox: (op: string) => request<SeatInbox>('GET', '/v1/admin/seat-inbox', op),
    adminIssueSeat: (op: string, input: IssueSeatInput) =>
      request<{ order_id: string; seat_ids: string[]; amount_krw: number; ends_at: number; refund_until: number }>('POST', '/v1/admin/seats', op, input),
    adminExtendSeat: (op: string, seatId: string, input: { days: number; amount_krw?: number; paid_at?: number }) =>
      request<{ id: string; ends_at: number; amount_krw: number; refund_until: number }>('POST', `/v1/admin/seats/${enc(seatId)}/extend`, op, input),
    /** The rule button; a Duo settlement comes from the payer's request, never from here. */
    adminRefundSeat: (op: string, seatId: string) =>
      request<{
        refund_krw: number;
        mode?: SeatRefundMode;
        removed_days?: number;
        remaining_seat: { id: string; plan: string; ends_at: number; solo_days: number } | null;
      }>(
        'POST',
        `/v1/admin/seats/${enc(seatId)}/refund`,
        op,
        {}
      ),
    adminDecideRefund: (op: string, requestId: string, decision: { decision: 'decline' } | { decision: 'refund'; refund_krw: number }) =>
      request<{ id: string; status: string }>('POST', `/v1/admin/seat-refunds/${enc(requestId)}/decide`, op, decision),
    adminStudents: (op: string) => request<Array<{ player_id: string; nickname: string; family_id: string }>>('GET', '/v1/admin/students', op),
    /* sign-in with Google / Kakao (edge oauth.ts, guardian-oauth.ts) */
    oauthConfig: () => request<{ providers: OAuthProvider[]; google_client_id: string | null }>('GET', '/v1/oauth/config', null),
    /** `#oauth=<code>` → the sign-in result; works only in the browser that came back from the provider (cookie). */
    oauthExchange: (code: string) => request<{ result: string }>('POST', '/v1/oauth/exchange', null, { code }),
    signIns: (g: string) =>
      request<{ available: OAuthProvider[]; linked: Array<{ provider: OAuthProvider; linked_at: number; last_login_at: number }> }>('GET', '/v1/family/sign-in', g),
    linkSignIn: (g: string, provider: OAuthProvider) => request<{ start_path: string }>('POST', '/v1/family/sign-in/link', g, { provider }),
    unlinkSignIn: (g: string, provider: OAuthProvider) => request<{ ok: boolean }>('DELETE', `/v1/family/sign-in/${provider}`, g)
  };
}
export type FamilyApi = ReturnType<typeof createFamilyApi>;

export type OAuthProvider = 'google' | 'kakao';
export const OAUTH_ERROR_CODES = [
  'not_configured',
  'state_mismatch',
  'provider_error',
  'token_invalid',
  'cancelled',
  'ticket_invalid',
  'already_linked',
  'guardian_not_found',
  'handoff_invalid'
] as const;

/** Where the guardian's browser goes to sign in with a provider (the server answers with a redirect). */
export const oauthStartPath = (provider: OAuthProvider, ret = '/family') => `/v1/oauth/${provider}/start?role=guardian&return=${encodeURIComponent(ret)}`;

/**
 * What a sign-in left in the fragment: `#g=<64 hex>` a new guardian session, `#linked=<provider>` a sign-in added to
 * this family, `#oauth_error=<code>` why it did not work. Null when the fragment carries none of them.
 */
export function oauthResultFromHash(hash: string): { token: string } | { linked: OAuthProvider } | { error: string } | null {
  const g = /(?:^#|&)g=([0-9a-f]{64})(?:&|$)/.exec(hash);
  if (g) return { token: g[1]! };
  const l = /(?:^#|&)linked=(google|kakao)(?:&|$)/.exec(hash);
  if (l) return { linked: l[1] as OAuthProvider };
  const e = /(?:^#|&)oauth_error=([a-z_]{1,40})(?:&|$)/.exec(hash);
  if (e) return { error: (OAUTH_ERROR_CODES as readonly string[]).includes(e[1]!) ? e[1]! : 'provider_error' };
  return null;
}

/** `#oauth=<32 hex>`: the one-use code the server leaves after a provider sign-in, or null. */
export function oauthCodeFromHash(hash: string): string | null {
  return /(?:^#|&)oauth=([0-9a-f]{32})(?:&|$)/.exec(hash)?.[1] ?? null;
}

type OAuthResult = { token: string } | { linked: OAuthProvider } | { error: string };
/**
 * Back from Google / Kakao: read the fragment once and turn it into a result. A `#oauth=` code is exchanged with the
 * server (no token is ever in the address bar); `#oauth_error=` is read directly. Callers clear the fragment first.
 * Used by /family and /signup.
 */
export async function takeOAuthResult(api: Pick<FamilyApi, 'oauthExchange'>, hash: string): Promise<OAuthResult | null> {
  const code = oauthCodeFromHash(hash);
  if (!code) {
    const direct = oauthResultFromHash(hash);
    return direct && 'error' in direct ? direct : null;
  }
  try {
    const r = await api.oauthExchange(code);
    return oauthResultFromHash(`#${r.result}`) ?? { error: 'provider_error' };
  } catch (e) {
    return { error: e instanceof LessonApiError && e.code === 'handoff_invalid' ? 'handoff_invalid' : 'provider_error' };
  }
}

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
