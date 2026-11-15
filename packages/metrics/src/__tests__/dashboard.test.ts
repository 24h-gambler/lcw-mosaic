import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_CALENDAR_DAYS,
  DASHBOARD_PROJECTION_WEEKS,
  DASHBOARD_WEEKS,
  buildDashboardSeries,
  countConnectors,
  kstDay,
  kstWeekStart,
  type UtteranceMetricInput
} from '../index.js';

const DAY = 86_400_000;
// 2026-11-19 (Thu) 15:00 KST
const NOW = Date.parse('2026-11-19T06:00:00Z');
let n = 0;
const u = (at: number, text: string, over: Partial<UtteranceMetricInput> = {}): UtteranceMetricInput => ({
  id: `u${n++}`,
  player_id: 'kid',
  session_id: 's',
  session_kind: 'solo',
  ctx: 'cafe',
  mode: 'free',
  interlocutor: 'npc',
  final_text: text,
  words: text.split(/\s+/).filter(Boolean).length,
  l1_words: 0,
  dur_ms: 3000,
  latency_ms: 1200,
  stars: 2,
  hint_level: 'none',
  attempts: 1,
  score: 0.8,
  confidence: 0.9,
  created_at: at,
  ...over
});

describe('dashboard series (WP-309, docs/07 §2–4)', () => {
  it('KST weeks start Monday 00:00 and days are KST days', () => {
    expect(new Date(kstWeekStart(NOW)).toISOString()).toBe('2026-11-15T15:00:00.000Z');
    // Sunday 23:30 KST still belongs to the previous week
    expect(kstWeekStart(Date.parse('2026-11-15T14:30:00Z'))).toBe(kstWeekStart(NOW) - 7 * DAY);
    expect(kstWeekStart(Date.parse('2026-11-15T15:00:00Z'))).toBe(kstWeekStart(NOW));
    expect(kstDay(Date.parse('2026-11-15T15:30:00Z'))).toBe('2026-11-16');
  });

  it('connectors: "so that" is not also counted as so/that', () => {
    expect(Object.fromEntries(countConnectors('I want it so that I can fly, because it is fun and so cool'))).toEqual({ 'so that': 1, because: 1, so: 1 });
    expect(countConnectors('hello there').size).toBe(0);
  });

  it('weekly numbers: free words, speech rate, median response, connectors; low confidence excluded; lesson vs solo modes', () => {
    const w = kstWeekStart(NOW);
    const rows = [
      u(w + DAY, 'i like drawing because it is fun', { dur_ms: 6000, latency_ms: 1000 }),
      u(w + DAY + 1000, 'can i have a tea', { mode: 'guided', session_kind: 'lesson', dur_ms: 2000 }),
      u(w + 2 * DAY, 'i want a jetpack so that i can fly', { dur_ms: 6000, latency_ms: 3000 }),
      u(w + 2 * DAY + 5, 'mumble mumble', { confidence: 0.2 })
    ];
    const s = buildDashboardSeries({ utterances: rows, masteredAt: [], lessonStarts: [w + DAY], nowMs: NOW });
    expect(s.weeks).toHaveLength(DASHBOARD_WEEKS);
    const t = s.weeks[DASHBOARD_WEEKS - 1]!;
    expect(t.week_start).toBe(w);
    expect(t.free_words).toBe(7 + 9);
    expect(t.free_utterances).toBe(2);
    expect(t.speaking_min).toBe(0.2); // 14 s of valid speech
    expect(t.speech_wpm).toBe(80); // 16 words / 0.2 min
    expect(t.response_sec).toBe(2); // median of 1.0 s and 3.0 s
    expect(t.mean_words).toBe(8);
    expect(t.connectors_per_100).toBe(12.5); // 2 per 16 words
    expect(t.think_speak).toBeNull(); // fewer than 30 free utterances → sample too small
    expect(t.modes.lesson.guided).toBe(1);
    expect(t.modes.solo.free).toBe(2);
    expect(t.lesson_days).toBe(1);
    expect(t.play_days).toBe(2);
    expect(t.cum_free_words).toBe(16);
    expect(s.connectors).toEqual([
      { expr: 'because', count: 1 },
      { expr: 'so that', count: 1 }
    ]);
    expect(s.has_data).toBe(true);
  });

  it('cumulative curves never go down; vocabulary needs two different days; mastered by date', () => {
    const w = kstWeekStart(NOW);
    const rows = [
      u(w - 21 * DAY, 'big red hat'),
      u(w - 20 * DAY, 'big blue hat'), // big, hat reach 2 days
      u(w - 20 * DAY + 10, 'big hat again'), // same day: no new day for big/hat
      u(w - 7 * DAY, 'red cookie', { mode: 'read' }), // read mode does not count
      u(w + DAY, 'blue cookie') // blue reaches 2 days
    ];
    const s = buildDashboardSeries({ utterances: rows, masteredAt: [w - 10 * DAY, null, w + DAY], lessonStarts: [], nowMs: NOW });
    const ws = s.weeks;
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i]!.cum_free_words).toBeGreaterThanOrEqual(ws[i - 1]!.cum_free_words);
      expect(ws[i]!.cum_vocab).toBeGreaterThanOrEqual(ws[i - 1]!.cum_vocab);
      expect(ws[i]!.cum_mastered).toBeGreaterThanOrEqual(ws[i - 1]!.cum_mastered);
    }
    expect(ws[ws.length - 1]!.cum_vocab).toBe(3); // big, hat, blue
    expect(ws[ws.length - 1]!.cum_mastered).toBe(2);
    expect(ws[ws.length - 2]!.cum_mastered).toBe(1);
  });

  it('think-and-speak index appears once a week has 30 free utterances', () => {
    const w = kstWeekStart(NOW);
    const rows = Array.from({ length: 30 }, (_, i) => u(w + i * 1000, 'i like it because it is good'));
    const s = buildDashboardSeries({ utterances: rows, masteredAt: [], lessonStarts: [], nowMs: NOW });
    // computed by computeThinkAndSpeakIndex (packages/metrics) — a number once the sample is large enough
    expect(typeof s.weeks[DASHBOARD_WEEKS - 1]!.think_speak).toBe('number');
    expect(s.weeks[DASHBOARD_WEEKS - 1]!.think_speak_4w).toBe(s.weeks[DASHBOARD_WEEKS - 1]!.think_speak);
    expect(s.weeks[DASHBOARD_WEEKS - 2]!.think_speak).toBeNull();
  });

  it('projection: 12 dashed weeks from the last 8 weeks trend, only with 2+ weeks of speech; calendar is 84 KST days', () => {
    const w = kstWeekStart(NOW);
    const one = buildDashboardSeries({ utterances: [u(w + DAY, 'one two three')], masteredAt: [], lessonStarts: [], nowMs: NOW });
    expect(one.projection.cum_free_words).toEqual([]);
    const two = buildDashboardSeries({
      utterances: [u(w - 7 * DAY, 'one two three four'), u(w + DAY, 'five six seven eight')],
      masteredAt: [],
      lessonStarts: [],
      nowMs: NOW
    });
    expect(two.projection.cum_free_words).toHaveLength(DASHBOARD_PROJECTION_WEEKS);
    expect(two.projection.cum_free_words[0]).toEqual({ week_start: w + 7 * DAY, value: 12 });
    expect(two.calendar).toHaveLength(DASHBOARD_CALENDAR_DAYS);
    expect(two.calendar[DASHBOARD_CALENDAR_DAYS - 1]!.day).toBe('2026-11-19');
    expect(two.calendar.find((d) => d.day === kstDay(w + DAY))!.free_words).toBe(4);
    const empty = buildDashboardSeries({ utterances: [], masteredAt: [], lessonStarts: [], nowMs: NOW });
    expect(empty.has_data).toBe(false);
  });
});
