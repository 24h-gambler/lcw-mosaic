/**
 * /family — the guardian's space (WP-301, docs/16 §3, docs/10 §5): first-entry required consent, the optional consents
 * toggled one by one (no "turn everything on" button), child profiles, device link codes, and the lesson report links
 * with a way to close one. /link — the child's device side of the link code.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import {
  GUARDIAN_CONSENT_SCOPES,
  createFamilyApi,
  inviteFromHash,
  loadDevice,
  loadGuardianToken,
  saveDevice,
  saveGuardianToken,
  type FamilyApi,
  type FamilyChild,
  type FamilyMe,
  type GuardianConsentScope
} from './familyApi.js';
import { errorCodeOf } from './lessonApi.js';
import { kstLabel } from './lessonFlow.js';
import { Box, LessonStyle, Notice, border, inputStyle, labelStyle, sp } from './lessonUi.js';
import { lessonDayLabel } from './ParentReportPage.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const F = PARENT_STRINGS_KO.family;
const LK = PARENT_STRINGS_KO.link;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };

export type FamilyLoad =
  | { status: 'loading' }
  | { status: 'no_session'; inviteInvalid?: boolean }
  | { status: 'ok'; me: FamilyMe }
  | { status: 'error' };

export interface FamilyPageProps {
  api?: FamilyApi;
  initial?: FamilyLoad;
  /** For tests: skips reading location.hash and storage. */
  initialToken?: string | null;
}

