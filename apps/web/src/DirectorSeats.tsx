/**
 * Subscription controls on the teacher console's student rows (Dan: "학생들 구독 날짜는 제가 제 계정에서").
 * Each row shows a seat badge ('과외 구독 중 · 12-16까지') and opens a panel to change the start/end date (a later end =
 * extend to that date), extend one month, stop, or issue a tutoring seat (0원, included in tutoring).
 *
 * Data: GET /v1/admin/seats once, joined here by player_id (the students list query is another lane's). Every change
 * goes to the seats module (apps/edge/src/seats.ts), which writes it to the `seat_changes` audit; the guardian screen
 * (/family, SeatsPage.tsx) reads the same rows from the server on every open. No money is collected from here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { errorCodeOf, type ConsoleSeat, type LessonApi } from './lessonApi.js';
import { Notice, inputStyle, labelStyle, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';
import { LESSON_STRINGS_KO } from './strings.js';

const S = LESSON_STRINGS_KO.director.seat;
const STATE = PARENT_STRINGS_KO.seats.state;
const C = TOKENS.colors;
const T = TOKENS.typography;
const DAY = 86_400_000;
const KST = 9 * 3_600_000;
/** One month as the seats module counts it (TERM_DAYS.month). */
export const EXTEND_MONTH_DAYS = 30;

const pad = (n: number) => String(n).padStart(2, '0');
/** 'MM-DD' in KST. */
export function kstMonthDay(ms: number): string {
  const d = new Date(ms + KST);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** `<input type="date">` value in KST. */
export function kstDateInput(ms: number): string {
  const d = new Date(ms + KST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/**
 * A picked KST date → ms, keeping the KST time of day of `keepFrom` (seats run from the payment time, so moving the
 * date keeps that time and the shown 'MM-DD' is exactly the picked day). Malformed → null.
 */
export function dateInputToMs(v: string, keepFrom: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const timeOfDay = (((keepFrom + KST) % DAY) + DAY) % DAY;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST + timeOfDay;
  return Number.isFinite(ms) ? ms : null;
}

const isLive = (s: ConsoleSeat) => s.state === 'active' || s.state === 'expiring';
/** The seat that decides a student's play (as the server's `playAllowed`): a live seat first, then newest start, newest end. */
export function seatsByPlayer(seats: readonly ConsoleSeat[]): Map<string, ConsoleSeat> {
  const out = new Map<string, ConsoleSeat>();
  for (const s of seats) {
    const cur = out.get(s.player_id);
    const better =
      !cur ||
      (isLive(s) && !isLive(cur)) ||
      (isLive(s) === isLive(cur) && (s.starts_at > cur.starts_at || (s.starts_at === cur.starts_at && s.ends_at > cur.ends_at)));
    if (better) out.set(s.player_id, s);
  }
  return out;
}

export function seatBadgeText(seat: ConsoleSeat | null | undefined, now: number): string {
  if (!seat) return S.none;
  const plan = S.plan[seat.plan] ?? seat.plan;
  const until = kstMonthDay(seat.ends_at);
  switch (seat.state) {
    case 'active':
      return S.active(plan, until);
    case 'expiring':
      return S.expiring(plan, until, STATE.expiring(Math.max(0, Math.ceil((seat.ends_at - now) / DAY))));
    case 'read_only':
    case 'archived':
      return S.ended(plan, STATE[seat.state], until);
    default:
      return S.refunded(plan, STATE.refunded);
  }
}

export function ConsoleSeatBadge({ seat, now }: { seat: ConsoleSeat | null | undefined; now: number }): React.ReactElement {
  const state = seat?.state ?? 'none';
  const look: Record<string, { bg: string; fg: string }> = {
    active: { bg: C['leaf-d'], fg: C['paper-0'] },
    expiring: { bg: C.sun, fg: C['ink-900'] },
    read_only: { bg: C['paper-100'], fg: C['ink-900'] },
    archived: { bg: C.silver, fg: C['ink-900'] },
    refunded: { bg: C['paper-0'], fg: C['ink-700'] },
    none: { bg: C['paper-0'], fg: C['ink-700'] }
  };
  return (
    <span
      data-testid="console-seat-badge"
      data-state={state}
      style={{
        display: 'inline-block',
        padding: `2px ${sp(2)}`,
        borderRadius: '999px',
        border: `1px solid ${C['ink-900']}`,
        background: look[state]!.bg,
        color: look[state]!.fg,
        fontWeight: 800,
        fontSize: `${T.scale.small.sizePx}px`
      }}
    >
      {seatBadgeText(seat, now)}
    </span>
  );
}

/** The console's seats, loaded once with the student list and after every change. */
export function useConsoleSeats(api: LessonApi, token: string, initial?: ConsoleSeat[]) {
  const [seats, setSeats] = useState<ConsoleSeat[] | null>(initial ?? null);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    try {
      setSeats(await api.seats(token));
      setError(false);
    } catch {
      setError(true);
    }
  }, [api, token]);
  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);
  return { byPlayer: seatsByPlayer(seats ?? []), loaded: seats !== null, error, reload };
}

