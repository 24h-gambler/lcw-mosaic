/**
 * "/family" notices card (docs/09 §12): turn Web Push on for this device so seat expiry and refund results reach
 * the guardian without KakaoTalk or SMS (cost 0). Registers /family-sw.js (scope /family) and the PWA manifest.
 * iPhone/iPad only allow push for a Home Screen app, and in-app browsers (KakaoTalk) have no push at all — the card
 * says what to do instead of showing a dead button.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import type { FamilyApi, PushState } from './familyApi.js';
import { errorCodeOf } from './lessonApi.js';
import { Box, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const P = PARENT_STRINGS_KO.push;
const C = TOKENS.colors;
const T = TOKENS.typography;
const small: React.CSSProperties = { fontSize: `${T.scale.small.sizePx}px`, lineHeight: `${T.scale.small.lineHeightPx}px`, color: C['ink-700'] };

export const FAMILY_SW_URL = '/family-sw.js';
export const FAMILY_SW_SCOPE = '/family';

export type PushSupport = 'ok' | 'ios_install' | 'in_app' | 'unsupported';

/** What this browser can do, from its features and user agent. Pure for tests. */
export function pushSupport(env: { ua: string; hasSw: boolean; hasPush: boolean; hasNotification: boolean; standalone: boolean }): PushSupport {
  if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(env.ua)) return 'in_app';
  const ios = /iPhone|iPad|iPod/.test(env.ua) || (/Macintosh/.test(env.ua) && /Mobile\//.test(env.ua));
  if (ios && !env.standalone) return 'ios_install';
  return env.hasSw && env.hasPush && env.hasNotification ? 'ok' : 'unsupported';
}

export function browserPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return pushSupport({
    ua: navigator.userAgent,
    hasSw: 'serviceWorker' in navigator,
    hasPush: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    standalone: Boolean(standalone)
  });
}

/** Manifest + icons in <head> while /family is open, so "Add to Home Screen" installs the guardian app. */
export function useFamilyManifest(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const added: HTMLElement[] = [];
    const add = (tag: string, attrs: Record<string, string>) => {
      if (document.head.querySelector(`${tag}[data-family="${attrs.rel ?? attrs.name}"]`)) return;
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.setAttribute('data-family', attrs.rel ?? attrs.name ?? '');
      document.head.appendChild(el);
      added.push(el);
    };
    add('link', { rel: 'manifest', href: '/family.webmanifest' });
    add('link', { rel: 'apple-touch-icon', href: '/icons/family-180.png' });
    add('meta', { name: 'theme-color', content: C['paper-50'] });
    add('meta', { name: 'apple-mobile-web-app-title', content: '우리 가족' });
    return () => added.forEach((el) => el.remove());
  }, []);
}

