/**
 * 친구 초대권 (guest pass) on /family (server apps/edge/src/free-play.ts, outsider lane #79): the guardian of a live seat gives a
 * friend one code / link for 30 minutes of the child's world, a few per seat per KST month, and can take back a pass
 * nobody entered yet or stop a running one. Which passes count against the month is the server's rule (#96: a pass
 * nobody entered stops counting when taken back or when its days to enter run out; soon the month a friend first
 * entered). The screen never works it out itself: it shows the server's left_this_month and says a slot came back
 * only when that number went up.
 * Only on the guardian screen; the child's screen shows no dates, codes or counts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import type { FamilyApi, FamilySeat, GuestPass, GuestPassSummary } from './familyApi.js';
import { errorCodeOf } from './lessonApi.js';
import { kstLabel } from './lessonFlow.js';
import { Notice, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const P = PARENT_STRINGS_KO.guestPasses;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };
const day = (ms: number | null) => kstLabel(ms, false).replace(/^\d{4}년 /, '');
const when = (ms: number | null) => kstLabel(ms, true);

export type PassNotice = { kind: 'ok' | 'info' | 'error'; text: string };

/** A friend pass belongs to a live seat of this family's own child (another family's Duo seat is theirs to give). */
export function passBoxFor(s: Pick<FamilySeat, 'child' | 'state'>): boolean {
  return Boolean(s.child) && (s.state === 'active' || s.state === 'expiring');
}

/** The pass can still be taken back (nobody entered yet) or stopped (a friend is playing). */
export function canTakeBack(p: GuestPass): boolean {
  return p.state === 'ready' || p.state === 'active';
}

/**
 * Passes worth a line: live ones and ones a friend played on (ended, or stopped mid-play: the server marks those revoked
 * with started_at). Passes nobody entered that were taken back or ran out of days are gone: they count for nothing.
 */
export function shownPasses(passes: readonly GuestPass[]): GuestPass[] {
  return passes.filter((p) => p.state === 'ready' || p.state === 'active' || p.state === 'ended' || (p.state === 'revoked' && p.started_at !== null)).slice(0, 6);
}

/** One line per pass state, in words. */
export function passLine(p: GuestPass): string {
  if (p.state === 'ready') return P.stateReady(when(p.redeem_until));
  if (p.state === 'active') return P.stateActive(when(p.ends_at));
  if (p.state === 'ended') return P.stateEnded;
  if (p.state === 'expired') return P.stateExpired;
  // The server marks a pass stopped mid-play as revoked too.
  return p.started_at !== null ? P.stateStopped : P.stateRevoked;
}

/** The confirm question for taking back / stopping, from the pass's fresh state. */
export function confirmText(p: GuestPass): string {
  return p.state === 'active' ? P.confirmStop : P.confirmRevoke;
}

/**
 * What happened, from the server's answer (not from the screen's older copy of the pass): stopped mid-play, or taken
 * back; a slot came back only when the server's count of passes left went up.
 */
export function revokeDone(after: GuestPass, leftBefore: number, leftAfter: number): string {
  if (after.started_at !== null) return P.stopped;
  return leftAfter > leftBefore ? P.revoked : P.revokedPlain;
}

/** A refused or failed action, in words. */
export function actionNotice(code: string | null, s: Pick<GuestPassSummary, 'per_month' | 'resets_at'>): string {
  if (code === 'monthly_limit') return P.limit(s.per_month, day(s.resets_at));
  if (code === 'seat_inactive') return P.seatInactive;
  if (code === 'service_consent_required') return P.needConsent;
  if (code === 'pass_not_found') return P.gone;
  return P.actionError;
}

