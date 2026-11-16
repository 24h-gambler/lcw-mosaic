/**
 * /signup — student sign-up on the lesson device (edge student-account.ts, docs/16 §2-1, §3).
 * An adult signs in (the guardian, or a student of 14+ as their own account holder) through oauth.ts
 * (`/v1/oauth/<provider>/start?role=guardian&return=/signup` → back here with `#oauth=<one-use code>`, which this
 * browser exchanges: familyApi takeOAuthResult; a bare `#g=` is ignored), says who they are (guardian 19+ / student
 * 14+), gives the required service consent, then either connects this device to a student already in the family, or
 * sends a new nickname for the teacher to approve ('승인 대기' in the director console; the teacher types the 4 digits
 * this screen shows). The adult's session lives in memory only and is logged out as soon as the step is done.
 * Approved → this device holds the same device token /link gives, so the student's own world opens; in lesson time
 * the teacher comes into that world and the lesson attaches by itself (apps/client lesson layer).
 * No prices, payment or deadlines on this screen (AGENTS 4.9).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createFamilyApi, loadDevice, saveDevice, takeOAuthResult, type FamilyApi } from './familyApi.js';
import { LessonApiError } from './lessonApi.js';
import { Box, LessonStyle, Notice, inputStyle, labelStyle, sp } from './lessonUi.js';
import {
  StudentApiError,
  createStudentAccountApi,
  loadSignupClaim,
  isOAuthReturn,
  loadSignupCheck,
  oauthStartPath,
  saveSignupCheck,
  saveSignupClaim,
  type AgeAttest,
  type DeviceGrant,
  type FamilyChild,
  type OAuthProvider,
  type StudentAccountApi
} from './studentAccountApi.js';
import { SIGNUP_STRINGS_KO } from './signupStrings.js';

const S = SIGNUP_STRINGS_KO.student;
const T = TOKENS.typography;
export const SIGNUP_POLL_MS = 4000;

type Step = 'start' | 'checking' | 'consent' | 'who' | 'waiting' | 'done';

export interface StudentSignupProps {
  api?: StudentAccountApi;
  pollMs?: number;
  /** Tests: the URL hash at load (defaults to window.location.hash). */
  hash?: string;
  /** Tests: the one-use code exchange (defaults to createFamilyApi()). */
  oauthApi?: Pick<FamilyApi, 'oauthExchange'>;
  /** Tests: the saved device's check (defaults to createFamilyApi()). */
  deviceApi?: Pick<FamilyApi, 'deviceMe'>;
  navigate?: (path: string) => void;
  /** Tests: the address query at load (defaults to window.location.search); `?mode=signin` = '이미 가입했어요'. */
  search?: string;
}

