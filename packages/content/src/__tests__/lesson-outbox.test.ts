import { describe, expect, it } from 'vitest';
import {
  LESSON_OUTBOX_MAX,
  UTTERANCE_CLIENT_ID_RE,
  flushOutbox,
  newUtteranceClientId,
  outboxKey,
  pushOutbox,
  readOutbox,
  type OutboxStore
} from '../lesson-outbox.js';

function mem(): OutboxStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const body = (id: string) => ({ client_id: id, transcript: `said ${id}`, stage_id: 'cafe_order' });
class Http extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}
const statusOf = (e: unknown) => (e instanceof Http ? e.status : null);

describe('lesson outbox (answers kept through a disconnect)', () => {
  it('client ids fit the server rule and differ', () => {
    const a = newUtteranceClientId(1);
    const b = newUtteranceClientId(1);
    expect(a).toMatch(UTTERANCE_CLIENT_ID_RE);
    expect(a).not.toBe(b);
  });

  it('queues per lesson, once per client id, and keeps the newest when full', () => {
    const s = mem();
    expect(pushOutbox(s, 'l1', { body: body('aaaaaaaa'), queuedAt: 1 })).toBe(1);
    expect(pushOutbox(s, 'l1', { body: body('aaaaaaaa'), queuedAt: 2 })).toBe(1);
    expect(pushOutbox(s, 'l2', { body: body('bbbbbbbb'), queuedAt: 1 })).toBe(1);
    for (let i = 0; i < LESSON_OUTBOX_MAX + 3; i++) pushOutbox(s, 'l3', { body: body(`cccccc${String(i).padStart(2, '0')}`), queuedAt: i });
    const l3 = readOutbox(s, 'l3');
    expect(l3).toHaveLength(LESSON_OUTBOX_MAX);
    expect(l3[0]!.body.client_id).toBe('cccccc03');
    // a broken value reads as empty, never throws
    s.setItem(outboxKey('l4'), '{bad');
    expect(readOutbox(s, 'l4')).toEqual([]);
  });

  it('sends in order, stops at a network failure and keeps the rest for next time', async () => {
    const s = mem();
    for (const [id, at] of [['u0000001', 1000], ['u0000002', 2000], ['u0000003', 3000]] as const) pushOutbox(s, 'l', { body: body(id), queuedAt: at });
    const seen: string[] = [];
    let down = 'u0000002';
    const send = async (b: { client_id: string }) => {
      if (b.client_id === down) throw new Http(0);
      seen.push(b.client_id);
      return b.client_id;
    };
    const r1 = await flushOutbox({ store: s, lessonId: 'l', send, statusOf });
    expect(r1).toEqual({ sent: ['u0000001'], left: 2, dropped: 0 });
    expect(seen).toEqual(['u0000001']);
    down = '';
    const r2 = await flushOutbox({ store: s, lessonId: 'l', send, statusOf });
    expect(r2.sent).toEqual(['u0000002', 'u0000003']);
    expect(r2.left).toBe(0);
    expect(seen).toEqual(['u0000001', 'u0000002', 'u0000003']);
    expect(s.data.has(outboxKey('l'))).toBe(false);
  });

  it('a 400 drops that answer; a 401 or 5xx keeps the queue', async () => {
    const s = mem();
    pushOutbox(s, 'l', { body: body('bad00001'), queuedAt: 0 });
    pushOutbox(s, 'l', { body: body('good0001'), queuedAt: 0 });
    const r = await flushOutbox({
      store: s,
      lessonId: 'l',
      send: async (b) => {
        if (b.client_id === 'bad00001') throw new Http(400);
        return b.client_id;
      },
      statusOf
    });
    expect(r).toEqual({ sent: ['good0001'], left: 0, dropped: 1 });
    for (const status of [401, 503, 429]) {
      pushOutbox(s, 'l', { body: body('keep0001'), queuedAt: 0 });
      const k = await flushOutbox({
        store: s,
        lessonId: 'l',
        send: async () => {
          throw new Http(status);
        },
        statusOf
      });
      expect(k).toEqual({ sent: [], left: 1, dropped: 0 });
    }
  });
});
