import { z } from 'zod';

/**
 * Free play limits (docs/01 §3, Dan 2026-11-16 09:20). One table for the server that enforces them, the site that
 * describes them and the world client that shows the remaining time. The server is the only judge: every time below
 * is counted on the server clock from a server-written timestamp, never from a client timer.
 */
export const FREE_PLAY_LIMITS = {
  /** /try: one session lasts this long from the server's start stamp. */
  tryMinutes: 3,
  /** /try: completed voice orders per session. */
  tryVoiceOrders: 1,
  /** /try: sessions one device may start per KST day (a reload inside a running session resumes it). */
  trySessionsPerDevicePerDay: 1,
  /** /try: sessions one network address may start per KST day (shared school or home networks; device ids reset). */
  trySessionsPerAddressPerDay: 20,
  /** Guest pass: play time from the first entry, stamped by the server. */
  guestPassMinutes: 30,
  /** Guest pass: passes one seat may issue per KST calendar month. A pass revoked before anyone entered gives its slot back. */
  guestPassesPerSeatPerMonth: 2,
  /** Guest pass: an issued code that nobody used stops working this many days after it was issued. */
  guestPassRedeemDays: 7,
  /**
   * R326 (Dan 11-19 "무료 3분 뒤엔 유료 결제로"): a signed-up child without a seat plays this many minutes of world time,
   * counted by the server, then the world asks for a seat (the guardian picks a plan on /pricing).
   */
  worldTrialMinutes: 3,
  /** The free-trial child's device beats this often while the world is open and visible (nobody else beats). */
  worldTrialBeatMs: 60_000,
  /** One beat (or solo write) adds the time since the last one, but never more than this. */
  worldTrialBeatMaxAddMs: 75_000,
  /** A gap longer than this is a break (tab closed, phone asleep): the next beat starts a new stretch. */
  worldTrialBreakMs: 90_000,
  /**
   * What the first beat or write of a new stretch adds: play started before it, and without it writes spaced past the
   * break (heartbeat blocked) would never run the clock down (review of the R326 paid step: 40 writes = 60 min, 0 used).
   */
  worldTrialStretchMinMs: 20_000
} as const;

/** Wrong-code guard: pass lookups (check and redeem together) one network address may make per hour. */
export const GUEST_PASS_LOOKUPS_PER_HOUR = 30;

/** Header the world client sends with its guest pass session token (never the operator's Authorization header). */
export const GUEST_PASS_HEADER = 'x-lcw-guest-pass';

/** Codes are 8 characters from this alphabet (no 0/O, 1/I/L), shown as XXXX-XXXX. */
export const GUEST_PASS_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Upper-cases and drops spaces and dashes; null when it cannot be a pass code. */
export function normalizeGuestPassCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 8) return null;
  for (const ch of s) if (!GUEST_PASS_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function formatGuestPassCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/* ---------- /try ---------- */

export const TryStartRequestSchema = z.object({ device: z.string().min(16).max(64) }).strict();

export const TrySessionSchema = z
  .object({
    try_id: z.string(),
    started_at: z.number().int(),
    ends_at: z.number().int(),
    server_now: z.number().int(),
    orders_left: z.number().int().min(0),
    /** Stars of the order already granted in this session (a reload shows the same result). */
    order: z.object({ stars: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: z.string() }).nullable()
  })
  .strict();
export type TrySession = z.infer<typeof TrySessionSchema>;

export const TryOrderRequestSchema = z
  .object({
    try_id: z.string().min(1).max(64),
    /** The star sentence the visitor chose (1~3). */
    aim: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    /** What the browser heard (recognition path), or the chosen sentence (word cards). */
    text: z.string().max(300),
    /** How it was said: browser recognition, word cards with a loudness check, or word cards only. */
    path: z.enum(['recognition', 'wordcards_with_loudness', 'wordcards_only']),
    /** Word cards only: the loudness check heard a voice (docs/04 4.1: no confirmed voice caps the order at two stars). */
    spoke: z.boolean().optional()
  })
  .strict();
export type TryOrderRequest = z.infer<typeof TryOrderRequestSchema>;

export const TryOrderResponseSchema = z
  .object({
    stars: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    /** False when the sentence did not pass: the order is not used up, the visitor may try again before ends_at. */
    granted: z.boolean(),
    orders_left: z.number().int().min(0),
    ends_at: z.number().int(),
    server_now: z.number().int()
  })
  .strict();
export type TryOrderResponse = z.infer<typeof TryOrderResponseSchema>;

/** Error codes of the /try routes. */
export type TryError = 'try_used_today' | 'try_ended' | 'try_order_used' | 'try_not_found' | 'invalid';

/* ---------- guest pass ---------- */

export const GuestPassCheckSchema = z
  .object({
    /** ready = nobody entered yet; active = running (same device may come back); ended / expired = no entry. */
    state: z.enum(['ready', 'active', 'ended', 'expired', 'revoked']),
    minutes: z.number().int(),
    ends_at: z.number().int().nullable(),
    redeem_until: z.number().int(),
    server_now: z.number().int()
  })
  .strict();
export type GuestPassCheck = z.infer<typeof GuestPassCheckSchema>;

export const GuestPassRedeemRequestSchema = z.object({ code: z.string().min(8).max(12), device: z.string().min(16).max(64) }).strict();

export const GuestPassSessionSchema = z
  .object({
    /** Send it back in the GUEST_PASS_HEADER header. Valid until ends_at. */
    token: z.string(),
    /** The host's home world the guest enters. */
    world_id: z.string(),
    host_nickname: z.string(),
    started_at: z.number().int(),
    ends_at: z.number().int(),
    server_now: z.number().int()
  })
  .strict();
export type GuestPassSession = z.infer<typeof GuestPassSessionSchema>;

export const GuestPassStatusSchema = z
  .object({
    state: z.enum(['active', 'ended']),
    world_id: z.string(),
    started_at: z.number().int(),
    ends_at: z.number().int(),
    remaining_ms: z.number().int().min(0),
    server_now: z.number().int()
  })
  .strict();
export type GuestPassStatus = z.infer<typeof GuestPassStatusSchema>;

/** Error codes of the guest pass routes. */
export type GuestPassError =
  | 'pass_not_found'
  | 'pass_in_use'
  | 'pass_ended'
  | 'pass_expired'
  | 'pass_revoked'
  | 'monthly_limit'
  | 'seat_inactive'
  | 'seat_not_found'
  | 'too_many_requests'
  | 'invalid';
