/**
 * Seats (WP-704; server apps/edge/src/seats.ts).
 *  - Guardian: the 이용권 section on /family — state, period, payment (payer only), and a refund request that explains
 *    the Duo rule. The other family's Duo seat shows no name.
 *  - Operator: /seats — the 확인함 (refund requests with paid date and usage, seats ending within 7 days), manual issue
 *    after a bank transfer, extend, and the one-button refund rule. Money is sent by hand; this screen records it.
 * Price appears only here (guardian/operator), never on a child screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import {
  createFamilyApi,
  type AdminSeat,
  type FamilyApi,
  type FamilySeat,
  type SeatInbox,
  type SeatInboxItem,
  type SeatPayment,
  type SeatRefundMode,
  type SeatState
} from './familyApi.js';
import { GuestPasses } from './GuestPasses.js';
import { errorCodeOf, loadOperatorToken } from './lessonApi.js';
import { kstLabel } from './lessonFlow.js';
import { Box, LessonStyle, Notice, border, inputStyle, labelStyle, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const S = PARENT_STRINGS_KO.seats;
const A = PARENT_STRINGS_KO.seatsAdmin;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const DAY = 86_400_000;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };
const won = (n: number) => n.toLocaleString('ko-KR');
const day = (ms: number | null) => kstLabel(ms, false).replace(/^\d{4}년 /, '');
const dayTime = (ms: number | null) => kstLabel(ms, true);
/** Why the rule refund button was refused (first use since the screen loaded, most often). */
const refundErr = (code: string): string | undefined => (code === 'seat_used' ? A.usedRefuse : undefined);
/** What the operator must do next after a rule refund (money is sent by hand). */
export function doneText(r: { refund_krw: number; removed_days?: number; remaining_seat: { solo_days: number } | null }): string {
  if (r.removed_days) return A.refundDoneExtend(won(r.refund_krw), r.removed_days);
  if (!r.remaining_seat) return A.refundDone(won(r.refund_krw));
  return r.refund_krw > 0 ? A.refundDoneDuoKeep(won(r.refund_krw)) : A.refundDoneDuoDays(r.remaining_seat.solo_days);
}

export function daysLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / DAY));
}

/** State badge: always words, colour only supports them. */
export function SeatBadge({ state, endsAt, now }: { state: SeatState; endsAt: number; now: number }): React.ReactElement {
  const look: Record<SeatState, { bg: string; fg: string }> = {
    active: { bg: C['leaf-d'], fg: C['paper-0'] },
    expiring: { bg: C.sun, fg: C['ink-900'] },
    read_only: { bg: C['paper-100'], fg: C['ink-900'] },
    archived: { bg: C.silver, fg: C['ink-900'] },
    refunded: { bg: C['paper-0'], fg: C['ink-700'] }
  };
  const text = state === 'expiring' ? S.state.expiring(daysLeft(endsAt, now)) : S.state[state];
  return (
    <span
      data-testid="seat-badge"
      style={{
        display: 'inline-block',
        padding: `2px ${sp(2)}`,
        borderRadius: '999px',
        border,
        background: look[state].bg,
        color: look[state].fg,
        fontWeight: 800,
        fontSize: px(T.scale.small.sizePx),
        whiteSpace: 'nowrap'
      }}
    >
      {text}
    </span>
  );
}

/* ---------------- guardian ---------------- */

export interface SeatRequestInput {
  mode?: SeatRefundMode;
  note?: string;
}

export function FamilySeatsView({
  seats,
  now,
  busy = false,
  sent,
  onRequest,
  extra
}: {
  seats: readonly FamilySeat[];
  now: number;
  busy?: boolean;
  sent?: { seatId: string; status: SeatSent } | null;
  onRequest: (seatId: string, input: SeatRequestInput) => void;
  /** More for one seat at the end of its card (the friend pass box). */
  extra?: (s: FamilySeat) => React.ReactNode;
}): React.ReactElement | null {
  if (seats.length === 0) return null;
  return (
    <Box title={S.title} testId="family-seats">
      <p style={{ ...small, marginTop: 0 }}>{S.lead}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(3) }}>
        {seats.map((s) => (
          <SeatItem key={s.id} seat={s} now={now} busy={busy} sent={sent?.seatId === s.id ? sent.status : null} onRequest={onRequest} extra={extra?.(s)} />
        ))}
      </ul>
    </Box>
  );
}

