/**
 * Lesson answers kept on the child's device while the connection is down (coordinator 11-16: wifi drops, tab
 * refresh). Shared by the 3D client (apps/client lesson controller) and the word-card page (/join).
 *
 * - Every answer carries a `client_id`. The server stores the first answer for each (lesson, client_id) and gives the
 *   same result back for a resend, so an answer whose response was lost on the way is never counted twice.
 * - An answer that got no response (network) or a 5xx/429 goes into the outbox: sessionStorage under the lesson id,
 *   so a refresh in the same tab keeps it (the token may change on a re-join; the lesson does not).
 * - After the next successful poll the outbox is sent in order, each with the `stage_id` it was answered in (the
 *   teacher may have moved on). The server stores it at arrival time, so the console feed still shows it.
 * - 401/403 stops the send and keeps the queue: the session is gone, and a re-join with the code (same lesson) sends it.
 * - Any other 4xx drops that entry (bad body): resending can never succeed.
 */

export const LESSON_OUTBOX_MAX = 20;
export const LESSON_OUTBOX_KEY_PREFIX = 'lcw.lesson.outbox:';
export const UTTERANCE_CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface OutboxStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface OutboxBody {
  client_id: string;
  stage_id?: string;
  [k: string]: unknown;
}

export interface LessonOutboxEntry<B extends OutboxBody = OutboxBody> {
  body: B;
  /** Device clock when it was queued (Date.now). */
  queuedAt: number;
}

/** Without storage (private mode, tests) the outbox lives as long as the page. */
const memory = new Map<string, string>();
const memoryStore: OutboxStore = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k)
};

export function outboxSessionStore(): OutboxStore {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const probe = `${LESSON_OUTBOX_KEY_PREFIX}probe`;
      sessionStorage.setItem(probe, '1');
      sessionStorage.removeItem(probe);
      return sessionStorage;
    }
  } catch {
    /* storage blocked */
  }
  return memoryStore;
}

export function outboxKey(lessonId: string): string {
  return `${LESSON_OUTBOX_KEY_PREFIX}${lessonId}`;
}

export function newUtteranceClientId(nowMs: number = Date.now()): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return `u${nowMs.toString(36)}${rand}`;
}

export function readOutbox<B extends OutboxBody = OutboxBody>(store: OutboxStore, lessonId: string): LessonOutboxEntry<B>[] {
  try {
    const raw = store.getItem(outboxKey(lessonId));
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is LessonOutboxEntry<B> =>
        Boolean(e) &&
        typeof e === 'object' &&
        typeof (e as LessonOutboxEntry).queuedAt === 'number' &&
        Boolean((e as LessonOutboxEntry).body) &&
        typeof (e as LessonOutboxEntry).body.client_id === 'string'
    );
  } catch {
    return [];
  }
}

function writeOutbox(store: OutboxStore, lessonId: string, list: readonly LessonOutboxEntry[]): void {
  try {
    if (list.length === 0) store.removeItem(outboxKey(lessonId));
    else store.setItem(outboxKey(lessonId), JSON.stringify(list));
  } catch {
    /* quota: the entry stays only in this call; nothing else to do */
  }
}

/** Queues one answer (the same client_id once). Over the cap the oldest goes. Returns the queue length. */
export function pushOutbox(store: OutboxStore, lessonId: string, entry: LessonOutboxEntry): number {
  const list = readOutbox(store, lessonId).filter((e) => e.body.client_id !== entry.body.client_id);
  list.push(entry);
  const kept = list.slice(-LESSON_OUTBOX_MAX);
  writeOutbox(store, lessonId, kept);
  return kept.length;
}

export function dropOutbox(store: OutboxStore, lessonId: string, clientId: string): number {
  const list = readOutbox(store, lessonId).filter((e) => e.body.client_id !== clientId);
  writeOutbox(store, lessonId, list);
  return list.length;
}

/** No response, a server error or rate limit: the same answer may succeed later. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export interface FlushResult<R> {
  /** Server answers, in the order the child spoke. */
  sent: R[];
  /** Entries still queued (the connection failed again, or the session is gone until a re-join). */
  left: number;
  /** Entries the server refused for good (400 and other 4xx but 401/403/429). */
  dropped: number;
}

/**
 * Sends the queue in order and stops at the first retryable failure (the rest keep their order for next time).
 * `statusOf` reads an HTTP status from the thrown error (0 = no response); unknown errors count as retryable.
 */
export async function flushOutbox<B extends OutboxBody, R>(opts: {
  store: OutboxStore;
  lessonId: string;
  send: (body: B) => Promise<R>;
  statusOf: (e: unknown) => number | null;
}): Promise<FlushResult<R>> {
  const sent: R[] = [];
  let dropped = 0;
  for (const e of readOutbox<B>(opts.store, opts.lessonId)) {
    try {
      sent.push(await opts.send(e.body));
      dropOutbox(opts.store, opts.lessonId, e.body.client_id);
    } catch (err) {
      const status = opts.statusOf(err);
      if (status === null || isRetryableStatus(status) || status === 401 || status === 403) {
        return { sent, left: readOutbox(opts.store, opts.lessonId).length, dropped };
      }
      dropOutbox(opts.store, opts.lessonId, e.body.client_id);
      dropped++;
    }
  }
  return { sent, left: readOutbox(opts.store, opts.lessonId).length, dropped };
}
