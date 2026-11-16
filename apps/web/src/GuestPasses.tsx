/**
 * 친구 초대권 (guest pass) on /family (server apps/edge/src/free-play.ts, outsider lane #79): the guardian of a live seat gives a
 * friend one code / link for 30 minutes of the child's world, two per seat per KST month, and can take back a pass
 * nobody entered yet (its slot comes back) or stop a running one (its slot stays used).
 * Only on the guardian screen; the child's screen shows no dates, codes or counts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import type { FamilyApi, GuestPass, GuestPassSummary } from './familyApi.js';
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

/** One line per pass state, in words. */
export function passLine(p: GuestPass): string {
  if (p.state === 'ready') return P.stateReady(day(p.redeem_until));
  if (p.state === 'active') return P.stateActive(when(p.ends_at));
  if (p.state === 'ended') return P.stateEnded;
  if (p.state === 'expired') return P.stateExpired;
  return P.stateRevoked;
}

/** What the guardian sees: presentational, so tests can render each state without a server. */
export function GuestPassesView({
  passes,
  summary,
  busy,
  notice,
  onIssue,
  onRevoke,
  onCopy,
  copiedId,
  origin
}: {
  passes: readonly GuestPass[];
  summary: GuestPassSummary;
  busy: boolean;
  notice: string | null;
  onIssue: () => void;
  onRevoke: (p: GuestPass) => void;
  onCopy: (p: GuestPass) => void;
  copiedId: string | null;
  origin: string;
}): React.ReactElement {
  const shown = passes.filter((p) => p.state === 'ready' || p.state === 'active' || p.state === 'ended').slice(0, 6);
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
              <span style={small}>{passLine(p)}</span>
              {p.state === 'ready' || p.state === 'active' ? (
                <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
                  {p.state === 'ready' ? (
                    <Button type="button" variant="paper" disabled={busy} onClick={() => onCopy(p)} data-testid={`guest-pass-copy-${p.id}`}>
                      {copiedId === p.id ? P.copied : P.copy}
                    </Button>
                  ) : null}
                  <Button type="button" variant="paper" disabled={busy} onClick={() => onRevoke(p)} data-testid={`guest-pass-revoke-${p.id}`}>
                    {p.state === 'ready' ? P.revoke : P.stop}
                  </Button>
                </div>
              ) : null}
              {p.state === 'ready' ? <span style={{ ...small, wordBreak: 'break-all' }}>{`${origin}${p.link}`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <Notice kind="info" testId="guest-passes-notice">
          {notice}
        </Notice>
      ) : null}
      <div>
        <Button type="button" variant="brand" disabled={busy || none} onClick={onIssue} data-testid="guest-pass-issue">
          {P.issue}
        </Button>
      </div>
      <span style={small}>{P.rules}</span>
    </div>
  );
}

/** Loads the seat's passes and runs issue / revoke / copy. */
export function GuestPasses({ api, token, seatId }: { api: FamilyApi; token: string; seatId: string }): React.ReactElement | null {
  const [data, setData] = useState<({ passes: GuestPass[] } & GuestPassSummary) | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api.guestPasses(token, seatId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api, token, seatId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed && !data)
    return (
      <Notice kind="error" onRetry={() => void load()} retryLabel={P.retry}>
        {P.error}
      </Notice>
    );
  if (!data) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const run = async (fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      const code = errorCodeOf(e);
      setNotice(code === 'monthly_limit' ? P.limit(data.per_month, day(data.resets_at)) : code === 'seat_inactive' ? P.seatInactive : P.error);
    } finally {
      setBusy(false);
      await load();
    }
  };
  return (
    <GuestPassesView
      passes={data.passes}
      summary={data}
      busy={busy}
      notice={notice}
      copiedId={copiedId}
      origin={origin}
      onIssue={() =>
        void run(async () => {
          const r = await api.issueGuestPass(token, seatId);
          return P.issued(r.pass.code);
        })
      }
      onRevoke={(p) =>
        void run(async () => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(p.state === 'ready' ? P.confirmRevoke : P.confirmStop)) return null;
          await api.revokeGuestPass(token, p.id);
          return p.state === 'ready' ? P.revoked : P.stopped;
        })
      }
      onCopy={(p) => {
        const text = P.shareText(p.code, `${origin}${p.link}`, data.minutes);
        void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard')))
          .then(() => setCopiedId(p.id))
          .catch(() => setNotice(P.copyFallback));
      }}
    />
  );
}
