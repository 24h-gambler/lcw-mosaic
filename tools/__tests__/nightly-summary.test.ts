import { describe, expect, it } from 'vitest';
import { kstDay, summaryMarkdown } from '../nightly-audit.mjs';

const rep = (at: string) => ({
  at,
  base: 'https://lcw.worldwidesomething.com',
  sha: 'abc1234',
  routes: 1,
  screens: 2,
  counts: { done: 1, partial: 0, missing: 0 },
  regressions: [],
  unverified: [],
  design: { overflow: [], banned: [], internalIds: [], keepAll: [], frame: [] },
  coverageErrors: [],
  gaps: {},
  consoleErrors: [],
  notChecked: []
});

describe('nightly summary date (KST)', () => {
  it('names the KST day of the 02:50 run, not the previous UTC day', () => {
    // 11-18 02:50 KST = 11-17 17:50 UTC: the header used the UTC day and dated the 11-18 audit 2026-11-17
    expect(kstDay('2026-11-17T17:50:00.000Z')).toBe('2026-11-18');
    expect(summaryMarkdown(rep('2026-11-17T17:50:00.000Z'))).toMatch(/^# LCW 야간 실화면 감사 2026-11-18 \(KST\)\n/);
  });
  it('keeps the day for a daytime run and turns at KST midnight', () => {
    expect(kstDay('2026-11-18T05:00:00.000Z')).toBe('2026-11-18');
    expect(kstDay('2026-11-18T14:59:59.000Z')).toBe('2026-11-18');
    expect(kstDay('2026-11-18T15:00:00.000Z')).toBe('2026-11-19');
  });
});
