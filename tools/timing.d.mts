export function timeRuns(fn: (i: number) => unknown, opts?: { warmup?: number; runs?: number }): { min: number; median: number; max: number; samples: number[] };
