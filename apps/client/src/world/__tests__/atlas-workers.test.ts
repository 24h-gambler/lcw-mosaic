// The atlas painted in several Workers (atlas.worker.ts via startAtlasWorkers, R2627 start-up) is the same atlas,
// byte for byte, as painting it on the main thread; a Worker that cannot start falls back to null (main thread).
import { describe, expect, it } from 'vitest';
import { TILE_PX, atlasMaterialSteps, startAtlasWorkers } from '../atlas.js';
import { TILE_NAMES } from '../blocks.js';

/** A stand-in Worker that runs atlas.worker.ts's job in the same thread. */
class FakeAtlasWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  postMessage(msg: { from: number; to: number }): void {
    const steps = atlasMaterialSteps(msg.from, msg.to);
    let r = steps.next();
    while (!r.done) r = steps.next();
    const value = r.value;
    queueMicrotask(() => this.onmessage?.({ data: value } as MessageEvent));
  }
  terminate(): void {
    this.terminated = true;
  }
}

const whole = (): { albedo: Uint8Array; material: Uint8Array } => {
  const steps = atlasMaterialSteps();
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
};

describe('atlas Workers (R2627 start-up)', () => {
  it('three Workers paint the same atlas as the main thread, every layer in its place', async () => {
    const made: FakeAtlasWorker[] = [];
    const got = await startAtlasWorkers(3, () => {
      const w = new FakeAtlasWorker();
      made.push(w);
      return w as unknown as Worker;
    });
    const want = whole();
    expect(made.length).toBe(3);
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(got).not.toBeNull();
    expect(got!.albedo.length).toBe(TILE_PX * TILE_PX * 4 * TILE_NAMES.length);
    expect(Buffer.from(got!.albedo).equals(Buffer.from(want.albedo))).toBe(true);
    expect(Buffer.from(got!.material).equals(Buffer.from(want.material))).toBe(true);
  });

  it('a Worker that cannot start gives null, so the engine paints on the main thread', async () => {
    const got = await startAtlasWorkers(2, () => {
      throw new Error('no Worker here');
    });
    expect(got).toBeNull();
  });
});