export function StudentSignupPage(props: StudentSignupProps): React.ReactElement {
  const api = useRef<StudentAccountApi>(props.api ?? createStudentAccountApi()).current;
  const pollMs = props.pollMs ?? SIGNUP_POLL_MS;
  const go = props.navigate ?? ((p: string) => window.location.assign(p));
  const hash0 = useRef(props.hash ?? (typeof window !== 'undefined' ? window.location.hash : '')).current;
  const returned = isOAuthReturn(hash0);
  const exchanged = useRef(false);
  const guardian = useRef<string | null>(null);
  const [step, setStep] = useState<Step>(() =>
    returned ? 'checking' : loadSignupClaim() ? 'waiting' : loadDevice().nickname ? 'done' : 'start'
  );
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [children, setChildren] = useState<FamilyChild[]>([]);
  const [agree, setAgree] = useState(false);
  const [who, setWho] = useState<AgeAttest | null>(null);
  const [check, setCheck] = useState<string | null>(() => loadSignupCheck());
  const [nickname, setNickname] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [teacherMatch, setTeacherMatch] = useState<string | null>(null);
  const signinMode = useRef(
    new URLSearchParams(props.search ?? (typeof window !== 'undefined' ? window.location.search : '')).get('mode') === 'signin'
  ).current;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string>(() => loadDevice().nickname ?? '');

  // The one-use code never stays in the address bar or history.
  useEffect(() => {
    if (props.hash === undefined && typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [props.hash]);

  const endAdult = useCallback(async () => {
    const g = guardian.current;
    guardian.current = null;
    if (g) await api.logout(g).catch(() => undefined);
  }, [api]);

  const errorText = (e: unknown) => {
    if (e instanceof StudentApiError) {
      if (e.code === 'too_many_attempts' || e.code === 'too_many_pending') return S.errBusy;
      if (e.code === 'invalid') return S.errNickname;
      if (e.code === 'nickname_taken') return S.errNickTaken;
      if (e.code === 'nickname_own_child') return S.errOwnChild(typeof e.body.nickname === 'string' ? e.body.nickname : '');
      if (e.code === 'guardian_only' || e.status === 401) return S.errSignedOut;
      if (e.code === 'service_consent_required') return S.errConsent;
      if (e.code === 'age_attest_required') return S.errAttest;
    }
    return S.errNetwork;
  };
  const signedOut = useCallback(() => {
    guardian.current = null;
    setMsg(S.errSignedOut);
    setStep('start');
  }, []);

  useEffect(() => {
    if (step !== 'start' || providers !== null) return;
    void api.oauthConfig().then((c) => setProviders(c.providers));
  }, [api, step, providers]);

  // After sign-in: who consents and the consent (docs/16 §3) every time on this shared device, then who it is for.
  const loadFamily = useCallback(
    async (next: 'consent' | 'who') => {
      const g = guardian.current;
      if (!g) return signedOut();
      try {
        const me = await api.familyMe(g);
        setChildren(me.children);
        setAgree(me.service_consented);
        setStep(next);
      } catch (e) {
        if (e instanceof StudentApiError && e.status === 401) signedOut();
        else setMsg(errorText(e));
      }
    },
    [api, signedOut]
  );
  // A saved device that the server no longer knows (undone by the teacher, removed by the guardian, expired): forget
  // it and start over, instead of showing '가입 끝!' for a token that can never work. Offline or other errors keep it.
  const deviceChecked = useRef(false);
  useEffect(() => {
    if (step !== 'done' || deviceChecked.current) return;
    const token = loadDevice().token;
    if (!token) return;
    deviceChecked.current = true;
    void (props.deviceApi ?? createFamilyApi())
      .deviceMe(token)
      .then((me) => {
        if (me.nickname) setDoneName(me.nickname);
      })
      .catch((e: unknown) => {
        if (!(e instanceof LessonApiError) || e.status !== 401) return;
        saveDevice(null, null);
        setDoneName('');
        setMsg(S.deviceGone);
        setStep('start');
      });
  }, [step, props.deviceApi]);
  // Back from the provider: exchange the one-use code once (StrictMode runs effects twice; the code works once).
  useEffect(() => {
    if (!returned || exchanged.current) return;
    exchanged.current = true;
    void (async () => {
      const r = await takeOAuthResult(props.oauthApi ?? createFamilyApi(), hash0);
      if (r && 'token' in r) {
        guardian.current = r.token;
        await loadFamily('consent');
      } else {
        setMsg(S.oauthError(r && 'error' in r ? r.error : 'provider_error'));
        setStep('start');
      }
    })();
  }, [returned, hash0, props.oauthApi, loadFamily]);

  const finish = useCallback(
    (g: DeviceGrant) => {
      saveDevice(g.device_token, g.nickname);
      saveSignupClaim(null);
      saveSignupCheck(null);
      setDoneName(g.nickname);
      setStep('done');
      void endAdult();
    },
    [endAdult]
  );

  const consent = async () => {
    const g = guardian.current;
    if (!g) return signedOut();
    setBusy(true);
    setMsg(null);
    try {
      if (!who) return;
      await api.attest(g, who);
      await api.serviceConsent(g);
      await loadFamily('who');
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  /** A student already in this family (approved before): this device joins them directly. */
  const connect = async (k: FamilyChild) => {
    const g = guardian.current;
    if (!g) return signedOut();
    setBusy(true);
    setMsg(null);
    try {
      const code = await api.guardianDeviceCode(g, k.player_id);
      finish(await api.linkDevice(code.code, S.deviceLabel));
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    const g = guardian.current;
    if (!g) return signedOut();
    setBusy(true);
    setMsg(null);
    setIdeas([]);
    try {
      const r = await api.signup(g, nickname.trim(), S.deviceLabel);
      setTeacherMatch(r.teacher_match === true ? nickname.trim() : null);
      saveSignupClaim(r.claim_token);
      saveSignupCheck(r.check);
      setCheck(r.check);
      await endAdult();
      setStep('waiting');
    } catch (e) {
      setMsg(errorText(e));
      // One name, one student: the server offers free names close to this one.
      const s = e instanceof StudentApiError && e.code === 'nickname_taken' ? e.body.suggestions : null;
      if (Array.isArray(s)) setIdeas(s.filter((x): x is string => typeof x === 'string'));
    } finally {
      setBusy(false);
    }
  };

  /* waiting: poll until the teacher approves (or the request ends) */
  useEffect(() => {
    if (step !== 'waiting') return;
    const claim = loadSignupClaim();
    if (!claim) {
      setStep('start');
      return;
    }
    let live = true;
    const tick = async () => {
      try {
        const s = await api.status(claim);
        if (!live) return;
        if (s.state === 'approved') {
          if ('device_token' in s) finish(s);
          else {
            saveSignupClaim(null);
            setMsg(S.alreadyClaimed);
            setStep('start');
          }
        } else if (s.state === 'rejected' || s.state === 'expired' || s.state === 'undone') {
          // undone = the teacher approved, then took it back before this screen picked up the device.
          saveSignupClaim(null);
          setMsg(s.state === 'rejected' ? S.rejected : s.state === 'undone' ? S.undone : S.expired);
          setStep('start');
        }
      } catch (e) {
        if (live && e instanceof StudentApiError && e.status === 404) {
          saveSignupClaim(null);
          setStep('start');
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, step, pollMs, finish]);

  const nickOk = /^[\p{L}\p{N} _.-]{1,16}$/u.test(nickname.trim()) && !/\d{6,}/.test(nickname);
  const big: React.CSSProperties = { fontSize: `${T.scale.h3.sizePx}px` };
  const small: React.CSSProperties = { margin: 0, fontSize: `${T.scale.small.sizePx}px` };

  return (
    <main
      className="lcw-lesson"
      data-testid="student-signup"
      data-step={step}
      style={{ maxWidth: '520px', margin: '0 auto', display: 'grid', gap: sp(3), fontFamily: T.fonts.ui }}
    >
      <LessonStyle />
      {step === 'start' ? (
        <Box title={signinMode ? S.titleSignin : S.title} testId="signup-start">
          <p style={{ marginTop: 0 }}>{signinMode ? S.signinBody : S.startBody}</p>
          <p style={small}>{S.startWho}</p>
          <div style={{ display: 'grid', gap: sp(2), marginTop: sp(3) }}>
            {providers === null ? <p>{S.loading}</p> : null}
            {providers?.map((p) => (
              <Button key={p} type="button" variant={p === 'google' ? 'brand' : 'paper'} size="game" style={big} data-testid={`signin-${p}`} onClick={() => go(oauthStartPath(p))}>
                {p === 'google' ? S.withGoogle : S.withKakao}
              </Button>
            ))}
            {providers && providers.length === 0 ? <Notice>{S.signinNotReady}</Notice> : null}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginTop: sp(3) }}>
            <Button type="button" variant="paper" onClick={() => go('/join')}>
              {S.toLesson}
            </Button>
            <Button type="button" variant="paper" onClick={() => go('/link')}>
              {S.haveCode}
            </Button>
          </div>
        </Box>
      ) : null}

      {step === 'checking' ? <p data-testid="signup-checking">{S.loading}</p> : null}

      {step === 'consent' ? (
        <Box title={S.consentTitle} testId="signup-consent">
          <p style={{ marginTop: 0 }}>{S.consentLead}</p>
          <fieldset style={{ border: 0, padding: 0, margin: `0 0 ${sp(3)}`, display: 'grid', gap: sp(2) }}>
            <legend style={{ fontWeight: 700, marginBottom: sp(1) }}>{S.whoConsents}</legend>
            {(['guardian_19', 'self_14'] as const).map((w) => (
              <label key={w} style={{ display: 'flex', gap: sp(2), alignItems: 'center' }}>
                <input type="radio" name="signup-who" checked={who === w} onChange={() => setWho(w)} data-testid={`signup-attest-${w}`} />
                <span>{w === 'guardian_19' ? S.attestGuardian : S.attestSelf}</span>
              </label>
            ))}
          </fieldset>
          <label style={{ display: 'flex', gap: sp(2), alignItems: 'flex-start' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="signup-consent-check" />
            <span>
              <strong>{S.consentRequired}</strong>
              <br />
              {S.consentBody}
            </span>
          </label>
          <p style={small}>{S.consentOptional}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginTop: sp(3) }}>
            <Button type="button" variant="brand" disabled={!agree || !who || busy} onClick={() => void consent()} data-testid="signup-consent-send">
              {S.consentAgree}
            </Button>
            <Button
              type="button"
              variant="paper"
              onClick={() => {
                void endAdult();
                setStep('start');
              }}
            >
              {S.cancel}
            </Button>
          </div>
        </Box>
      ) : null}

      {step === 'who' ? (
        <Box title={S.whoTitle} testId="signup-who">
          {children.length > 0 ? (
            <div style={{ display: 'grid', gap: sp(2) }}>
              <p style={{ margin: 0 }}>{S.whoExisting}</p>
              {children.map((k) => (
                <Button key={k.player_id} type="button" variant="paper" disabled={busy} onClick={() => void connect(k)} data-testid={`signup-connect-${k.player_id}`}>
                  {S.connectAs(k.nickname)}
                </Button>
              ))}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nickOk && !busy) void send();
            }}
            style={{ display: 'grid', gap: sp(2), marginTop: sp(3) }}
          >
            <label style={labelStyle}>
              {S.nickname}
              <input
                data-testid="signup-nickname"
                value={nickname}
                maxLength={16}
                autoComplete="off"
                placeholder={S.nicknamePlaceholder}
                onChange={(e) => setNickname(e.target.value)}
                style={inputStyle}
              />
            </label>
            <p style={small}>{S.nicknameHelp}</p>
            {ideas.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }} data-testid="signup-ideas">
                <span style={small}>{S.ideasLead}</span>
                {ideas.map((idea) => (
                  <Button
                    key={idea}
                    type="button"
                    variant="paper"
                    data-testid="signup-idea"
                    onClick={() => {
                      setNickname(idea);
                      setIdeas([]);
                      setMsg(null);
                    }}
                  >
                    {idea}
                  </Button>
                ))}
              </div>
            ) : null}
            <Button type="submit" variant="brand" size="game" style={big} disabled={!nickOk || busy} data-testid="signup-send">
              {busy ? S.sending : S.send}
            </Button>
          </form>
          <div style={{ marginTop: sp(3) }}>
            <Button
              type="button"
              variant="paper"
              onClick={() => {
                void endAdult();
                setStep('start');
              }}
            >
              {S.cancel}
            </Button>
          </div>
        </Box>
      ) : null}

      {step === 'waiting' ? (
        <Box title={S.waitingTitle} testId="signup-waiting">
          <p style={{ marginTop: 0, fontSize: `${T.scale['body-l'].sizePx}px` }}>{S.waitingBody}</p>
          {check ? (
            <div style={{ display: 'grid', gap: sp(1), margin: `${sp(2)} 0` }}>
              <span>{S.checkLead}</span>
              <span data-testid="signup-check" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale.display.sizePx}px`, letterSpacing: '0.2em', fontWeight: 700 }}>
                {check}
              </span>
            </div>
          ) : null}
          {teacherMatch ? <Notice testId="signup-teacher-match">{S.teacherMatch(teacherMatch)}</Notice> : null}
          <Notice kind="ok">{S.waitingLesson}</Notice>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginTop: sp(3) }}>
            <Button
              type="button"
              variant="paper"
              onClick={() => {
                saveSignupClaim(null);
                saveSignupCheck(null);
                setStep('start');
              }}
            >
              {S.restart}
            </Button>
          </div>
        </Box>
      ) : null}

      {step === 'done' ? (
        <Box title={S.doneTitle} testId="signup-done">
          <Notice kind="ok">{S.doneBody(doneName)}</Notice>
          <p data-testid="lesson-auto" style={{ ...small, marginTop: sp(3) }}>
            {S.lessonAuto}
          </p>
          <div style={{ display: 'grid', gap: sp(2), marginTop: sp(3) }}>
            <Button type="button" variant="brand" size="game" style={big} data-testid="signup-open-world" onClick={() => go('/world/')}>
              {S.openWorld}
            </Button>
            <Button
              type="button"
              variant="paper"
              onClick={() => {
                setMsg(null);
                setStep('start');
              }}
            >
              {S.notMe}
            </Button>
          </div>
        </Box>
      ) : null}

      {msg ? <Notice testId="signup-message">{msg}</Notice> : null}
    </main>
  );
}
