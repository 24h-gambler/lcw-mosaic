/**
 * Sound synthesis for the world (R2627 "소리도", docs/12 6.4 and 8): every world sound is computed in code into a
 * sample buffer once, then played as a buffer. Physical models stand in for recordings:
 *
 *  - footsteps: a heel strike and a toe roll per step, each an impulse into the material's body: modal resonators for
 *    wood, metal and glass (inharmonic partials with their own decay), sparse filtered grains for gravel, grass and
 *    sand (crunch = many tiny cracks), a damped low thump for cloth and soil;
 *  - water: bubble "plinks" (a bubble's pitch rises as it closes, Minnaert) over three bands of rushing noise;
 *  - wind: low noise with slow gusts; birds: frequency-modulated chirps with a harmonic; crickets: pulse trains;
 *  - cups, coins, a shop bell, wood creaks (stick-slip pulses through the plank's resonance).
 *
 * Pure and DOM-free: returns Float32Array samples (mono, -1..1) so tests can measure them. Seeded, so the same sound
 * comes out on every device. Peaks stay at or under -6 dBFS for effects (docs/12 4장); loops are seamless.
 */

export type StepMaterial = 'stone' | 'wood' | 'glass' | 'metal' | 'dirt' | 'sand' | 'cloth' | 'plant';
export const STEP_MATERIALS: readonly StepMaterial[] = ['stone', 'wood', 'glass', 'metal', 'dirt', 'sand', 'cloth', 'plant'];
/** variants per material (docs/12 6.2: 4) */
export const STEP_VARIANTS = 4;
/** effects peak at -6 dBFS (docs/12 4장) */
export const PEAK_SFX = 0.5;

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad, applied in place. */
function biquad(x: Float32Array, type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): Float32Array {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const al = s / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  if (type === 'lp') {
    b0 = (1 - c) / 2;
    b1 = 1 - c;
    b2 = (1 - c) / 2;
  } else if (type === 'hp') {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = (1 + c) / 2;
  } else {
    b0 = al;
    b1 = 0;
    b2 = -al;
  }
  const a0 = 1 + al;
  const a1 = -2 * c;
  const a2 = 1 - al;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const y = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** A decaying sine partial added into `out` from sample `at` (a mode of a struck body). */
function mode(out: Float32Array, at: number, f: number, amp: number, decayS: number, sr: number, phase = 0): void {
  const n = Math.min(out.length - at, Math.ceil(decayS * 7 * sr));
  const w = (2 * Math.PI * f) / sr;
  const k = Math.exp(-1 / (decayS * sr));
  let e = amp;
  for (let i = 0; i < n; i++) {
    // 1 ms attack so the strike does not click digitally
    const att = i < sr * 0.001 ? i / (sr * 0.001) : 1;
    out[at + i]! += Math.sin(phase + w * i) * e * att;
    e *= k;
  }
}

/** Noise burst with an exponential decay, added into `out` (unfiltered; filter the result). */
function burst(out: Float32Array, at: number, amp: number, decayS: number, r: () => number, sr: number, attackS = 0.0008): void {
  const n = Math.min(out.length - at, Math.ceil(decayS * 7 * sr));
  const k = Math.exp(-1 / (decayS * sr));
  let e = amp;
  const an = Math.max(1, attackS * sr);
  for (let i = 0; i < n; i++) {
    const att = i < an ? i / an : 1;
    out[at + i]! += (r() * 2 - 1) * e * att;
    e *= k;
  }
}

/** Sparse grains: `count` tiny clicks spread over `spreadS` (gravel, grass, sand crunch). */
function grains(out: Float32Array, at: number, count: number, spreadS: number, amp: number, grainS: number, r: () => number, sr: number): void {
  for (let g = 0; g < count; g++) {
    // more grains early (the foot lands, then settles)
    const t = Math.pow(r(), 1.6) * spreadS;
    burst(out, at + Math.floor(t * sr), amp * (0.4 + 0.6 * r()) * (1 - (t / spreadS) * 0.6), grainS * (0.6 + 0.8 * r()), r, sr, 0.0002);
  }
}

/** Scale so the peak is `peak`. */
export function normalize(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < x.length; i++) x[i]! *= k;
  }
  return x;
}

