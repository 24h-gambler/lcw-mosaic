/**
 * A graph that runs but outputs nothing: fp16/q4f16 on WebGPU came out all zeros (peak 0.000, measured 11-16) and
 * q8 there garbled; a driver could do the same to fp32. A silent or NaN warm-up line counts as a failed backend.
 */
export function audible(a: ArrayLike<number>): boolean {
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]!);
    if (Number.isNaN(v)) return false;
    if (v > peak) peak = v;
  }
  return peak > 0.01;
}
