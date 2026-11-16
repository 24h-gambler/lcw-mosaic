import React, { useEffect, useState } from 'react';
import { formatGuestPassCode, normalizeGuestPassCode } from '@lcw/schemas';
import { LEGAL, NAV, PASS, SAFETY } from '../copy.js';
import { SLink } from '../SiteShell.js';

function Rows({ rows }: { rows: ReadonlyArray<{ k: string; v: string }> }): React.ReactElement {
  return (
    <div className="s-tablewrap">
      <table className="s-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <th scope="row" style={{ width: '28%' }}>
                {r.k}
              </th>
              <td>{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SafetyPage(): React.ReactElement {
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-stack" style={{ gap: 24 }}>
          <div className="s-hero-copy" style={{ maxWidth: 720 }}>
            <span className="s-eyebrow">안전·개인정보</span>
            <h1 className="s-h1">{SAFETY.title}</h1>
            <p className="s-lead">{SAFETY.lead}</p>
          </div>
          <Rows rows={SAFETY.rows} />
        </div>
      </section>
      <section className="s-sec s-sec-tint">
        <div className="s-wrap">
          <div className="s-sec-head">
            <h2 className="s-h2">{SAFETY.consentTitle}</h2>
            <p className="s-lead">{SAFETY.consentFoot}</p>
          </div>
          <div className="s-grid-4">
            {SAFETY.consents.map((c) => (
              <div key={c.k} className="s-card s-stack" style={{ gap: 8 }}>
                <strong className="s-h3">{c.k}</strong>
                <p className="s-muted">{c.v}</p>
                <span className="s-tag" style={{ justifySelf: 'start' }}>
                  선택 · 따로 켜고 끔
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="s-sec">
        <div className="s-wrap s-card s-stack">
          <h2 className="s-h3">{SAFETY.tryTitle}</h2>
          <p className="s-muted">{SAFETY.tryBody}</p>
          <div className="s-row">
            <SLink to="/privacy" className="s-btn">
              개인정보 처리방침 요약
            </SLink>
            <SLink to="/terms" className="s-btn">
              이용약관 요약
            </SLink>
          </div>
        </div>
      </section>
    </>
  );
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }): React.ReactElement {
  return (
    <section className="s-hero">
      <div className="s-wrap s-stack" style={{ gap: 24, maxWidth: 880 }}>
        <div className="s-hero-copy">
          <h1 className="s-h1">{kind === 'terms' ? LEGAL.termsTitle : LEGAL.privacyTitle}</h1>
          <p className="s-note">{LEGAL.draft}</p>
        </div>
        <Rows rows={kind === 'terms' ? LEGAL.terms : LEGAL.privacy} />
      </div>
    </section>
  );
}

/** Guest pass code (free-play.ts): 8 characters, typed with or without the dash, any case. */
export function normalizePassCode(raw: string): string | null {
  return normalizeGuestPassCode(raw.trim());
}

/** What the /pass page says for each answer of GET /v1/guest-pass/check (the check never starts the clock). */
export type PassCheckView = 'go' | 'ended' | 'expired' | 'revoked' | 'not_found' | 'busy' | 'error';
export function passCheckView(status: number, state: string | undefined): PassCheckView {
  if (status === 404) return 'not_found';
  if (status === 429) return 'busy';
  if (status !== 200) return 'error';
  if (state === 'ready' || state === 'active') return 'go';
  if (state === 'ended' || state === 'expired' || state === 'revoked') return state;
  return 'error';
}

export function PassPage(): React.ReactElement {
  const [code, setCode] = useState('');
  const [view, setView] = useState<PassCheckView | 'bad' | null>(null);
  const [busy, setBusy] = useState(false);
  // A link from the guardian (/pass?code=XXXXXXXX) fills the box.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('code');
    const c = q ? normalizePassCode(q) : null;
    if (c) setCode(formatGuestPassCode(c));
  }, []);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normalizePassCode(code);
    if (!c) {
      setView('bad');
      return;
    }
    setBusy(true);
    // The server says whether the code still opens a world; the world client redeems it there and the clock starts
    // at that first entry (docs/19 7장).
    void fetch(`/v1/guest-pass/check?code=${encodeURIComponent(c)}`, { credentials: 'omit' })
      .then(async (r) => passCheckView(r.status, ((await r.json().catch(() => ({}))) as { state?: string }).state))
      .catch((): PassCheckView => 'error')
      .then((v) => {
        setBusy(false);
        if (v === 'go') window.location.assign(`/world/?pass=${encodeURIComponent(c)}`);
        else setView(v);
      });
  };
  const message = view === 'bad' || view === 'not_found' ? PASS.invalid : view && view !== 'go' ? PASS.state[view] : null;
  return (
    <section className="s-hero">
      <div className="s-wrap s-split" style={{ alignItems: 'start' }}>
        <div className="s-hero-copy">
          <span className="s-eyebrow">게스트 패스</span>
          <h1 className="s-h1">{PASS.title}</h1>
          <p className="s-lead">{PASS.lead}</p>
          <ul style={{ paddingLeft: 20, display: 'grid', gap: 6 }} className="s-muted">
            {PASS.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <form className="s-card s-form" onSubmit={go}>
          <div className="s-field">
            <label htmlFor="pass-code">{PASS.codeLabel}</label>
            <input
              id="pass-code"
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              style={{ fontSize: 28, letterSpacing: 4, minHeight: 56 }}
              onChange={(e) => {
                setCode(e.target.value);
                setView(null);
              }}
            />
          </div>
          {message ? (
            <p className="s-note s-warn" role="alert" data-pass-view={view ?? ''}>
              {message}
            </p>
          ) : null}
          <button type="submit" className="s-btn s-btn-brand s-btn-lg" disabled={busy}>
            {PASS.go} ▶
          </button>
          <SLink to="/try" className="s-small">
            코드가 없으면 {NAV.try}부터 →
          </SLink>
        </form>
      </div>
    </section>
  );
}