/** What the guardian sees: presentational, so tests can render each state without a server. */
export function GuestPassesView({
  passes,
  summary,
  busy,
  notice,
  stale,
  onIssue,
  onRevoke,
  onCopy,
  onReload,
  copiedId,
  origin
}: {
  passes: readonly GuestPass[];
  summary: GuestPassSummary;
  busy: boolean;
  notice: PassNotice | null;
  /** The last refresh failed: what is shown may be old. */
  stale?: boolean;
  onIssue: () => void;
  onRevoke: (p: GuestPass) => void;
  onCopy: (p: GuestPass) => void;
  onReload?: () => void;
  copiedId: string | null;
  origin: string;
}): React.ReactElement {
  const shown = shownPasses(passes);
  const none = summary.left_this_month <= 0;
  return (
    <div data-testid="guest-passes" style={{ display: 'grid', gap: sp(2), borderTop: `1px solid ${C['line-200']}`, paddingTop: sp(2) }}>
      <strong>{P.title}</strong>
      <p style={{ margin: 0 }}>{P.body(summary.minutes)}</p>
      <span style={small} data-testid="guest-passes-left">
        {none ? P.noneLeft(day(summary.resets_at)) : P.left(summary.left_this_month, summary.per_month)}
      </span>
      {shown.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
          {shown.map((p) => (
            <li key={p.id} data-testid={`guest-pass-${p.id}`} style={{ display: 'grid', gap: '4px', background: C['paper-50'], border: `1px solid ${C['line-200']}`, borderRadius: px(TOKENS.shape.radiusButtonPx), padding: sp(2) }}>
              <span style={{ fontWeight: 800, fontSize: px(T.scale.h3.sizePx), letterSpacing: '0.08em', wordBreak: 'keep-all' }}>{p.code}</span>
              <span style={{ ...small, wordBreak: 'keep-all' }}>{passLine(p)}</span>
              {canTakeBack(p) ? (
                <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
                  {p.state === 'ready' ? (
                    <Button type="button" variant="paper" disabled={busy} onClick={() => onCopy(p)} data-testid={`guest-pass-copy-${p.id}`}>
                      {copiedId === p.id ? P.copied : P.copy}
                    </Button>
                  ) : null}
                  <Button type="button" variant="paper" disabled={busy} onClick={() => onRevoke(p)} data-testid={`guest-pass-revoke-${p.id}`}>
                    {p.state === 'active' ? P.stop : P.revoke}
                  </Button>
                </div>
              ) : null}
              {p.state === 'ready' ? <span style={{ ...small, wordBreak: 'break-all' }}>{`${origin}${p.link}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <Notice kind={notice.kind} testId="guest-passes-notice">
          <span style={{ wordBreak: 'keep-all' }}>{notice.text}</span>
        </Notice>
      ) : null}
      {stale ? (
        <Notice kind="error" testId="guest-passes-stale" onRetry={onReload} retryLabel={P.retry}>
          {P.stale}
        </Notice>
      ) : null}
      <div>
        <Button type="button" variant="brand" disabled={busy || none} onClick={onIssue} data-testid="guest-pass-issue">
          {P.issue}
        </Button>
      </div>
      <span style={{ ...small, wordBreak: 'keep-all' }}>{P.rules}</span>
    </div>
  );
}

type Data = { passes: GuestPass[] } & GuestPassSummary;

/** Loads the seat's passes and runs issue / take back / copy. Refreshes when the guardian comes back to the tab. */
export function GuestPasses({ api, token, seatId }: { api: FamilyApi; token: string; seatId: string }): React.ReactElement | null {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PassNotice | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async (): Promise<Data | null> => {
    try {
      const d = await api.guestPasses(token, seatId);
      setData(d);
      setFailed(null);
      return d;
    } catch (e) {
      setFailed(errorCodeOf(e));
      return null;
    }
  }, [api, token, seatId]);
  useEffect(() => {
    void load();
    if (typeof document === 'undefined') return undefined;
    // A friend may have entered while this tab sat in the background: read the passes again on return.
    const onShow = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [load]);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  if (failed && !data)
    return failed === 'service_consent_required' ? (
      <span style={small} data-testid="guest-passes-consent">
        {P.needConsent}
      </span>
    ) : (
      <Notice kind="error" onRetry={() => void load()} retryLabel={P.retry}>
        {P.error}
      </Notice>
    );
  if (!data) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  /** fn returns the notice to show, or undefined when the guardian cancelled (the last notice stays). */
  const run = async (fn: () => Promise<PassNotice | undefined>) => {
    if (busy) return;
    setBusy(true);
    try {
      const n = await fn();
      if (n !== undefined) setNotice(n);
    } catch (e) {
      setNotice({ kind: 'error', text: actionNotice(errorCodeOf(e), data) });
    } finally {
      await load();
      setBusy(false);
    }
  };
  return (
    <GuestPassesView
      passes={data.passes}
      summary={data}
      busy={busy}
      notice={notice}
      stale={failed !== null}
      onReload={() => void load()}
      copiedId={copiedId}
      origin={origin}
      onIssue={() =>
        void run(async () => {
          const r = await api.issueGuestPass(token, seatId);
          return { kind: 'ok', text: P.issued(r.pass.code) };
        })
      }
      onRevoke={(p) =>
        void run(async () => {
          // The screen's copy may be old (a friend may have entered since): ask about the pass as the server has it now.
          const list = await api.guestPasses(token, seatId);
          const fresh = list.passes.find((x) => x.id === p.id);
          if (!fresh || !canTakeBack(fresh)) return { kind: 'info', text: P.changed };
          if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(confirmText(fresh))) return undefined;
          const r = await api.revokeGuestPass(token, p.id);
          return { kind: 'ok', text: revokeDone(r.pass, list.left_this_month, r.left_this_month) };
        })
      }
      onCopy={(p) => {
        const text = P.shareText(p.code, `${origin}${p.link}`, data.minutes);
        void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard')))
          .then(() => {
            setCopiedId(p.id);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopiedId(null), 4000);
          })
          .catch(() => setNotice({ kind: 'info', text: P.copyFallback }));
      }}
    />
  );
}
