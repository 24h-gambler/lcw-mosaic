/** Student sign-up on the guardian account (edge student-account.ts) and the teacher's approval queue. */
import { localStore, type KeyValue } from './lessonApi.js';

export const SIGNUP_CLAIM_KEY = 'lcw.signupClaim';
/** The 4 digits the waiting screen shows; the teacher types them in the console to approve (never listed there). */
export const SIGNUP_CHECK_KEY = 'lcw.signupCheck';
/** Where oauth.ts sends the adult back to: `/signup#oauth=<one-use code>` (exchanged, familyApi takeOAuthResult) or `#oauth_error=<code>`. */
export const SIGNUP_RETURN = '/signup';

export type OAuthProvider = 'google' | 'kakao';
export interface DeviceGrant {
  device_token: string;
  nickname: string;
  level: string;
  expires_at?: number;
}
export type SignupStatus =
  | { state: 'pending' | 'rejected' | 'expired' | 'undone' }
  | ({ state: 'approved' } & DeviceGrant)
  | { state: 'approved'; already_claimed: true };
export interface PendingSignup {
  id: string;
  nickname: string;
  created_at: number;
  expires_at: number;
  /** How the adult signed in: provider ('google' | 'kakao' | 'invite'), a masked hint, who they said they are. */
  signer?: { provider: string; hint: string; attest: AgeAttest | null };
  family_students: Array<{ player_id: string; nickname: string; linked_devices?: number }>;
}
/** The consenting adult (docs/16 §3): the child's guardian aged 19+, or the student aged 14+ themselves. */
export type AgeAttest = 'guardian_19' | 'self_14';
export interface FamilyChild {
  player_id: string;
  nickname: string;
  level: string;
}

export class StudentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export interface StudentAccountApi {
  oauthConfig(): Promise<{ providers: OAuthProvider[] }>;
  /** The adult's guardian session (in memory only on the student device). */
  familyMe(g: string): Promise<{ service_consented: boolean; children: FamilyChild[] }>;
  serviceConsent(g: string): Promise<unknown>;
  attest(g: string, who: AgeAttest): Promise<unknown>;
  guardianDeviceCode(g: string, playerId: string): Promise<{ code: string }>;
  logout(g: string): Promise<unknown>;
  signup(g: string, nickname: string, label: string): Promise<{ state: 'pending'; signup_id: string; claim_token: string; check: string; expires_at: number }>;
  linkDevice(code: string, label: string): Promise<DeviceGrant>;
  status(claim: string): Promise<SignupStatus>;
  // teacher (operator token)
  pending(op: string): Promise<{ signups: PendingSignup[] }>;
  approve(
    op: string,
    id: string,
    target: { player_id: string; check: string; confirm?: boolean } | { new_student: { level: string }; check: string }
  ): Promise<{ ok: true; player_id: string; nickname: string }>;
  recent(op: string): Promise<{ approved: Array<{ id: string; player_id: string; nickname: string; decided_at: number; moved: boolean }> }>;
  undo(op: string, id: string): Promise<{ ok: true; player_id: string; moved_back: boolean }>;
  reject(op: string, id: string): Promise<{ ok: true }>;
  deviceCode(op: string, playerId: string): Promise<{ code: string; expires_at: number; link_path: string }>;
}

export function createStudentAccountApi(base = '', fetchFn: typeof fetch = (...a) => fetch(...a)): StudentAccountApi {
  async function request<T>(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new StudentApiError(res.status, String(json.error ?? `http_${res.status}`), json);
    return json as T;
  }
  const enc = encodeURIComponent;
  return {
    oauthConfig: async () => {
      try {
        const c = await request<{ providers?: unknown }>('GET', '/v1/oauth/config', null);
        const ps = Array.isArray(c.providers) ? c.providers.filter((x): x is OAuthProvider => x === 'google' || x === 'kakao') : [];
        return { providers: ps };
      } catch {
        // Older server (no OAuth module yet): no sign-in buttons, the lesson code path stays.
        return { providers: [] };
      }
    },
    familyMe: (g) => request('GET', '/v1/family/me', g),
    serviceConsent: (g) => request('POST', '/v1/family/service-consent', g, { granted: true }),
    attest: (g, who) => request('POST', '/v1/student/attest', g, { who }),
    guardianDeviceCode: (g, playerId) => request('POST', `/v1/family/children/${enc(playerId)}/device-code`, g, {}),
    logout: (g) => request('POST', '/v1/family/logout', g, {}),
    signup: (g, nickname, label) => request('POST', '/v1/student/signup', g, { nickname, label }),
    linkDevice: (code, label) => request('POST', '/v1/device/link', null, { code, label }),
    status: (claim) => request('GET', '/v1/student/signup/status', claim),
    pending: (op) => request('GET', '/v1/admin/student-signups', op),
    approve: (op, id, target) => request('POST', `/v1/admin/student-signups/${enc(id)}/approve`, op, target),
    reject: (op, id) => request('POST', `/v1/admin/student-signups/${enc(id)}/reject`, op, {}),
    recent: (op) => request('GET', '/v1/admin/student-signups/recent', op),
    undo: (op, id) => request('POST', `/v1/admin/student-signups/${enc(id)}/undo`, op, {}),
    deviceCode: (op, playerId) => request('POST', `/v1/admin/students/${enc(playerId)}/device-code`, op, {})
  };
}

export const oauthStartPath = (p: OAuthProvider) => `/v1/oauth/${p}/start?role=guardian&return=${encodeURIComponent(SIGNUP_RETURN)}`;

/**
 * Back from Google / Kakao: `#oauth=<32 hex>` (a one-use code this browser exchanges) or `#oauth_error=<code>`.
 * A bare `#g=<token>` is ignored on purpose (session fixation: a link could sign the device into someone else).
 */
export function isOAuthReturn(hash: string): boolean {
  return /(?:^#|&)(?:oauth=[0-9a-f]{32}|oauth_error=[a-z_]{1,40})(?:&|$)/.test(hash);
}

/** The waiting device keeps its claim across a reload (it is useless to anyone but the approved device). */
export function loadSignupCheck(store: KeyValue | null = localStore()): string | null {
  try {
    const v = store?.getItem(SIGNUP_CHECK_KEY) ?? null;
    return v && /^\d{4}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
export function saveSignupCheck(v: string | null, store: KeyValue | null = localStore()): void {
  try {
    if (v) store?.setItem(SIGNUP_CHECK_KEY, v);
    else store?.removeItem(SIGNUP_CHECK_KEY);
  } catch {
    /* private mode */
  }
}
export function loadSignupClaim(store: KeyValue | null = localStore()): string | null {
  try {
    const v = store?.getItem(SIGNUP_CLAIM_KEY) ?? null;
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
export function saveSignupClaim(v: string | null, store: KeyValue | null = localStore()): void {
  try {
    if (v) store?.setItem(SIGNUP_CLAIM_KEY, v);
    else store?.removeItem(SIGNUP_CLAIM_KEY);
  } catch {
    /* private mode: the device just waits without surviving a reload */
  }
}