/** The panel under a student row. */
export function SeatManager({
  api,
  token,
  nickname,
  playerId,
  seat,
  now,
  onChanged,
  confirm = (t: string) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(t) : true)
}: {
  api: LessonApi;
  token: string;
  nickname: string;
  playerId: string;
  seat: ConsoleSeat | null | undefined;
  now: () => number;
  onChanged: () => Promise<void> | void;
  confirm?: (text: string) => boolean;
}): React.ReactElement {
  const [start, setStart] = useState(seat ? kstDateInput(seat.starts_at) : '');
  const [end, setEnd] = useState(seat ? kstDateInput(seat.ends_at) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Follow the server after every change (and when another device changed it).
  useEffect(() => {
    setStart(seat ? kstDateInput(seat.starts_at) : '');
    setEnd(seat ? kstDateInput(seat.ends_at) : '');
  }, [seat?.id, seat?.starts_at, seat?.ends_at]);

  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: 'ok', text: await fn() });
    } catch (e) {
      const code = errorCodeOf(e);
      setMsg({ kind: 'error', text: S.err[code] ?? S.errGeneric(code) });
    } finally {
      // Reload first: the buttons stay off until the panel shows the server's new dates.
      await onChanged();
      setBusy(false);
    }
  };

  const editable = Boolean(seat && seat.state !== 'refunded');
  const live = Boolean(seat && (seat.state === 'active' || seat.state === 'expiring'));
  const startMs = seat ? dateInputToMs(start, seat.starts_at) : null;
  const endMs = seat ? dateInputToMs(end, seat.ends_at) : null;
  const datesChanged = Boolean(seat && startMs !== null && endMs !== null && (startMs !== seat.starts_at || endMs !== seat.ends_at));
  const small: React.CSSProperties = { fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'], margin: 0 };

  return (
    <div data-testid={`seat-manager-${playerId}`} style={{ display: 'grid', gap: sp(2), padding: sp(2), background: C['paper-50'], borderRadius: `${TOKENS.shape.radiusButtonPx}px` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
        <strong>{S.title(nickname)}</strong>
        <ConsoleSeatBadge seat={seat} now={now()} />
      </div>
      {seat && seat.state === 'refunded' ? <p style={small}>{S.refundedNote}</p> : null}
      {editable && seat ? (
        <form
          data-testid="seat-dates-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!datesChanged || startMs === null || endMs === null) return;
            const body: { starts_at?: number; ends_at?: number } = {};
            if (startMs !== seat.starts_at) body.starts_at = startMs;
            if (endMs !== seat.ends_at) body.ends_at = endMs;
            void run(async () => S.saved(kstMonthDay((await api.editSeatDates(token, seat.id, body)).ends_at)));
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}
        >
          <label style={{ ...labelStyle, flex: '1 1 160px' }}>
            {S.start}
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} data-testid="seat-start" />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 160px' }}>
            {S.end}
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} data-testid="seat-end" />
          </label>
          <Button type="submit" variant="brand" disabled={busy || !datesChanged} data-testid="seat-save-dates">
            {busy ? S.busy : S.saveDates}
          </Button>
          <p style={{ ...small, flexBasis: '100%' }}>{S.endHint}</p>
        </form>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
        {editable && seat ? (
          <Button
            type="button"
            variant="sky"
            disabled={busy}
            data-testid="seat-extend-month"
            onClick={() => void run(async () => S.extended(kstMonthDay((await api.extendSeat(token, seat.id, EXTEND_MONTH_DAYS)).ends_at)))}
          >
            {S.extendMonth}
          </Button>
        ) : null}
        {live && seat ? (
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            data-testid="seat-stop"
            onClick={() => {
              if (!confirm(S.stopConfirm)) return;
              void run(async () => {
                await api.stopSeat(token, seat.id);
                return S.stopped;
              });
            }}
          >
            {S.stop}
          </Button>
        ) : null}
        {!live ? (
          <Button
            type="button"
            variant="leaf"
            disabled={busy}
            data-testid="seat-issue"
            onClick={() => void run(async () => S.issued(kstMonthDay((await api.issueTutoringSeat(token, playerId)).ends_at)))}
          >
            {S.issue}
          </Button>
        ) : null}
      </div>
      {!live ? <p style={small}>{S.issueHint}</p> : null}
      {msg ? (
        <Notice kind={msg.kind} testId="seat-msg">
          {msg.text}
        </Notice>
      ) : null}
    </div>
  );
}
