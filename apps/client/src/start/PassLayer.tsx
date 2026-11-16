/**
 * Guest pass layer (docs/19 §8, PR #79): on `/world/?pass=` the child enters the friend's world without the title.
 * Entering redeems the code once on this device (or reads this tab's session back with the status), then a chip
 * says whose invitation this is; every request to our API carries the pass header; the 30 minutes run on the server
 * clock out of sight (no clock on a child's screen, AGENTS §4.9 and docs/10 §7) and the end goes to `/guest-end`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldHandle } from '../world/api.js';
import type { FetchLike, KeyStore } from './api.js';
import {
  PASS_END_PATH,
  PASS_STATUS_POLL_MS,
  installPassHeader,
  passDevice,
  passLeftMs,
  passStatus,
  readPassSession,
  redeemPass,
  savePassSession,
  type PassRefusal,
  type PassSession
} from './guestPass.js';
import { START_STRINGS as X } from './strings.js';
import { Say, injectStyle, useHelpKo } from './StartFlow.js';

type View = { kind: 'entering' } | { kind: 'active'; s: PassSession } | { kind: 'refused'; why: Exclude<PassRefusal, 'ended'> };

function sessionStoreOrNull(): KeyStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
function localStoreOrNull(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function GuestPassLayer(props: {
  /** the 8-character code, or '' when the address carried something that is not a pass code */
  code: string;
  world: WorldHandle | null;
  fetchFn?: FetchLike;
  /** where the end goes (tests): default location.replace */
  onEnd?: () => void;
}): React.ReactElement | null {
  const { code, world } = props;
  // Held in refs: a caller passing a fresh arrow each render must not re-run the entry (each redeem spends a lookup).
  const fetchRef = useRef<FetchLike>(props.fetchFn ?? ((i, init) => globalThis.fetch(i, init)));
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const [view, setView] = useState<View>(code ? { kind: 'entering' } : { kind: 'refused', why: 'not_found' });
  const [tries, setTries] = useState(0);
  const ended = useRef(false);
  const help = useHelpKo();
  useEffect(() => injectStyle(), []);
  const end = useMemo(
    () => () => {
      if (ended.current) return;
      ended.current = true;
      savePassSession(sessionStoreOrNull(), null);
      if (onEndRef.current) onEndRef.current();
      else location.replace(PASS_END_PATH);
    },
    []
  );

  // Enter: this tab's session first (status, no lookup spent), else redeem on this device.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const fetchFn = fetchRef.current;
    void (async () => {
      const kept = readPassSession(sessionStoreOrNull(), code);
      if (kept) {
        const st = await passStatus(kept.token, fetchFn);
        if (!alive) return;
        if (st === 'ended') return end();
        const s = st ? { ...kept, ...st } : kept;
        savePassSession(sessionStoreOrNull(), s);
        return setView({ kind: 'active', s });
      }
      const r = await redeemPass(code, passDevice(localStoreOrNull()), fetchFn);
      if (!alive) return;
      if (!r.ok) {
        if (r.why === 'ended') return end();
        return setView({ kind: 'refused', why: r.why });
      }
      savePassSession(sessionStoreOrNull(), r.session);
      setView({ kind: 'active', s: r.session });
    })();
    return () => {
      alive = false;
    };
  }, [code, end, tries]);

  // The title camera while the pass is being checked or refused; the world once inside.
  const active = view.kind === 'active';
  useEffect(() => {
    world?.setAttract?.(!active);
    return () => world?.setAttract?.(false);
  }, [world, active]);

  // Inside: the pass header on our requests, the end timer on the server clock, the clock read again now and then.
  const session = active ? view.s : null;
  const token = session?.token ?? null;
  useEffect(() => {
    if (!token) return;
    return installPassHeader(token);
  }, [token]);
  useEffect(() => {
    if (!session) return;
    const left = passLeftMs(session, Date.now());
    if (left <= 0) {
      end();
      return;
    }
    const t = setTimeout(end, left);
    return () => clearTimeout(t);
  }, [session, end]);
  useEffect(() => {
    if (!token) return;
    const poll = setInterval(() => {
      void passStatus(token, fetchRef.current).then((st) => {
        if (st === 'ended') return end();
        if (st) setView((v) => (v.kind === 'active' && (v.s.endsAt !== st.endsAt || Math.abs(v.s.skewMs - st.skewMs) > 2000) ? { kind: 'active', s: { ...v.s, ...st } } : v));
      });
    }, PASS_STATUS_POLL_MS);
    return () => clearInterval(poll);
  }, [token, end]);

  if (view.kind === 'entering') {
    return (
      <div className="lcw-invite lcw-card" role="status" aria-live="polite" data-testid="pass-entering">
        <b>
          🎟️ <Say line={X.pass.entering} help={help} />
        </b>
      </div>
    );
  }
  if (view.kind === 'refused') {
    const [title, hint] =
      view.why === 'in_use'
        ? [X.pass.inUse, X.pass.inUseHint]
        : view.why === 'not_found'
          ? [X.pass.notFound, X.pass.notFoundHint]
          : view.why === 'busy'
            ? [X.pass.busy, X.pass.busyHint]
            : [X.pass.retry, X.pass.retryHint];
    return (
      <div className="lcw-invite lcw-card" role="alertdialog" data-testid={`pass-${view.why}`} style={{ top: '30%' }}>
        <b>
          <Say line={title} help={help} />
        </b>
        <span>
          <Say line={hint} help={help} />
        </span>
        <div className="lcw-invite__row">
          <a className="lcw-btn" href="/world/">
            <Say line={X.pass.home} help={help} />
          </a>
          {view.why === 'retry' ? (
            <button type="button" className="lcw-btn lcw-btn--main" onClick={() => setTries((n) => n + 1)}>
              <Say line={X.pass.again} help={help} />
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="lcw-pass-chip" role="status" data-testid="pass-chip">
      <Say line={X.pass.chip(view.s.hostNickname)} help={help} />
    </div>
  );
}
