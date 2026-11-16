/**
 * Guest pass layer (docs/19 §8, PR #79): on `/world/?pass=` the child enters the friend's world without the title.
 * Entering redeems the code once on this device (or reads this tab's session back with the status), then a chip
 * counts the time left on the server clock; every request to our API carries the pass header; at zero, or when the
 * server says the pass ended, the page goes to `/guest-end`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldHandle } from '../world/api.js';
import type { FetchLike, KeyStore } from './api.js';
import {
  PASS_END_PATH,
  PASS_STATUS_POLL_MS,
  installPassHeader,
  mmss,
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
import { injectStyle } from './StartFlow.js';

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
  code: string;
  world: WorldHandle | null;
  fetchFn?: FetchLike;
  /** where the end goes (tests): default location.replace */
  onEnd?: () => void;
}): React.ReactElement | null {
  const { code, world } = props;
  const fetchFn = useMemo<FetchLike>(() => props.fetchFn ?? ((i, init) => globalThis.fetch(i, init)), [props.fetchFn]);
  const [view, setView] = useState<View>({ kind: 'entering' });
  const [tries, setTries] = useState(0);
  const [, setTick] = useState(0);
  const ended = useRef(false);
  useEffect(() => injectStyle(), []);
  const end = useMemo(
    () => () => {
      if (ended.current) return;
      ended.current = true;
      savePassSession(sessionStoreOrNull(), null);
      if (props.onEnd) props.onEnd();
      else location.replace(PASS_END_PATH);
    },
    [props.onEnd]
  );

  // Enter: this tab's session first (status, no lookup spent), else redeem on this device.
  useEffect(() => {
    let alive = true;
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
  }, [code, fetchFn, end, tries]);

  // The title camera while the pass is being checked or refused; the world once inside.
  const active = view.kind === 'active';
  useEffect(() => {
    world?.setAttract?.(!active);
  }, [world, active]);

  // Inside: the pass header on our requests, the countdown, and the server clock read again now and then.
  const token = active ? view.s.token : null;
  useEffect(() => {
    if (!token) return;
    return installPassHeader(token);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    const poll = setInterval(() => {
      void passStatus(token, fetchFn).then((st) => {
        if (st === 'ended') return end();
        if (st) setView((v) => (v.kind === 'active' ? { kind: 'active', s: { ...v.s, ...st } } : v));
      });
    }, PASS_STATUS_POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [token, fetchFn, end]);

  const left = active ? passLeftMs(view.s, Date.now()) : null;
  useEffect(() => {
    if (left === 0) end();
  }, [left, end]);

  if (view.kind === 'entering') {
    return (
      <div className="lcw-invite lcw-card" role="status" aria-live="polite" data-testid="pass-entering">
        <b>🎟️ {X.pass.entering}</b>
      </div>
    );
  }
  if (view.kind === 'refused') {
    const [title, hint] =
      view.why === 'in_use' ? [X.pass.inUse, X.pass.inUseHint] : view.why === 'not_found' ? [X.pass.notFound, X.pass.notFoundHint] : [X.pass.retry, X.pass.retryHint];
    return (
      <div className="lcw-invite lcw-card" role="alertdialog" data-testid={`pass-${view.why}`} style={{ top: '30%' }}>
        <b>{title}</b>
        <span>{hint}</span>
        <div className="lcw-invite__row">
          <a className="lcw-btn" href="/world/">
            {X.pass.home}
          </a>
          {view.why === 'retry' ? (
            <button type="button" className="lcw-btn lcw-btn--main" onClick={() => setTries((n) => n + 1)}>
              {X.pass.again}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="lcw-pass-chip" role="timer" aria-live="off" data-testid="pass-chip">
      {X.pass.chip(view.s.hostNickname, mmss(left ?? 0))}
    </div>
  );
}