export function FamilyPage({ api, initial, initialToken }: FamilyPageProps): React.ReactElement {
  const apiRef = useRef<FamilyApi>(api ?? createFamilyApi());
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [load, setLoad] = useState<FamilyLoad>(initial ?? { status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (g: string) => {
    try {
      setLoad({ status: 'ok', me: await apiRef.current.me(g) });
    } catch (e) {
      if (errorCodeOf(e) === 'guardian_only') {
        saveGuardianToken(null);
        setToken(null);
        setLoad({ status: 'no_session' });
      } else setLoad({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    void (async () => {
      const invite = typeof window !== 'undefined' ? inviteFromHash(window.location.hash) : null;
      if (invite) {
        // The code is one-time: clear it from the address bar before anything else can copy it.
        window.history.replaceState(null, '', window.location.pathname);
        try {
          const s = await apiRef.current.startSession(invite);
          saveGuardianToken(s.guardian_token);
          setToken(s.guardian_token);
          await refresh(s.guardian_token);
          return;
        } catch (e) {
          if (errorCodeOf(e) === 'network') return setLoad({ status: 'error' });
          const stored = loadGuardianToken();
          if (!stored) return setLoad({ status: 'no_session', inviteInvalid: true });
        }
      }
      const g = initialToken ?? loadGuardianToken();
      if (!g) return setLoad({ status: 'no_session' });
      setToken(g);
      await refresh(g);
    })();
  }, [initial, initialToken, refresh]);

  const act = async (fn: (g: string) => Promise<unknown>, onError?: (code: string) => string | null) => {
    if (!token || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn(token);
      await refresh(token);
    } catch (e) {
      setNotice(onError?.(errorCodeOf(e)) ?? F.errorBody);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="lcw-lesson"
      data-testid="family-page"
      style={{ maxWidth: '640px', margin: '0 auto', display: 'grid', gap: sp(4), fontFamily: T.fonts.ui, wordBreak: 'keep-all', color: C['ink-900'] }}
    >
      <LessonStyle />
      <style>{FAMILY_CSS}</style>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: px(T.scale.h1.sizePx), lineHeight: px(T.scale.h1.lineHeightPx) }}>{F.title}</h1>
        {token && load.status === 'ok' ? (
          <Button
            type="button"
            variant="paper"
            onClick={() => {
              void apiRef.current.logout(token).catch(() => undefined);
              saveGuardianToken(null);
              setToken(null);
              setLoad({ status: 'no_session' });
            }}
          >
            {F.logout}
          </Button>
        ) : null}
      </header>
      {load.status === 'loading' ? <Box><p style={{ margin: 0 }}>{F.loading}</p></Box> : null}
      {load.status === 'no_session' ? (
        <Box title={F.noSessionTitle} testId="family-no-session">
          {load.inviteInvalid ? <Notice kind="error">{F.inviteInvalid}</Notice> : null}
          <p style={{ margin: 0 }}>{F.noSessionBody}</p>
        </Box>
      ) : null}
      {load.status === 'error' ? (
        <Box>
          <Notice kind="error" onRetry={() => token && void refresh(token)} retryLabel={F.retry}>
            {F.errorBody}
          </Notice>
        </Box>
      ) : null}
      {notice ? <Notice kind="error">{notice}</Notice> : null}
      {load.status === 'ok' && !load.me.service_consented ? (
        <Box title={F.serviceTitle} tone="tinted" testId="family-service">
          <p style={{ marginTop: 0 }}>{F.serviceBody}</p>
          <p style={small}>{F.serviceRefuse}</p>
          <Button type="button" variant="brand" disabled={busy} onClick={() => void act((g) => apiRef.current.acceptService(g))}>
            {F.serviceAccept}
          </Button>
        </Box>
      ) : null}
      {load.status === 'ok'
        ? load.me.children.map((k) => (
            <ChildCard
              key={k.player_id}
              child={k}
              enabled={load.me.service_consented && !busy}
              api={apiRef.current}
              token={token}
              onAct={act}
            />
          ))
        : null}
      {load.status === 'ok' && load.me.service_consented ? (
        <AddChild
          disabled={busy}
          onAdd={(nickname, birthYear) =>
            act(
              (g) => apiRef.current.addChild(g, { nickname, birth_year: birthYear }),
              (code) => (code === 'nickname_rejected' ? F.addRejected : null)
            )
          }
        />
      ) : null}
    </main>
  );
}

const FAMILY_CSS = `
.lcw-switch { position: relative; flex: none; width: 56px; height: 32px; border: ${border}; border-radius: 999px; background: ${C['paper-100']}; cursor: pointer; padding: 0; }
.lcw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border: 2px solid ${C['ink-900']}; border-radius: 999px; background: ${C['paper-0']}; box-sizing: border-box; transition: left ${TOKENS.motion.fastMs}ms ease-out; }
.lcw-switch[aria-checked="true"] { background: ${C.leaf}; }
.lcw-switch[aria-checked="true"]::after { left: 26px; }
@media (prefers-reduced-motion: reduce) { .lcw-switch::after { transition: none; } }
`;

function ChildCard({
  child,
  enabled,
  api,
  token,
  onAct
}: {
  child: FamilyChild;
  enabled: boolean;
  api: FamilyApi;
  token: string | null;
  onAct: (fn: (g: string) => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  const [code, setCode] = useState<{ code: string; expires_at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!code) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const left = code ? Math.max(0, code.expires_at - now) : 0;
  const mmss = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;

  return (
    <Box testId={`family-child-${child.player_id}`}>
      <div style={{ display: 'grid', gap: sp(0), marginBottom: sp(3) }}>
        <h2 style={{ margin: 0, fontSize: px(T.scale.h2.sizePx), lineHeight: px(T.scale.h2.lineHeightPx) }}>{child.nickname}</h2>
        <span style={small}>{F.childMeta(child.level, child.birth_year, child.lessons)}</span>
        {child.consents.lesson_window ? (
          <a
            href={`/window?child=${encodeURIComponent(child.player_id)}`}
            data-testid={`open-window-${child.player_id}`}
            style={{ marginTop: sp(2), fontWeight: 700, color: C['sky-d'] }}
          >
            {PARENT_STRINGS_KO.window.open}
          </a>
        ) : null}
      </div>

      <section style={{ display: 'grid', gap: sp(2) }} aria-labelledby={`consents-${child.player_id}`}>
        <h3 id={`consents-${child.player_id}`} style={h3}>
          {F.consentsTitle}
        </h3>
        <p style={{ ...small, margin: 0 }}>{F.consentsNote}</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
          {GUARDIAN_CONSENT_SCOPES.map((scope) => (
            <ConsentRow
              key={scope}
              scope={scope}
              on={child.consents[scope]}
              disabled={!enabled}
              onToggle={(v) => void onAct((g) => api.setConsent(g, child.player_id, scope, v))}
            />
          ))}
        </ul>
      </section>

      <section style={{ display: 'grid', gap: sp(2), marginTop: sp(4) }}>
        <h3 style={h3}>{F.devicesTitle}</h3>
        {child.devices.length === 0 ? <p style={{ ...small, margin: 0 }}>{F.devicesEmpty}</p> : null}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
          {child.devices.map((d) => (
            <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
              <span>
                <strong>{d.label}</strong> <span style={small}>{F.deviceSeen(kstLabel(d.last_seen_at ?? d.created_at))}</span>
              </span>
              <Button
                type="button"
                variant="paper"
                disabled={!enabled}
                onClick={() => {
                  if (typeof window === 'undefined' || window.confirm(F.deviceRemoveConfirm(d.label))) void onAct((g) => api.removeDevice(g, d.id));
                }}
              >
                {F.deviceRemove}
              </Button>
            </li>
          ))}
        </ul>
        {code && left > 0 ? (
          <div data-testid="device-code" style={{ border, borderRadius: px(TOKENS.shape.radiusCardPx), padding: sp(3), backgroundColor: C['paper-50'], display: 'grid', gap: sp(1), textAlign: 'center' }}>
            <strong>{F.codeTitle}</strong>
            <span style={small}>{F.codeHow('/link')}</span>
            <span
              aria-live="polite"
              style={{ fontFamily: T.fonts.target, fontSize: px(T.scale.display.sizePx), lineHeight: px(T.scale.display.lineHeightPx), letterSpacing: '0.2em', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              {code.code}
            </span>
            <span style={small}>{F.codeLeft(mmss)}</span>
          </div>
        ) : code ? (
          <p style={{ ...small, margin: 0 }}>{F.codeExpired}</p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="sky"
            disabled={!enabled || !token}
            onClick={() =>
              void onAct(async (g) => {
                const c = await api.deviceCode(g, child.player_id);
                setNow(Date.now());
                setCode(c);
              })
            }
          >
            {F.makeCode}
          </Button>
        </div>
      </section>

      <section style={{ display: 'grid', gap: sp(2), marginTop: sp(4) }}>
        <h3 style={h3}>{F.reportsTitle}</h3>
        {child.reports.length === 0 ? <p style={{ ...small, margin: 0 }}>{F.reportsEmpty}</p> : null}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
          {child.reports.map((r) => {
            const state = r.revoked ? F.reportState.revoked : r.expired ? F.reportState.expired : r.opened ? F.reportState.opened : F.reportState.unopened;
            const live = !r.revoked && !r.expired;
            return (
              <li key={r.share_path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap', borderBottom: `1px solid ${C['line-200']}`, padding: `${sp(1)} 0` }}>
                <span>
                  <strong>{lessonDayLabel(r.lesson_day)}</strong> <span style={small}>{state}</span>
                </span>
                <span style={{ display: 'flex', gap: sp(1), alignItems: 'center' }}>
                  {live ? (
                    <a href={r.share_path} style={{ color: C['sky-d'], fontWeight: 700, padding: sp(1), minHeight: px(TOKENS.shape.touchTargetMinPx), display: 'inline-flex', alignItems: 'center' }}>
                      {F.reportOpen}
                    </a>
                  ) : null}
                  {live ? (
                    <Button
                      type="button"
                      variant="paper"
                      disabled={!token}
                      onClick={() => {
                        if (typeof window === 'undefined' || window.confirm(F.reportCloseConfirm)) void onAct((g) => api.revokeReport(g, r.share_path));
                      }}
                    >
                      {F.reportClose}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </Box>
  );
}

const h3: React.CSSProperties = { margin: 0, fontSize: px(T.scale.h3.sizePx), lineHeight: px(T.scale.h3.lineHeightPx) };

function ConsentRow({
  scope,
  on,
  disabled,
  onToggle
}: {
  scope: GuardianConsentScope;
  on: boolean;
  disabled: boolean;
  onToggle: (v: boolean) => void;
}): React.ReactElement {
  const t = F.consents[scope];
  const id = `consent-${scope}`;
  return (
    <li style={{ border, borderRadius: px(TOKENS.shape.radiusCardPx), padding: sp(3), display: 'grid', gap: sp(1), backgroundColor: on ? C['paper-50'] : C['paper-0'] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2) }}>
        <strong id={id}>{t.title}</strong>
        <span style={{ display: 'flex', alignItems: 'center', gap: sp(1) }}>
          <span style={{ ...small, fontWeight: 700, color: on ? C['leaf-d'] : C['ink-700'] }}>{on ? F.on : F.off}</span>
          <button
            type="button"
            role="switch"
            className="lcw-switch"
            aria-checked={on}
            aria-labelledby={id}
            data-testid={`switch-${scope}`}
            disabled={disabled}
            onClick={() => onToggle(!on)}
          />
        </span>
      </div>
      <span style={{ ...small, color: C['ink-900'] }}>{t.body}</span>
      <span style={small}>
        {F.refuseLabel}: {t.refuse}
      </span>
    </li>
  );
}

function AddChild({ disabled, onAdd }: { disabled: boolean; onAdd: (nickname: string, birthYear: number) => Promise<void> }): React.ReactElement {
  const [nick, setNick] = useState('');
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 9);
  const years = Array.from({ length: 14 }, (_, i) => thisYear - 4 - i).filter((y) => y >= 2005 && y <= 2025);
  return (
    <Box title={F.addTitle} testId="family-add-child">
      <form
        style={{ display: 'grid', gap: sp(2) }}
        onSubmit={(e) => {
          e.preventDefault();
          if (nick.trim()) void onAdd(nick.trim(), year).then(() => setNick(''));
        }}
      >
        <label style={labelStyle}>
          {F.addNickname}
          <input value={nick} maxLength={16} onChange={(e) => setNick(e.target.value)} style={inputStyle} autoComplete="off" />
        </label>
        <span style={small}>{F.addNicknameNote}</span>
        <label style={labelStyle}>
          {F.addBirthYear}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <div>
          <Button type="submit" variant="brand" disabled={disabled || !nick.trim()}>
            {F.addSubmit}
          </Button>
        </div>
      </form>
    </Box>
  );
}

/* ---------- /link: the child's device ---------- */

export function DeviceLinkPage({ api }: { api?: FamilyApi }): React.ReactElement {
  const apiRef = useRef<FamilyApi>(api ?? createFamilyApi());
  const [linked, setLinked] = useState<string | null>(() => loadDevice().nickname);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [relinking, setRelinking] = useState(false);
  if (linked && !relinking) {
    // One clear state once the device is linked: who it belongs to and the way into the game.
    return (
      <main className="lcw-lesson" data-testid="device-link-page" style={{ maxWidth: '480px', margin: '0 auto', display: 'grid', gap: sp(3), fontFamily: T.fonts.ui }}>
        <LessonStyle />
        <Box title={LK.title} testId="device-linked">
          <Notice kind="ok">{msg?.kind === 'ok' ? msg.text : LK.already(linked)}</Notice>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginTop: sp(3) }}>
            <Button type="button" variant="brand" onClick={() => window.location.assign('/game/')}>
              {LK.goGame}
            </Button>
            <Button
              type="button"
              variant="paper"
              onClick={() => {
                setMsg(null);
                setRelinking(true);
              }}
            >
              {LK.relink}
            </Button>
          </div>
        </Box>
      </main>
    );
  }
  return (
    <main className="lcw-lesson" data-testid="device-link-page" style={{ maxWidth: '480px', margin: '0 auto', display: 'grid', gap: sp(3), fontFamily: T.fonts.ui }}>
      <LessonStyle />
      <Box title={LK.title}>
        <p style={{ marginTop: 0 }}>{LK.body}</p>
        <form
          style={{ display: 'grid', gap: sp(2) }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setMsg(null);
            try {
              const r = await apiRef.current.linkDevice(code, label.trim() || LK.defaultLabel);
              saveDevice(r.device_token, r.nickname);
              setLinked(r.nickname);
              setMsg({ kind: 'ok', text: LK.done(r.nickname) });
              setCode('');
              setRelinking(false);
            } catch (err) {
              const c = errorCodeOf(err);
              setMsg({ kind: 'error', text: c === 'too_many_attempts' ? LK.tooMany : c === 'network' ? LK.network : LK.wrong });
            } finally {
              setBusy(false);
            }
          }}
        >
          <label style={labelStyle}>
            {LK.codeLabel}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ ...inputStyle, fontSize: px(T.scale.h2.sizePx), letterSpacing: '0.3em', textAlign: 'center', fontFamily: T.fonts.target }}
            />
          </label>
          <label style={labelStyle}>
            {LK.labelLabel}
            <input value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} style={inputStyle} />
          </label>
          <div>
            <Button type="submit" variant="brand" disabled={busy || code.length !== 6}>
              {LK.submit}
            </Button>
          </div>
        </form>
        {msg ? (
          <div style={{ marginTop: sp(2) }}>
            <Notice kind={msg.kind}>{msg.text}</Notice>
          </div>
        ) : null}
      </Box>
    </main>
  );
}
