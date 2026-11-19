/**
 * Paints both block atlases off the main thread (R2627): 64 px tiles take about 0.7 s on a phone, which ran in the
 * start-up's critical path; here they paint while the town is built. Gets { from, to } (a share of the tile layers,
 * startAtlasWorkers splits them over several Workers), answers one message { albedo, material } for those layers
 * (transferred), or { error } when painting failed (the engine paints on the main thread instead).
 */
import { atlasMaterialSteps } from './atlas.js';

self.onmessage = (ev: MessageEvent<{ from?: number; to?: number }>) => {
  try {
    const steps = atlasMaterialSteps(ev.data?.from, ev.data?.to);
    for (;;) {
      const r = steps.next();
      if (r.done) {
        (self as unknown as Worker).postMessage(r.value, [r.value.albedo.buffer, r.value.material.buffer]);
        return;
      }
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ error: String(e) });
  }
};
