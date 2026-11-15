/**
 * Web Push without a third-party service (docs/09 §12): RFC 8291 message encryption (aes128gcm, RFC 8188) and
 * RFC 8292 VAPID (ES256 JWT), on WebCrypto only — runs in the Worker, costs nothing beyond the browser vendors'
 * free push services. The VAPID key pair is made inside the Durable Object on first use and the private half never
 * leaves it (push.ts keeps it in `push_meta`).
 */

const te = new TextEncoder();
/** Bytes backed by a plain ArrayBuffer (what WebCrypto and fetch bodies accept under the Workers types). */
type Bytes = Uint8Array<ArrayBuffer>;

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Bytes {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
};

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** P-256 point (65 bytes, uncompressed) → JWK x/y. */
const pointXY = (raw: Uint8Array) => ({ x: b64url.encode(raw.slice(1, 33)), y: b64url.encode(raw.slice(33, 65)) });

export interface PushTarget {
  endpoint: string;
  /** Browser's P-256 public key, base64url (65-byte uncompressed point). */
  p256dh: string;
  /** Browser's 16-byte auth secret, base64url. */
  auth: string;
}

/** RFC 8291 §3–4: one aes128gcm record. `fixed` is for the RFC test vector only. */
export async function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  plaintext: Bytes,
  fixed?: { asPrivate: string; asPublic: string; salt: string }
): Promise<Bytes> {
  const uaPublic = b64url.decode(target.p256dh);
  const authSecret = b64url.decode(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad_p256dh');
  if (authSecret.length !== 16) throw new Error('bad_auth');
  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (fixed) {
    asPublic = b64url.decode(fixed.asPublic);
    asPrivate = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: fixed.asPrivate, ...pointXY(asPublic), ext: true },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }
  const salt: Bytes = fixed ? b64url.decode(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Single record: content then the 0x02 "last record" delimiter.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export interface VapidKeys {
  /** JWK of the ECDSA P-256 private key (stays in the Durable Object). */
  privateJwk: JsonWebKey;
  /** 65-byte uncompressed public key, base64url — the browser's applicationServerKey. */
  publicKey: string;
}

export async function makeVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const publicKey = b64url.encode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
  return { privateJwk, publicKey };
}

/** RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>` for this endpoint's origin. */
export async function vapidAuthorization(keys: VapidKeys, endpoint: string, subject: string, nowMs: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url.encode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url.encode(te.encode(JSON.stringify({ aud, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url.encode(sig)}, k=${keys.publicKey}`;
}

/**
 * Push services of the browsers we serve. Anything else is refused at subscribe time, so the Worker never fetches
 * an arbitrary URL a client handed it.
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port) return false;
  const h = u.hostname;
  return (
    h === 'fcm.googleapis.com' ||
    h === 'android.googleapis.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h === 'web.push.apple.com' ||
    h.endsWith('.push.apple.com') ||
    h.endsWith('.notify.windows.com')
  );
}