const toB64url = (buf: ArrayBuffer | null) => {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

export interface PushBrowser {
  register(): Promise<ServiceWorkerRegistration>;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

const realBrowser: PushBrowser = {
  register: () => navigator.serviceWorker.register(FAMILY_SW_URL, { scope: FAMILY_SW_SCOPE }),
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission()
};

export interface FamilyPushProps {
  api: FamilyApi;
  token: string;
  support?: PushSupport;
  browser?: PushBrowser;
  /** For screenshots and tests. */
  initial?: { state: PushState; subscribed: boolean };
}

type View = 'loading' | 'off' | 'on' | 'denied' | 'error';

export function FamilyPush(p: FamilyPushProps): React.ReactElement {
  const support = p.support ?? browserPushSupport();
  const browser = p.browser ?? realBrowser;
  const reg = useRef<ServiceWorkerRegistration | null>(null);
  const [view, setView] = useState<View>(p.initial ? (p.initial.subscribed ? 'on' : 'off') : 'loading');
  const [state, setState] = useState<PushState | null>(p.initial?.state ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      reg.current = await browser.register();
      const sub = await reg.current.pushManager.getSubscription();
      const st = await p.api.pushState(p.token, sub?.endpoint ?? null);
      setState(st);
      // A browser subscription the server lost (or dropped as gone) is renewed quietly.
      if (sub && !st.this_device && browser.permission() === 'granted') {
        await p.api.pushSubscribe(p.token, subJson(sub));
        setState({ ...st, this_device: true, devices: st.devices + 1 });
        return setView('on');
      }
      setView(browser.permission() === 'denied' ? 'denied' : sub && st.this_device ? 'on' : 'off');
    } catch {
      setView('error');
    }
  }, [browser, p.api, p.token]);

  useEffect(() => {
    if (p.initial || support !== 'ok') return;
    void refresh();
  }, [p.initial, support, refresh]);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await browser.requestPermission();
      if (perm !== 'granted') {
        setView(perm === 'denied' ? 'denied' : 'off');
        return;
      }
      reg.current = reg.current ?? (await browser.register());
      const st = state ?? (await p.api.pushState(p.token, null));
      const sub =
        (await reg.current.pushManager.getSubscription()) ??
        (await reg.current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(st.public_key) }));
      await p.api.pushSubscribe(p.token, subJson(sub));
      setState({ ...st, this_device: true, devices: st.devices + (st.this_device ? 0 : 1) });
      setView('on');
    } catch {
      setMsg(P.failed);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const sub = await reg.current?.pushManager.getSubscription();
      if (sub) {
        await p.api.pushUnsubscribe(p.token, sub.endpoint).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      setState((s) => (s ? { ...s, this_device: false, devices: Math.max(0, s.devices - 1) } : s));
      setView('off');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await p.api.pushTest(p.token);
      setMsg(P.testSent);
    } catch (e) {
      setMsg(errorCodeOf(e) === 'too_soon' ? P.testTooSoon : P.failed);
    } finally {
      setBusy(false);
    }
  };

  const others = state ? Math.max(0, state.devices - (view === 'on' ? 1 : 0)) : 0;
  return (
    <Box title={P.title} testId="family-push">
      <div style={{ display: 'grid', gap: sp(2) }}>
        <p style={{ margin: 0 }}>{P.lead}</p>
        {support === 'in_app' ? <p style={{ ...small, margin: 0 }} data-testid="push-in-app">{P.inApp}</p> : null}
        {support === 'ios_install' ? <p style={{ ...small, margin: 0 }} data-testid="push-ios">{P.iosInstall}</p> : null}
        {support === 'unsupported' ? <p style={{ ...small, margin: 0 }}>{P.unsupported}</p> : null}
        {support === 'ok' && view === 'denied' ? <p style={{ ...small, margin: 0 }} role="alert">{P.denied}</p> : null}
        {support === 'ok' && view === 'error' ? <p style={{ ...small, margin: 0 }} role="alert">{P.failed}</p> : null}
        {support === 'ok' && (view === 'off' || view === 'denied' || view === 'error') ? (
          <div>
            <Button type="button" variant="brand" disabled={busy} onClick={() => void turnOn()} data-testid="push-on">
              {P.on}
            </Button>
          </div>
        ) : null}
        {support === 'ok' && view === 'on' ? (
          <>
            <p style={{ margin: 0, fontWeight: 700, color: C['leaf-d'] }} data-testid="push-on-state">
              {P.onState}
            </p>
            <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
              {state?.sending ? (
                <Button type="button" variant="paper" disabled={busy} onClick={() => void test()} data-testid="push-test">
                  {P.test}
                </Button>
              ) : null}
              <Button type="button" variant="paper" disabled={busy} onClick={() => void turnOff()} data-testid="push-off">
                {P.off}
              </Button>
            </div>
          </>
        ) : null}
        {others > 0 ? <p style={{ ...small, margin: 0 }}>{P.otherDevices(others)}</p> : null}
        {state && !state.sending && support === 'ok' ? <p style={{ ...small, margin: 0 }} data-testid="push-preparing">{P.preparing}</p> : null}
        {msg ? <p style={{ ...small, margin: 0 }} role="status">{msg}</p> : null}
      </div>
    </Box>
  );
}

function subJson(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string }; label: string } {
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: toB64url(sub.getKey('p256dh')), auth: toB64url(sub.getKey('auth')) },
    label: /Android/.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : 'PC'
  };
}