/** Short fade in and out so a buffer never starts or ends on a step. */
function edges(x: Float32Array, sr: number, inS = 0.0015, outS = 0.01): Float32Array {
  const a = Math.floor(inS * sr);
  const b = Math.floor(outS * sr);
  for (let i = 0; i < a && i < x.length; i++) x[i]! *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i]! *= i / b;
  return x;
}

/** One strike of the foot on a material (heel or toe). `w` 0..1 = weight. */
function strike(out: Float32Array, at: number, m: StepMaterial, w: number, r: () => number, sr: number): void {
  const tmp = new Float32Array(out.length - at);
  switch (m) {
    case 'stone': {
      // a hard tap: bright click, a short low knock from the slab, a little grit
      const click = new Float32Array(tmp.length);
      burst(click, 0, 1.0 * w, 0.0025, r, sr);
      biquad(click, 'hp', 1800, 0.7, sr);
      mode(tmp, 0, 140 + r() * 40, 0.55 * w, 0.018, sr);
      mode(tmp, 0, 420 + r() * 80, 0.18 * w, 0.012, sr);
      const grit = new Float32Array(tmp.length);
      grains(grit, Math.floor(0.004 * sr), 10, 0.05, 0.25 * w, 0.0012, r, sr);
      biquad(grit, 'bp', 3800, 0.8, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += click[i]! + grit[i]!;
      break;
    }
    case 'wood': {
      // a hollow knock: the plank's low modes ring briefly
      const hit = new Float32Array(tmp.length);
      burst(hit, 0, 0.6 * w, 0.003, r, sr);
      biquad(hit, 'bp', 1200, 0.9, sr);
      mode(tmp, 0, 110 + r() * 20, 0.7 * w, 0.045, sr);
      mode(tmp, 0, 260 + r() * 30, 0.45 * w, 0.035, sr);
      mode(tmp, 0, 640 + r() * 60, 0.22 * w, 0.02, sr);
      mode(tmp, 0, 1450 + r() * 120, 0.08 * w, 0.012, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += hit[i]!;
      break;
    }
    case 'metal': {
      // a clank: inharmonic partials that ring on
      const hit = new Float32Array(tmp.length);
      burst(hit, 0, 0.5 * w, 0.002, r, sr);
      biquad(hit, 'hp', 2500, 0.7, sr);
      const f0 = 480 + r() * 60;
      for (const [k, a, d] of [
        [1, 0.35, 0.16],
        [2.32, 0.28, 0.12],
        [4.25, 0.18, 0.09],
        [6.63, 0.1, 0.06]
      ] as const)
        mode(tmp, 0, f0 * k, a * w, d, sr, r() * 6.28);
      mode(tmp, 0, 95, 0.3 * w, 0.03, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += hit[i]!;
      break;
    }
    case 'glass': {
      // a bright tink over a soft tap
      mode(tmp, 0, 2600 + r() * 300, 0.25 * w, 0.06, sr);
      mode(tmp, 0, 5200 + r() * 500, 0.12 * w, 0.035, sr);
      mode(tmp, 0, 160, 0.35 * w, 0.015, sr);
      const hit = new Float32Array(tmp.length);
      burst(hit, 0, 0.4 * w, 0.0015, r, sr);
      biquad(hit, 'hp', 3000, 0.7, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += hit[i]!;
      break;
    }
    case 'dirt': {
      // soil and short grass: a soft thud and a fine crunch
      mode(tmp, 0, 75 + r() * 15, 0.6 * w, 0.03, sr);
      const c = new Float32Array(tmp.length);
      grains(c, 0, 26, 0.07, 0.3 * w, 0.0015, r, sr);
      biquad(c, 'bp', 2200, 0.6, sr);
      const body = new Float32Array(tmp.length);
      burst(body, 0, 0.5 * w, 0.02, r, sr, 0.004);
      biquad(body, 'lp', 600, 0.7, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += c[i]! + body[i]!;
      break;
    }
    case 'plant': {
      // grass and leaves: blades rustle against each other over a soft step
      mode(tmp, 0, 80, 0.4 * w, 0.025, sr);
      const c = new Float32Array(tmp.length);
      grains(c, 0, 60, 0.13, 0.22 * w, 0.002, r, sr);
      biquad(c, 'bp', 3200, 0.5, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += c[i]!;
      break;
    }
    case 'sand': {
      // fine dense grains, a long soft hiss, little body
      const c = new Float32Array(tmp.length);
      grains(c, 0, 140, 0.16, 0.12 * w, 0.0008, r, sr);
      biquad(c, 'hp', 2500, 0.6, sr);
      biquad(c, 'lp', 9000, 0.6, sr);
      mode(tmp, 0, 60, 0.25 * w, 0.03, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += c[i]!;
      break;
    }
    case 'cloth': {
      // wool and carpet: a muffled thump
      const body = new Float32Array(tmp.length);
      burst(body, 0, 0.8 * w, 0.03, r, sr, 0.006);
      biquad(body, 'lp', 380, 0.7, sr);
      mode(tmp, 0, 70, 0.3 * w, 0.03, sr);
      for (let i = 0; i < tmp.length; i++) tmp[i]! += body[i]!;
      break;
    }
  }
  for (let i = 0; i < tmp.length; i++) out[at + i]! += tmp[i]!;
}

/** Footstep `variant` (0..3) on `m`: heel then toe 45~75 ms later, normalized to the effects peak. */
export function footstep(m: StepMaterial, variant: number, sr: number): Float32Array {
  const r = rng(0x5eed + STEP_MATERIALS.indexOf(m) * 131 + variant * 7919);
  const ring = m === 'metal' ? 0.6 : m === 'glass' ? 0.35 : m === 'sand' || m === 'plant' ? 0.3 : 0.22;
  const out = new Float32Array(Math.ceil(ring * sr));
  strike(out, 0, m, 1, r, sr);
  strike(out, Math.floor((0.045 + r() * 0.03) * sr), m, 0.45 + r() * 0.2, r, sr);
  // the lowest rumble below 40 Hz is cut (docs/12 4장)
  biquad(out, 'hp', 45, 0.7, sr);
  return edges(normalize(out, PEAK_SFX * (0.82 + r() * 0.18)), sr);
}

/** Makes a buffer loop seamlessly: the last `xS` seconds fade into the first (equal power). */
export function seamless(x: Float32Array, sr: number, xS = 0.25): Float32Array {
  const n = Math.floor(xS * sr);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = x[i]! * Math.sin((t * Math.PI) / 2) + x[x.length - n + i]! * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

/** The fountain: rushing water in three bands and bubbles popping on the surface. Loop, 6 s. */
export function fountainLoop(sr: number): Float32Array {
  const r = rng(0xf0f0);
  const len = Math.ceil(6.25 * sr);
  const out = new Float32Array(len);
  for (const [f, q, a] of [
    [450, 0.7, 0.5],
    [1400, 0.8, 0.45],
    [4200, 0.9, 0.25]
  ] as const) {
    const b = new Float32Array(len);
    for (let i = 0; i < len; i++) b[i] = r() * 2 - 1;
    biquad(b, 'bp', f, q, sr);
    // slow surges (falling water is never steady)
    const p1 = r() * 6.28;
    const p2 = r() * 6.28;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const lfo = 0.75 + 0.15 * Math.sin(p1 + t * 2 * Math.PI * 0.31) + 0.1 * Math.sin(p2 + t * 2 * Math.PI * 1.7);
      out[i]! += b[i]! * a * lfo;
    }
  }
  // bubbles: a short sine whose pitch rises as it closes, 1.2~3.5 kHz, ~14 per second
  const nb = Math.floor(6.25 * 14);
  for (let k = 0; k < nb; k++) {
    const at = Math.floor(r() * (len - 0.05 * sr));
    const f0 = 1200 + r() * 2300;
    const d = 0.008 + r() * 0.02;
    const amp = 0.06 + r() * 0.12;
    const n = Math.floor(d * 6 * sr);
    let ph = 0;
    for (let i = 0; i < n && at + i < len; i++) {
      const t = i / sr;
      const f = f0 * (1 + (t / d) * 0.35);
      ph += (2 * Math.PI * f) / sr;
      out[at + i]! += Math.sin(ph) * amp * Math.exp(-t / d);
    }
  }
  biquad(out, 'hp', 60, 0.7, sr);
  return normalize(seamless(out, sr), 0.35);
}

/** The outdoor wind bed: low noise with slow gusts. Loop, 10 s. */
export function windLoop(sr: number): Float32Array {
  const r = rng(0xa1a1);
  const len = Math.ceil(10.4 * sr);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = r() * 2 - 1;
  biquad(out, 'lp', 520, 0.6, sr);
  biquad(out, 'hp', 70, 0.7, sr);
  // gusts: the body of the wind rises and falls; a whistle band comes with the gust
  const whistle = new Float32Array(len);
  for (let i = 0; i < len; i++) whistle[i] = r() * 2 - 1;
  biquad(whistle, 'bp', 900, 6, sr);
  const g1 = r() * 6.28;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const gust = 0.55 + 0.3 * Math.sin(g1 + (t * 2 * Math.PI) / 10) + 0.15 * Math.sin(g1 * 2 + (t * 2 * Math.PI * 3) / 10);
    out[i] = out[i]! * gust + whistle[i]! * 0.15 * Math.max(0, gust - 0.6);
  }
  return normalize(seamless(out, sr, 0.8), 0.3);
}

/** A bird call (variant 0..3): two to five frequency-modulated chirps with a weak second harmonic. */
export function birdCall(variant: number, sr: number): Float32Array {
  const r = rng(0xb1d0 + variant * 101);
  const notes = 2 + Math.floor(r() * 4);
  const base = 2600 + r() * 2400;
  const gap = 0.05 + r() * 0.08;
  const dur = 0.05 + r() * 0.07;
  const len = Math.ceil((notes * (dur + gap) + 0.05) * sr);
  const out = new Float32Array(len);
  for (let n = 0; n < notes; n++) {
    const at = Math.floor(n * (dur + gap) * sr);
    const up = r() > 0.5;
    const span = 0.25 + r() * 0.5;
    const trill = 25 + r() * 40;
    let ph = 0;
    const m = Math.floor(dur * sr);
    for (let i = 0; i < m && at + i < len; i++) {
      const t = i / m;
      const f = base * (up ? 1 + span * t : 1 + span * (1 - t)) * (1 + 0.04 * Math.sin(2 * Math.PI * trill * t * dur));
      ph += (2 * Math.PI * f) / sr;
      const env = Math.sin(Math.PI * t) ** 2;
      out[at + i]! += (Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * env;
    }
  }
  return edges(normalize(out, 0.25), sr);
}

/** A cricket's chirp: a 4.5 kHz carrier gated into 3~5 pulses. */
export function cricketChirp(variant: number, sr: number): Float32Array {
  const r = rng(0xc41c + variant * 37);
  const f = 4300 + r() * 600;
  const pulses = 3 + Math.floor(r() * 3);
  const pulseS = 0.018;
  const gapS = 0.014;
  const len = Math.ceil((pulses * (pulseS + gapS) + 0.02) * sr);
  const out = new Float32Array(len);
  for (let p = 0; p < pulses; p++) {
    const at = Math.floor(p * (pulseS + gapS) * sr);
    const m = Math.floor(pulseS * sr);
    for (let i = 0; i < m; i++) {
      const t = i / m;
      out[at + i]! += Math.sin((2 * Math.PI * f * i) / sr) * Math.sin(Math.PI * t);
    }
  }
  return edges(normalize(out, 0.12), sr);
}

/** A cup set on a saucer (cafe): a ceramic tink with a rattle. */
export function cupClink(variant: number, sr: number): Float32Array {
  const r = rng(0xc0ff + variant * 13);
  const out = new Float32Array(Math.ceil(0.45 * sr));
  const f0 = 2700 + r() * 500;
  mode(out, 0, f0, 0.35, 0.08, sr);
  mode(out, 0, f0 * 1.58, 0.22, 0.06, sr);
  mode(out, 0, f0 * 2.31, 0.12, 0.04, sr);
  // the cup settles: a second, softer tink
  const at = Math.floor((0.05 + r() * 0.05) * sr);
  mode(out, at, f0 * 0.97, 0.15, 0.05, sr);
  return edges(normalize(out, 0.3), sr);
}

/** Coins dropped on a wooden counter (trade shop). */
export function coinClink(variant: number, sr: number): Float32Array {
  const r = rng(0xc014 + variant * 17);
  const out = new Float32Array(Math.ceil(0.6 * sr));
  const coins = 2 + Math.floor(r() * 3);
  for (let c = 0; c < coins; c++) {
    const at = Math.floor((c * 0.06 + r() * 0.04) * sr);
    const f0 = 3800 + r() * 1400;
    mode(out, at, f0, 0.25, 0.07, sr);
    mode(out, at, f0 * 1.71, 0.12, 0.05, sr);
    mode(out, at, 180, 0.12, 0.012, sr);
  }
  return edges(normalize(out, 0.3), sr);
}

/** The bell over a shop door: two bell strikes (the door swings it twice), bell partials 1 : 2.0 : 2.76 : 5.4. */
export function shopBell(sr: number): Float32Array {
  const r = rng(0xbe11);
  const out = new Float32Array(Math.ceil(1.6 * sr));
  for (const [at, w] of [
    [0, 1],
    [0.16, 0.6]
  ] as const) {
    const s = Math.floor(at * sr);
    const f0 = 1568 * (1 + (r() - 0.5) * 0.01);
    for (const [k, a, d] of [
      [1, 0.4, 0.45],
      [2.0, 0.18, 0.3],
      [2.76, 0.14, 0.22],
      [5.4, 0.06, 0.1]
    ] as const)
      mode(out, s, f0 * k, a * w, d, sr, r() * 6.28);
  }
  return edges(normalize(out, 0.35), sr);
}

/** Wood creak (shop floor, windmill): stick-slip pulses with a drifting rate through the wood's resonance. */
export function woodCreak(variant: number, sr: number, low = false): Float32Array {
  const r = rng(0xc4ea + variant * 29 + (low ? 1000 : 0));
  const dur = 0.35 + r() * 0.35;
  const len = Math.ceil(dur * sr);
  const out = new Float32Array(len);
  let t = 0;
  const r0 = (low ? 18 : 35) + r() * 20;
  const r1 = r0 * (0.6 + r() * 0.9);
  while (t < dur) {
    const u = t / dur;
    const rate = r0 + (r1 - r0) * u;
    const at = Math.floor(t * sr);
    const amp = Math.sin(Math.PI * u) * (0.7 + 0.3 * r());
    if (at < len) out[at]! += amp;
    if (at + 1 < len) out[at + 1]! -= amp * 0.6;
    t += 1 / rate;
  }
  biquad(out, 'bp', low ? 260 : 620, 4, sr);
  biquad(out, 'bp', low ? 520 : 1300, 2, sr);
  return edges(normalize(out, 0.25), sr);
}

/** Room impulse response for the short interior reverb (high tier): decaying noise, darker as it fades. */
export function roomImpulse(sr: number, seconds = 0.55): [Float32Array, Float32Array] {
  const mk = (seed: number): Float32Array => {
    const r = rng(seed);
    const len = Math.ceil(seconds * sr);
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      x[i] = (r() * 2 - 1) * Math.exp(-t / (seconds / 6.9)) * (i < sr * 0.004 ? 0 : 1);
    }
    biquad(x, 'lp', 3500, 0.6, sr);
    return normalize(x, 0.5);
  };
  return [mk(0x1a), mk(0x2b)];
}
