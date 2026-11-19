/**
 * Builds the world's sounds off the main thread (R2627): a phone takes up to a second for the fountain and the wind,
 * which would stall the game. Receives { sr }, answers one message per sound group as it is ready:
 * { key, data: Float32Array[] } (transferred). The groups and their order are SOUND_JOBS.
 */
import { SOUND_JOBS, buildSoundJob } from './sound-synth.js';

self.onmessage = (ev: MessageEvent<{ sr: number }>) => {
  const sr = ev.data.sr;
  for (const key of SOUND_JOBS) {
    try {
      const data = buildSoundJob(key, sr);
      (self as unknown as Worker).postMessage({ key, data }, data.map((d) => d.buffer));
    } catch {
      (self as unknown as Worker).postMessage({ key, data: [] });
    }
  }
};