function DuoChoice({
  seatId,
  options,
  mode,
  setMode
}: {
  seatId: string;
  options: { refund_difference_krw: number; solo_days: number };
  mode: SeatRefundMode;
  setMode: (m: SeatRefundMode) => void;
}): React.ReactElement {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
      {(
        [
          ['refund_difference', S.duoDiff(won(options.refund_difference_krw))],
          ['convert_to_solo_days', S.duoDays(options.solo_days)]
        ] as const
      ).map(([m, label]) => (
        <label key={m} style={{ display: 'flex', gap: sp(2), alignItems: 'flex-start', minHeight: px(TOKENS.shape.touchTargetMinPx) }}>
          <input type="radio" name={`mode-${seatId}`} checked={mode === m} onChange={() => setMode(m)} style={{ width: 22, height: 22, flex: 'none' }} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function PaymentLines({ payments }: { payments: readonly SeatPayment[] }): React.ReactElement {
  return (
    <div style={{ ...small, display: 'grid', gap: '2px' }} data-testid="seat-payment">
      {payments.map((p) => (
        <span key={p.order_id}>
          {p.kind === 'extend'
            ? S.paymentLineExtend(p.days ?? 0, won(p.amount_krw), day(p.paid_at))
            : (p.plan === 'duo' ? S.paymentLineDuo : S.paymentLine)(won(p.amount_krw), day(p.paid_at))}
          {p.refunded_krw > 0 ? ` · ${S.refundedLine(won(p.refunded_krw))}` : ''}
          {p.used && !p.refunded ? ` · ${S.paymentUsed}` : ''}
        </span>
      ))}
    </div>
  );
}

export type SeatSent = 'pending' | 'review' | 'awaiting' | 'chosen';

/** Which confirmation to show after a request: a payer's choice on a waiting Duo request, a waiting request, or the status. */
export function sentKind(r: { status: 'pending' | 'review'; mode?: string; awaiting_payer_choice?: boolean }): SeatSent {
  if (r.awaiting_payer_choice === undefined && r.mode) return 'chosen';
  if (r.awaiting_payer_choice) return 'awaiting';
  return r.status;
}

function SeatItem({
  seat: s,
  now,
  busy,
  sent,
  onRequest,
  extra
}: {
  seat: FamilySeat;
  now: number;
  busy: boolean;
  sent: SeatSent | null;
  onRequest: (seatId: string, input: SeatRequestInput) => void;
  extra?: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SeatRefundMode>('refund_difference');
  const [note, setNote] = useState('');
  const inWindow = s.refundable && s.refund_until !== null && now < s.refund_until;
  const canAsk = s.can_request_refund;
  // A tutoring seat is part of the tutoring fee (a monthly subscription with the teacher): no plan price, no 0원 line.
  const tutoring = s.plan === 'tutoring';
  const included = tutoring && (s.payments ?? []).every((p) => p.amount_krw === 0);
  const planText = tutoring
    ? [S.tutoringPlan, included ? S.tutoringIncluded : null, S.until(day(s.ends_at))].filter(Boolean).join(' · ')
    : `${S.plan[s.plan] ?? s.plan} · ${S.term[s.term] ?? s.term}`;
  const pr = s.pending_request;
  return (
    <li
      data-testid={`seat-${s.id}`}
      style={{ border: `1px solid ${C['line-200']}`, borderRadius: px(TOKENS.shape.radiusButtonPx), padding: sp(3), display: 'grid', gap: sp(2), background: C['paper-0'] }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: sp(2), flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: '2px' }}>
          <strong style={{ fontSize: px(T.scale.h3.sizePx) }}>{s.child ? s.child.nickname : S.otherSeat}</strong>
          <span style={small}>{planText}</span>
        </div>
        <SeatBadge state={s.state} endsAt={s.ends_at} now={now} />
      </div>
      {tutoring ? null : <span style={small}>{S.period(day(s.starts_at), day(s.ends_at))}</span>}
      {!s.child ? <span style={small}>{S.otherSeatNote}</span> : null}
      {s.state === 'expiring' ? <p style={{ margin: 0 }}>{S.expiringBody(day(s.ends_at))}</p> : null}
      {s.state === 'read_only' ? <p style={{ margin: 0 }}>{S.readOnlyBody(day(s.read_only_until))}</p> : null}
      {s.state === 'archived' ? <p style={{ margin: 0 }}>{S.archivedBody}</p> : null}
      {s.state === 'refunded' ? <p style={{ margin: 0 }}>{S.refundedBody}</p> : null}
      {s.payments && s.payments.some((p) => p.amount_krw > 0) ? <PaymentLines payments={s.payments.filter((p) => p.amount_krw > 0)} /> : null}
      {pr ? (
        <Notice kind="info" testId="seat-pending">
          {(pr.status === 'review' ? S.refundReview : pr.awaiting_payer_choice ? S.refundAwaiting : S.refundPending)(day(pr.requested_at))}
        </Notice>
      ) : null}
      {s.can_choose_mode && s.duo_options ? (
        <form
          data-testid={`seat-choose-${s.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            onRequest(s.id, { mode });
          }}
          style={{ display: 'grid', gap: sp(2), borderTop: `1px solid ${C['line-200']}`, paddingTop: sp(2) }}
        >
          <strong>{S.chooseTitle}</strong>
          <p style={{ margin: 0 }}>{S.chooseBody}</p>
          <DuoChoice seatId={s.id} options={s.duo_options} mode={mode} setMode={setMode} />
          <div>
            <Button type="submit" variant="brand" disabled={busy}>
              {S.chooseSubmit}
            </Button>
          </div>
        </form>
      ) : null}
      {sent ? (
        <Notice kind="ok" testId="seat-sent">
          {sent === 'pending' ? S.sentPending : sent === 'awaiting' ? S.sentAwaiting : sent === 'chosen' ? S.sentChosen : S.sentReview}
        </Notice>
      ) : null}
      {s.refund_block === 'seat_used' && s.first_used_at !== null && !pr ? (
        <span style={small} data-testid="seat-refund-used">
          {S.refundUsed(day(s.first_used_at))}
        </span>
      ) : null}
      {canAsk && !open ? (
        <div style={{ display: 'grid', gap: sp(1) }}>
          <span style={small} data-testid="seat-refund-until">
            {s.refundable && s.refund_until ? S.refundUntil(day(s.refund_until - 1)) : S.refundClosed}
          </span>
          <div>
            <Button type="button" variant="paper" disabled={busy} onClick={() => setOpen(true)} data-testid={`seat-ask-${s.id}`}>
              {S.refundAsk}
            </Button>
          </div>
        </div>
      ) : null}
      {canAsk && open ? (
        <form
          data-testid={`seat-form-${s.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            onRequest(s.id, { ...(s.duo_options ? { mode } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
            setOpen(false);
          }}
          style={{ display: 'grid', gap: sp(2), borderTop: `1px solid ${C['line-200']}`, paddingTop: sp(2) }}
        >
          <strong>{S.formTitle}</strong>
          {s.duo_options ? (
            <>
              <p style={{ margin: 0 }}>{S.duoPayerBody}</p>
              <DuoChoice seatId={s.id} options={s.duo_options} mode={mode} setMode={setMode} />
            </>
          ) : s.plan === 'duo' && inWindow ? (
            <p style={{ margin: 0 }}>{S.duoOtherBody}</p>
          ) : inWindow ? (
            <p style={{ margin: 0 }}>{S.soloBody}</p>
          ) : (
            <p style={{ margin: 0 }}>{S.refundClosed}</p>
          )}
          <label style={labelStyle}>
            {S.formNote}
            <input value={note} maxLength={200} placeholder={S.formNotePlaceholder} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
            <Button type="submit" variant="brand" disabled={busy}>
              {S.formSubmit}
            </Button>
            <Button type="button" variant="paper" onClick={() => setOpen(false)}>
              {S.formCancel}
            </Button>
          </div>
        </form>
      ) : null}
      {extra}
    </li>
  );
}

/** Loads and shows the seats for the signed-in guardian; nothing when the family has no seat (pre-sale, tutoring off). */
export function FamilySeats({ api, token }: { api: FamilyApi; token: string }): React.ReactElement | null {
  const [data, setData] = useState<{ seats: FamilySeat[]; server_now: number } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ seatId: string; status: SeatSent } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.seats(token));
      setError(false);
    } catch {
      setError(true);
    }
  }, [api, token]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <Notice kind="error" onRetry={() => void load()} retryLabel={S.retry}>
        {S.error}
      </Notice>
    );
  if (!data) return null;
  return (
    <FamilySeatsView
      seats={data.seats}
      now={data.server_now}
      busy={busy}
      sent={sent}
      // A friend pass belongs to a live seat of this family's own child (another family's Duo seat is theirs to give).
      extra={(s) => (s.child && (s.state === 'active' || s.state === 'expiring') ? <GuestPasses api={api} token={token} seatId={s.id} /> : null)}
      onRequest={(seatId, input) => {
        setBusy(true);
        void api
          .requestRefund(token, seatId, input)
          .then((r) => setSent({ seatId, status: sentKind(r) }))
          .catch(() => setError(true))
          .finally(() => {
            setBusy(false);
            void load();
          });
      }}
    />
  );
}

/* ---------------- operator ---------------- */

type AdminLoad = { status: 'loading' } | { status: 'ok'; seats: AdminSeat[]; inbox: SeatInbox; kids: Array<{ player_id: string; nickname: string; family_id: string }> } | { status: 'error'; code: string };

export function SeatsAdminPage({ api, initialToken, now = Date.now }: { api?: FamilyApi; initialToken?: string | null; now?: () => number }): React.ReactElement {
  const apiRef = useRef<FamilyApi>(api ?? createFamilyApi());
  const [token] = useState<string | null>(() => (initialToken !== undefined ? initialToken : loadOperatorToken()));
  const [load, setLoad] = useState<AdminLoad>({ status: 'loading' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [seats, inbox, kids] = await Promise.all([
        apiRef.current.adminSeats(token),
        apiRef.current.adminSeatInbox(token),
        apiRef.current.adminStudents(token)
      ]);
      setLoad({ status: 'ok', seats, inbox, kids });
    } catch (e) {
      setLoad({ status: 'error', code: errorCodeOf(e) });
    }
  }, [token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: (op: string) => Promise<string>, errText?: (code: string) => string | undefined, confirmText?: string) => {
    if (!token || busy) return;
    if (confirmText && typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ kind: 'ok', text: await fn(token) });
    } catch (e) {
      const code = errorCodeOf(e);
      setMsg({ kind: 'error', text: errText?.(code) ?? `${A.error} (${code})` });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <main
      className="lcw-lesson"
      data-testid="seats-admin"
      style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gap: sp(4), fontFamily: T.fonts.ui, wordBreak: 'keep-all', color: C['ink-900'] }}
    >
      <LessonStyle />
      <h1 style={{ margin: 0, fontSize: px(T.scale.h1.sizePx), lineHeight: px(T.scale.h1.lineHeightPx) }}>{A.title}</h1>
      {!token ? (
        <Box>
          <p style={{ marginTop: 0 }}>{A.needKey}</p>
          <a href="/director" style={{ fontWeight: 700, color: C['sky-d'] }}>
            {A.goDirector}
          </a>
        </Box>
      ) : null}
      {token && load.status === 'error' ? (
        <Notice kind="error" onRetry={() => void refresh()} retryLabel={A.retry}>
          {load.code === 'operator_only' ? A.wrongKey : A.error}
        </Notice>
      ) : null}
      {msg ? (
        <Notice kind={msg.kind} testId="seats-msg">
          {msg.text}
        </Notice>
      ) : null}
      {token && load.status === 'ok' ? (
        <>
          <Inbox
            inbox={load.inbox}
            busy={busy}
            now={now()}
            onRule={(it) =>
              run(async (op) => {
                const r = await apiRef.current.adminRefundSeat(op, it.seat_id);
                return doneText(r);
              }, refundErr, A.confirmRefund)
            }
            onDecline={(it) =>
              run(async (op) => {
                await apiRef.current.adminDecideRefund(op, it.id, { decision: 'decline' });
                return A.declined;
              })
            }
            onException={(it, amount) =>
              run(async (op) => {
                await apiRef.current.adminDecideRefund(op, it.id, { decision: 'refund', refund_krw: amount });
                return A.refundDone(won(amount));
              }, undefined, A.confirmRefund)
            }
            onExtend={(seatId, input) =>
              run(
                async (op) => A.extended(day((await apiRef.current.adminExtendSeat(op, seatId, input)).ends_at)),
                (code) => A.issueErr[code]
              )
            }
          />
          <IssueForm
            kids={load.kids}
            busy={busy}
            onIssue={(input) =>
              run(
                async (op) => {
                  const r = await apiRef.current.adminIssueSeat(op, input);
                  return A.issued(won(r.amount_krw), day(r.ends_at));
                },
                (code) => A.issueErr[code]
              )
            }
          />
          <SeatList
            seats={load.seats}
            now={now()}
            busy={busy}
            onRule={(s) =>
              run(async (op) => {
                const r = await apiRef.current.adminRefundSeat(op, s.id);
                return doneText(r);
              }, refundErr, A.confirmRefund)
            }
            onExtend={(seatId, input) =>
              run(
                async (op) => A.extended(day((await apiRef.current.adminExtendSeat(op, seatId, input)).ends_at)),
                (code) => A.issueErr[code]
              )
            }
          />
        </>
      ) : null}
    </main>
  );
}

