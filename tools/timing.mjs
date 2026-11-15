// Timing checks that hold under load (parallel test runs, a busy PC): warm the code up first, then time several runs
// and judge the fastest run (what the code can do) plus the median (what it usually does). One cold sample measured
// the scheduler, not the code — WP-101 failed the release run at 28 ms against 15 while 3/3 passed alone.

/**
 * Time `fn` `runs` times after `warmup` untimed calls. `fn` gets the run index (negative for warm-up calls) so a
 * mutating benchmark can use fresh input each time.
 * @param {(i: number) => unknown} fn
 * @param {{ warmup?: number, runs?: number }} [opts]
 * @returns {{ min: number, median: number, max: number, samples: number[] }}
 */
export function timeRuns(fn, opts = {}) {
  const warmup = opts.warmup ?? 3;
  const runs = Math.max(1, opts.runs ?? 9);
  for (let i = 0; i < warmup; i++) fn(-1 - i);
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], samples };
}
