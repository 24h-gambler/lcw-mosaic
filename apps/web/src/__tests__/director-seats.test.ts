import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleSeatBadge, EXTEND_MONTH_DAYS, SeatManager, dateInputToMs, kstDateInput, kstMonthDay, seatBadgeText, seatsByPlayer } from '../DirectorSeats.js';
import { LessonDirectorConsole } from '../LessonDirector.js';
import { createLessonApi, type ConsoleSeat } from '../lessonApi.js';
import { LESSON_STRINGS_KO } from '../strings.js';

const S = LESSON_STRINGS_KO.director.seat;
const DAY = 86_400_000;
// 2026-12-16 14:23 KST (Oreo's production seat ends on 12-16).
const END = Date.UTC(2026, 11, 16, 5, 23);
const NOW = END - 30 * DAY;
const oreo: ConsoleSeat = { id: 'seat-9b419c45965c', player_id: 'stu-29ddc960', plan: 'tutoring', term: 'month', starts_at: NOW, ends_at: END, state: 'active' };
const student = (player_id: string, nickname: string) => ({ player_id, nickname, level: 'L1', birth_year: 2017, family_id: 'fam-1', last_lesson_at: null, utterances_7d: 0 });

describe('teacher console seat badge and controls (DirectorSeats.tsx)', () => {
  it('badge words: plan + state + end date in KST', () => {
    expect(seatBadgeText(oreo, NOW)).toBe('과외 구독 중 · 12-16까지');
    expect(seatBadgeText({ ...oreo, plan: 'solo', state: 'expiring' }, END - 3 * DAY)).toBe('혼자 구독 중 · 12-16까지 · 3일 남음');
    expect(seatBadgeText({ ...oreo, plan: 'duo', state: 'read_only' }, END + DAY)).toBe('둘이 · 기간 끝남 · 보기만 · 12-16 끝남');
    expect(seatBadgeText({ ...oreo, state: 'archived' }, END + 40 * DAY)).toBe('과외 · 보관함 · 12-16 끝남');
    expect(seatBadgeText({ ...oreo, state: 'refunded' }, NOW)).toBe('과외 · 환불됨');
    expect(seatBadgeText(undefined, NOW)).toBe(S.none);
  });

  it('dates: KST day both ways, keeping the seat time of day; a malformed value is refused', () => {
    expect(kstMonthDay(END)).toBe('12-16');
    expect(kstDateInput(END)).toBe('2026-12-16');
    // 23:30 KST is the next calendar day in UTC terms → still that KST day.
    expect(kstDateInput(Date.UTC(2026, 11, 16, 14, 30))).toBe('2026-12-16');
    expect(dateInputToMs('2026-12-20', END)).toBe(END + 4 * DAY);
    expect(dateInputToMs('2026-12-16', END)).toBe(END);
    expect(dateInputToMs('', END)).toBeNull();
    expect(dateInputToMs('2026/12/20', END)).toBeNull();
  });

  it('the seat of a student is the newest one (as the server play gate)', () => {
    const old: ConsoleSeat = { ...oreo, id: 'seat-old', starts_at: NOW - 60 * DAY, ends_at: NOW - 30 * DAY, state: 'read_only' };
    const m = seatsByPlayer([oreo, old, { ...oreo, id: 'seat-x', player_id: 'stu-2' }]);
    expect(m.get('stu-29ddc960')!.id).toBe(oreo.id);
    expect(m.get('stu-2')!.id).toBe('seat-x');
    expect(seatsByPlayer([old, oreo]).get('stu-29ddc960')!.id).toBe(oreo.id);
    // A live seat wins over a later-starting ended one (start dates can be edited).
    const endedLater: ConsoleSeat = { ...oreo, id: 'seat-ended', starts_at: NOW + DAY, ends_at: NOW + 2 * DAY, state: 'read_only' };
    expect(seatsByPlayer([endedLater, oreo]).get('stu-29ddc960')!.id).toBe(oreo.id);
  });

  it('student rows show the badge and a 구독 관리 button; no seat → 구독 없음', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonDirectorConsole, {
        initialToken: 'op',
        initialLesson: null,
        initialLive: { lessons: [], server_now: NOW },
        initialStudents: [student('stu-29ddc960', 'Oreo'), student('stu-2', '지우')],
        initialSeats: [oreo],
        now: () => NOW
      })
    );
    expect(html).toContain(S.col);
    expect(html).toContain('과외 구독 중 · 12-16까지');
    expect(html).toContain(S.none);
    expect(html).toContain('data-testid="seat-manage-stu-29ddc960"');
    expect(html).toContain(S.manage);
  });

  it('panel per state: live seat → dates, 1개월 연장, 중지; ended → 연장 + 과외 좌석 발급; refunded/none → 발급 only', () => {
    const api = createLessonApi({ fetch: async () => new Response('{}') });
    const render = (seat: ConsoleSeat | undefined) =>
      renderToStaticMarkup(React.createElement(SeatManager, { api, token: 'op', nickname: 'Oreo', playerId: oreo.player_id, seat, now: () => NOW, onChanged: () => undefined }));
    const live = render(oreo);
    expect(live).toContain('value="2026-12-16"');
    expect(live).toContain('seat-save-dates');
    expect(live).toContain(S.extendMonth);
    expect(live).toContain(S.stop);
    expect(live).not.toContain(S.issue);
    const ended = render({ ...oreo, state: 'read_only' });
    expect(ended).toContain(S.extendMonth);
    expect(ended).toContain(S.issue);
    expect(ended).not.toContain('data-testid="seat-stop"');
    const refunded = render({ ...oreo, state: 'refunded' });
    expect(refunded).toContain(S.refundedNote);
    expect(refunded).not.toContain('seat-dates-form');
    expect(refunded).not.toContain(S.extendMonth);
    expect(refunded).toContain(S.issue);
    const none = render(undefined);
    expect(none).toContain(S.issue);
    expect(none).toContain(S.none);
    expect(renderToStaticMarkup(React.createElement(ConsoleSeatBadge, { seat: oreo, now: NOW }))).toContain('data-state="active"');
  });

  it('API: operator Bearer on every call; tutoring issue and console extend are 0원; dates/stop hit the new routes', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
    const api = createLessonApi({
      fetch: async (url, init) => {
        const h = new Headers(init?.headers);
        calls.push({ url: String(url), method: init?.method ?? 'GET', auth: h.get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify(String(url).endsWith('/v1/admin/seats') && init?.method === 'GET' ? [] : { id: 's', ends_at: END, state: 'active', seat_ids: ['s'] }));
      }
    });
    await api.seats('op-key');
    await api.issueTutoringSeat('op-key', 'stu-1');
    await api.extendSeat('op-key', 'seat-1', EXTEND_MONTH_DAYS);
    await api.editSeatDates('op-key', 'seat-1', { ends_at: END });
    await api.stopSeat('op-key', 'seat-1');
    expect(calls.every((c) => c.auth === 'Bearer op-key')).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/admin/seats',
      'POST /v1/admin/seats',
      'POST /v1/admin/seats/seat-1/dates',
      'POST /v1/admin/seats/seat-1/dates',
      'POST /v1/admin/seats/seat-1/stop'
    ]);
    expect(calls[1]!.body).toEqual({ payer_player_id: 'stu-1', plan: 'tutoring', term: 'month', player_ids: ['stu-1'], amount_krw: 0, note: 'console' });
    // Free extension through /dates: no payment row, no refund window.
    expect(calls[2]!.body).toEqual({ extend_days: 30, note: 'console' });
    expect(calls[3]!.body).toEqual({ ends_at: END, note: 'console' });
    expect(calls[4]!.body).toEqual({ note: 'console' });
  });
});