function Inbox({
  inbox,
  busy,
  now,
  onRule,
  onDecline,
  onException,
  onExtend
}: {
  inbox: SeatInbox;
  busy: boolean;
  now: number;
  onRule: (it: SeatInboxItem) => void;
  onDecline: (it: SeatInboxItem) => void;
  onException: (it: SeatInboxItem, amount: number) => void;
  onExtend: (seatId: string, input: ExtendInput) => void;
}): React.ReactElement {
  return (
    <Box title={A.inboxTitle} tone="tinted" testId="seats-inbox">
      {inbox.requests.length === 0 ? <p style={{ margin: 0 }}>{A.inboxEmpty}</p> : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
        {inbox.requests.map((it) => (
          <InboxItem key={it.id} it={it} busy={busy} onRule={onRule} onDecline={onDecline} onException={onException} />
        ))}
      </ul>
      <h3 style={{ margin: `${sp(4)} 0 ${sp(2)}`, fontSize: px(T.scale.body.sizePx) }}>{A.expiringTitle}</h3>
      {inbox.expiring.length === 0 ? <p style={{ ...small, margin: 0 }}>{A.expiringNone}</p> : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
        {inbox.expiring.map((e) => (
          <li key={e.id} style={{ display: 'flex', gap: sp(2), alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{e.nickname}</strong>
            <span style={small}>
              {day(e.ends_at)} · {S.state.expiring(daysLeft(e.ends_at, now))}
            </span>
            <ExtendForm seatId={e.id} defaultDays={e.term === 'year' ? 365 : 30} busy={busy} onExtend={onExtend} />
          </li>
        ))}
      </ul>
    </Box>
  );
}

function InboxItem({
  it,
  busy,
  onRule,
  onDecline,
  onException
}: {
  it: SeatInboxItem;
  busy: boolean;
  onRule: (it: SeatInboxItem) => void;
  onDecline: (it: SeatInboxItem) => void;
  onException: (it: SeatInboxItem, amount: number) => void;
}): React.ReactElement {
  const [amount, setAmount] = useState('');
  const review = it.status === 'review';
  return (
    <li data-testid={`inbox-${it.id}`} style={{ background: C['paper-0'], border: `1px solid ${C['line-200']}`, borderRadius: px(TOKENS.shape.radiusButtonPx), padding: sp(3), display: 'grid', gap: sp(1) }}>
      <div style={{ display: 'flex', gap: sp(2), alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>{it.nickname ?? '—'}</strong>
        <span style={{ fontWeight: 700, color: review ? C['danger-d'] : C['sky-d'] }}>
          {review ? `${A.reqReview} · ${A.reason[it.reason ?? ''] ?? it.reason ?? ''}` : it.awaiting_payer_choice ? `${A.reqPending} · ${A.awaiting}` : A.reqPending}
        </span>
        <span style={small}>
          {S.plan[it.plan] ?? it.plan}
          {it.mode && it.plan === 'duo' ? ` · ${A.mode[it.mode]}` : ''}
        </span>
      </div>
      <span style={small}>{A.reqMeta(day(it.paid_at), won(it.amount_krw), it.usage.lessons, it.usage.utterances)}</span>
      <span style={small}>{A.reqDeadline(day(it.refund_until - 1))}</span>
      {it.first_used_at !== null ? <span style={small}>{A.firstUsed(dayTime(it.first_used_at))}</span> : null}
      {it.note ? <span style={small}>{A.reqNote(it.note)}</span> : null}
      <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap', alignItems: 'end' }}>
        {!review ? (
          <Button type="button" variant="brand" disabled={busy || it.awaiting_payer_choice} onClick={() => onRule(it)}>
            {A.refundRule}
          </Button>
        ) : (
          <>
            <label style={{ ...labelStyle, flex: '0 1 180px' }}>
              {A.exceptionAmount}
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />
            </label>
            <Button type="button" variant="brand" disabled={busy || amount === ''} onClick={() => onException(it, Number(amount))}>
              {A.exception}
            </Button>
          </>
        )}
        <Button type="button" variant="paper" disabled={busy} onClick={() => onDecline(it)}>
          {A.decline}
        </Button>
      </div>
    </li>
  );
}

function IssueForm({
  kids,
  busy,
  onIssue
}: {
  kids: Array<{ player_id: string; nickname: string; family_id: string }>;
  busy: boolean;
  onIssue: (input: {
    payer_player_id: string;
    plan: 'solo' | 'duo' | 'tutoring';
    term: 'month' | 'year';
    player_ids: string[];
    amount_krw?: number;
    paid_at?: number;
  }) => void;
}): React.ReactElement {
  const [plan, setPlan] = useState<'solo' | 'duo' | 'tutoring'>('solo');
  const [term, setTerm] = useState<'month' | 'year'>('month');
  const [kid, setKid] = useState('');
  const [kid2, setKid2] = useState('');
  const [payer, setPayer] = useState<'kid' | 'kid2'>('kid');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const name = (id: string) => kids.find((k) => k.player_id === id)?.nickname ?? '';
  // Same nickname in two families: add the end of the id so the operator picks the right child.
  const optionLabel = (k: { player_id: string; nickname: string }) =>
    kids.filter((x) => x.nickname === k.nickname).length > 1 ? `${k.nickname} · ${k.player_id.slice(-6)}` : k.nickname;
  const ready = kid !== '' && (plan !== 'duo' || (kid2 !== '' && kid2 !== kid));
  const select = (value: string, set: (v: string) => void, label: string, testId: string) => (
    <label style={{ ...labelStyle, flex: '1 1 180px' }}>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} style={inputStyle} data-testid={testId}>
        <option value="">{A.pick}</option>
        {kids.map((k) => (
          <option key={k.player_id} value={k.player_id}>
            {optionLabel(k)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Box title={A.issueTitle} testId="seats-issue">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onIssue({
            payer_player_id: plan === 'duo' && payer === 'kid2' ? kid2 : kid,
            plan,
            term,
            player_ids: plan === 'duo' ? [kid, kid2] : [kid],
            ...(amount !== '' ? { amount_krw: Number(amount) } : {}),
            ...(kstInputToMs(paidAt) !== null ? { paid_at: kstInputToMs(paidAt)! } : {})
          });
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}
      >
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>
          {A.issuePlan}
          <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} style={inputStyle} data-testid="issue-plan">
            {(['solo', 'duo', 'tutoring'] as const).map((p) => (
              <option key={p} value={p}>
                {S.plan[p]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '1 1 140px' }}>
          {A.issueTerm}
          <select value={term} onChange={(e) => setTerm(e.target.value as typeof term)} style={inputStyle}>
            {(['month', 'year'] as const).map((t) => (
              <option key={t} value={t}>
                {S.term[t]}
              </option>
            ))}
          </select>
        </label>
        {select(kid, setKid, A.issueKid, 'issue-kid')}
        {plan === 'duo' ? select(kid2, setKid2, A.issueKid2, 'issue-kid2') : null}
        {plan === 'duo' && kid && kid2 ? (
          <label style={{ ...labelStyle, flex: '1 1 180px' }}>
            {A.issuePayer}
            <select value={payer} onChange={(e) => setPayer(e.target.value as 'kid' | 'kid2')} style={inputStyle}>
              <option value="kid">{A.issuePayerOf(name(kid))}</option>
              <option value="kid2">{A.issuePayerOf(name(kid2))}</option>
            </select>
          </label>
        ) : null}
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>
          {A.issueAmount}
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: '1 1 200px' }}>
          {A.issuePaidAt}
          <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={inputStyle} data-testid="issue-paid-at" />
        </label>
        <Button type="submit" variant="brand" disabled={busy || !ready}>
          {A.issueSubmit}
        </Button>
      </form>
    </Box>
  );
}

function SeatList({
  seats,
  now,
  busy,
  onRule,
  onExtend
}: {
  seats: AdminSeat[];
  now: number;
  busy: boolean;
  onRule: (s: AdminSeat) => void;
  onExtend: (seatId: string, input: ExtendInput) => void;
}): React.ReactElement {
  const th: React.CSSProperties = { textAlign: 'left', padding: sp(1), borderBottom: border, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: sp(1), borderBottom: `1px solid ${C['line-200']}`, verticalAlign: 'top' };
  return (
    <Box title={A.listTitle} testId="seats-list">
      {seats.length === 0 ? (
        <p style={{ margin: 0 }}>{A.listEmpty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
            <thead>
              <tr>
                {[A.col.kid, A.col.plan, A.col.period, A.col.state, A.col.paid, A.col.act].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seats.map((s) => {
                return (
                  <tr key={s.id}>
                    <td style={td}>{s.nickname}</td>
                    <td style={td}>
                      {S.plan[s.plan] ?? s.plan} · {S.term[s.term] ?? s.term}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{S.period(day(s.starts_at), day(s.ends_at))}</td>
                    <td style={td}>
                      <SeatBadge state={s.state} endsAt={s.ends_at} now={now} />
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {s.payments.length === 0 ? '—' : null}
                      {s.first_used_at !== null ? <div style={small}>{A.firstUsed(dayTime(s.first_used_at))}</div> : null}
                      {s.payments.map((pm) => (
                        <div key={pm.order_id}>
                          {pm.kind === 'extend' ? A.payExtend(pm.days ?? 0, won(pm.amount_krw), day(pm.paid_at)) : A.payIssue(won(pm.amount_krw), day(pm.paid_at))}
                          {pm.refunded_krw > 0 ? <div style={small}>{S.refundedLine(won(pm.refunded_krw))}</div> : null}
                        </div>
                      ))}
                    </td>
                    <td style={td}>
                      {s.state !== 'refunded' ? (
                        <div style={{ display: 'flex', gap: sp(1), flexWrap: 'wrap' }}>
                          <ExtendForm seatId={s.id} defaultDays={s.term === 'year' ? 365 : 30} busy={busy} onExtend={onExtend} />
                          {s.rule_refund_open && !s.awaiting_payer_choice ? (
                            <Button type="button" variant="paper" disabled={busy} onClick={() => onRule(s)}>
                              {A.refundRule}
                            </Button>
                          ) : null}
                          {s.awaiting_payer_choice && s.rule_refund_open ? <span style={small}>{A.awaiting}</span> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}

export interface ExtendInput {
  days: number;
  amount_krw?: number;
  paid_at?: number;
}

/** `datetime-local` value read as KST wall time → ms; empty or malformed → null. */
export function kstInputToMs(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - 9 * 3_600_000;
}

/** Extension = a payment: days, amount (empty → list price for a whole term), and when the money arrived. */
function ExtendForm({
  seatId,
  defaultDays,
  busy,
  onExtend
}: {
  seatId: string;
  defaultDays: number;
  busy: boolean;
  onExtend: (seatId: string, input: ExtendInput) => void;
}): React.ReactElement {
  const [days, setDays] = useState(String(defaultDays));
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState('');
  return (
    <details data-testid={`extend-${seatId}`}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: px(TOKENS.shape.touchTargetMinPx), display: 'flex', alignItems: 'center' }}>{A.extendTitle}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = Number(days);
          if (!Number.isInteger(d) || d < 1) return;
          const at = kstInputToMs(paidAt);
          onExtend(seatId, { days: d, ...(amount !== '' ? { amount_krw: Number(amount) } : {}), ...(at !== null ? { paid_at: at } : {}) });
        }}
        style={{ display: 'grid', gap: sp(1), marginTop: sp(1), minWidth: '200px' }}
      >
        <label style={labelStyle}>
          {A.extendDays}
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          {A.extendAmount}
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          {A.extendPaidAt}
          <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={inputStyle} />
        </label>
        <div>
          <Button type="submit" variant="brand" disabled={busy}>
            {A.extendSubmit}
          </Button>
        </div>
      </form>
    </details>
  );
}
