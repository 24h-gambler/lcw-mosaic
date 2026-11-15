/**
 * Guest keepsake (docs/01 section 3, docs/10 section 7, WP-504).
 * After a 60-minute guest pass the first crafted item id and first utterance text stay in this browser
 * for 7 days. The AES-GCM key sits in the same localStorage, so this only stops casual reading of the
 * value; it is NOT a security boundary. Nothing leaves the device until a parent claims it.
 */

export const GUEST_CLAIM_TTL_MS = 7 * 86_400_000;
export const GUEST_CLAIM_STORAGE_KEY = 'lcw.guest.claim.v1';
export const GUEST_CLAIM_KEY_STORAGE_KEY = 'lcw.guest.claim.key.v1';
export const DEVICE_CODE_LENGTH = 6;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GuestKeepsake {
  itemId: string;
  utterance: string;
}

interface StoredClaim {
  v: 1;
  iv: string;
  ct: string;
  /** Plain so expiry can be enforced and the record purged without decrypting. */
  savedAtMs: number;
  expiresAtMs: number;
  deviceCode: string;
}

export function isClaimExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Device code is derived from caller-provided random bytes (no Math.random). */
export function deviceCodeFromBytes(bytes: Uint8Array): string {
  let code = '';
  for (let i = 0; i < DEVICE_CODE_LENGTH; i++) code += String((bytes[i] ?? 0) % 10);
  return code;
}

async function loadOrCreateKey(store: KeyValueStore, c: Crypto): Promise<CryptoKey> {
  let raw = store.getItem(GUEST_CLAIM_KEY_STORAGE_KEY);
  if (!raw) {
    raw = toBase64(c.getRandomValues(new Uint8Array(32)));
    store.setItem(GUEST_CLAIM_KEY_STORAGE_KEY, raw);
  }
  const bytes = fromBase64(raw) as Uint8Array<ArrayBuffer>;
  return c.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function saveGuestKeepsake(
  store: KeyValueStore,
  c: Crypto,
  keepsake: GuestKeepsake,
  nowMs: number
): Promise<{ deviceCode: string; expiresAtMs: number }> {
  const key = await loadOrCreateKey(store, c);
  const iv = c.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(keepsake));
  const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const deviceCode = deviceCodeFromBytes(c.getRandomValues(new Uint8Array(DEVICE_CODE_LENGTH)));
  const record: StoredClaim = {
    v: 1,
    iv: toBase64(iv),
    ct: toBase64(ct),
    savedAtMs: nowMs,
    expiresAtMs: nowMs + GUEST_CLAIM_TTL_MS,
    deviceCode
  };
  store.setItem(GUEST_CLAIM_STORAGE_KEY, JSON.stringify(record));
  return { deviceCode, expiresAtMs: record.expiresAtMs };
}

export type GuestKeepsakeRead =
  | { ok: true; keepsake: GuestKeepsake; deviceCode: string; expiresAtMs: number }
  | { ok: false; reason: 'none' | 'expired' | 'corrupt' };

async function decrypt(store: KeyValueStore, c: Crypto, rec: StoredClaim): Promise<GuestKeepsake | null> {
  try {
    const key = await loadOrCreateKey(store, c);
    const iv = fromBase64(rec.iv) as Uint8Array<ArrayBuffer>;
    const ct = fromBase64(rec.ct) as Uint8Array<ArrayBuffer>;
    const plain = await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<GuestKeepsake>;
    if (typeof parsed.itemId !== 'string' || typeof parsed.utterance !== 'string') return null;
    return { itemId: parsed.itemId, utterance: parsed.utterance };
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): StoredClaim | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<StoredClaim>;
    if (
      r.v !== 1 ||
      typeof r.iv !== 'string' ||
      typeof r.ct !== 'string' ||
      typeof r.expiresAtMs !== 'number' ||
      typeof r.deviceCode !== 'string'
    ) {
      return null;
    }
    return r as StoredClaim;
  } catch {
    return null;
  }
}

/** Reads the keepsake; an expired record is purged on read. */
export async function readGuestKeepsake(
  store: KeyValueStore,
  c: Crypto,
  nowMs: number
): Promise<GuestKeepsakeRead> {
  const raw = store.getItem(GUEST_CLAIM_STORAGE_KEY);
  if (raw === null) return { ok: false, reason: 'none' };
  const rec = parseRecord(raw);
  if (!rec) return { ok: false, reason: 'corrupt' };
  if (isClaimExpired(rec.expiresAtMs, nowMs)) {
    store.removeItem(GUEST_CLAIM_STORAGE_KEY);
    return { ok: false, reason: 'expired' };
  }
  const keepsake = await decrypt(store, c, rec);
  if (!keepsake) return { ok: false, reason: 'corrupt' };
  return { ok: true, keepsake, deviceCode: rec.deviceCode, expiresAtMs: rec.expiresAtMs };
}

export type ClaimResult =
  | { ok: true; keepsake: GuestKeepsake }
  | { ok: false; reason: 'none' | 'expired' | 'corrupt' | 'wrong_code' };

/** Parent claim step: the device code shown on the child's screen must match; success consumes the record. */
export async function claimGuestKeepsake(
  store: KeyValueStore,
  c: Crypto,
  enteredCode: string,
  nowMs: number
): Promise<ClaimResult> {
  const read = await readGuestKeepsake(store, c, nowMs);
  if (!read.ok) return read;
  if (read.deviceCode !== enteredCode.trim()) return { ok: false, reason: 'wrong_code' };
  store.removeItem(GUEST_CLAIM_STORAGE_KEY);
  return { ok: true, keepsake: read.keepsake };
}
