/**
 * Speech-to-text path choice (docs/02 section 6, docs/04 section 4.4, docs/08 section 6.6).
 * In-browser WebGPU Whisper only on devices with memory headroom; everything else goes straight to
 * server STT with Opus 16 kbps upload and never tries to load the model (tab crashes on low-end iOS/Android).
 */

export type DeviceTier = 'low' | 'medium' | 'high';
export type SttPath = 'on_device_whisper' | 'server_opus16';

export const SERVER_STT_OPUS_KBPS = 16;

/** docs/08 6.6 gives qualitative criteria only; these numbers are the implementation of them. */
export const TIER_FRAME_MS_HIGH = 18;
export const TIER_FRAME_MS_MEDIUM = 36;
export const TIER_MIN_MEMORY_GB_MEDIUM = 4;
export const TIER_MIN_MEMORY_GB_HIGH = 8;

export interface TierProbe {
  /** Mean frame time over the first 30 s (docs/08 6.6). */
  meanFrameMs: number;
  /** navigator.deviceMemory when exposed (Chromium only), else null. */
  deviceMemoryGb: number | null;
  isMobile: boolean;
}

export function classifyDeviceTier(p: TierProbe): DeviceTier {
  const mem = p.deviceMemoryGb;
  if (p.meanFrameMs > TIER_FRAME_MS_MEDIUM) return 'low';
  // Phones and tablets that do not report memory are assumed tight.
  if (p.isMobile && (mem === null || mem < TIER_MIN_MEMORY_GB_MEDIUM)) return 'low';
  if (!p.isMobile && mem !== null && mem < TIER_MIN_MEMORY_GB_MEDIUM) return 'low';
  const fast = p.meanFrameMs <= TIER_FRAME_MS_HIGH;
  const roomy = mem === null || mem >= TIER_MIN_MEMORY_GB_HIGH;
  return fast && roomy && (!p.isMobile || mem !== null) ? 'high' : 'medium';
}

/**
 * iOS Safari kills tabs on tight memory, so on iOS only a high tier may load the model;
 * low never tries, with or without WebGPU.
 */
export function chooseSttPath(tier: DeviceTier, hasWebGPU: boolean, isIOS: boolean): SttPath {
  if (tier === 'low' || !hasWebGPU) return 'server_opus16';
  if (isIOS && tier !== 'high') return 'server_opus16';
  return 'on_device_whisper';
}
