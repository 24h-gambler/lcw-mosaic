/**
 * /director live console for lesson mode (docs/18 §1): operator key → student pick/registration → lesson start with a
 * 6-digit join code → stage rail with the teacher guide → live utterance feed → F1/F2 pins → end and parent report link.
 * Every server call shows its error with a retry; the running lesson survives a reload (localStorage).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { LESSON_PLANS, type LessonStage } from '@lcw/content';
import {
  TEACHER_SIGN_IN_PATH,
  createLessonApi,
  errorCodeOf,
  isOperatorSession,
  operatorSignInFromHash,
  operatorTokenFromResult,
  loadDirectorLesson,
  loadOperatorToken,
  saveDirectorLesson,
  saveOperatorToken,
  recordFromLive,
  recordFromAutoClosed,
  type AdminStudent,
  type AutoClosedLessonRow,
  type LiveLessonsResult,
  type ConsoleSeat,
  type DirectorLessonRecord,
  type FeedLive,
  type LessonApi,
  type LessonFeed,
  type LiveLessonRow,
  type OperatorSessions,
  worldPresence
} from './lessonApi.js';
import {
  EMPTY_FEED_VIEW,
  LESSON_POLL_MS,
  NEXT_LESSON_MAX,
  TEACHER_COMMENT_MAX,
  applyStagePush,
  buildStagePush,
  cryptoRand,
  directorErrorText,
  formatClock,
  kstLabel,
  mergeFeed,
  newStudentIds,
  nextStage,
  planById,
  stageById,
  stageElapsedMs,
  stageStatus,
  starsText,
  studentJoinLinks,
  STUDENT_3D_LESSON_READY,
  validateNewStudent,
  type FeedView,
  type NewStudentForm
} from './lessonFlow.js';
import { EMPTY_DIRECTOR_LIVE, mergeDirectorLive, type DirectorLiveView, type FeedLiveExtra } from './directorLiveState.js';
import { StudentScreenBox, TeachHands } from './DirectorLive.js';
import { LessonAudioBox } from './LessonAudioBox.js';
import { ConsoleSeatBadge, SeatManager, useConsoleSeats } from './DirectorSeats.js';
import { SignupQueue, type SignupQueueProps } from './DirectorSignups.js';
import { Box, LessonStyle, Notice, border, copyText, currentOrigin, inputStyle, labelStyle, sp } from './lessonUi.js';
import { LESSON_STRINGS_KO } from './strings.js';
import { TeacherModeHelp, TeacherPresenceBox } from './teacherPresence.js';
import { A } from './autoCloseStrings.js';
import { M } from './directorMoreStrings.js';

const S = LESSON_STRINGS_KO.director;

const PLAN_KEY = 'lcw.director.plan';
/** `/director?include_test=1`: smoke and demo students' lessons show on the resume card too (production checks). */
export function includeTestLessons(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('include_test') === '1';
}

/**
 * `/director?auto=<lesson id>` (the hub card of a lesson the server closed as 'left without ending'): that row of the
 * '자동 마무리된 수업' box is marked and its button focused; `&next=continue` focuses '이어 하기' instead of the report.
 */
export function autoCloseFocus(search: string = typeof location === 'undefined' ? '' : location.search): { lessonId: string; next: 'report' | 'continue' } | null {
  const q = new URLSearchParams(search);
  const id = q.get('auto');
  if (!id || !/^les-[\w-]{1,60}$/.test(id)) return null;
  return { lessonId: id, next: q.get('next') === 'continue' ? 'continue' : 'report' };
}

/**
 * `/director?prep=<student id>` (the hub's day-record card '다음 수업 준비' on a lesson day, apps/edge ops-cards.ts): that
 * student's row in '학생 고르기' is marked and its start button focused, so the teacher picks the plan and starts.
 */
export function prepFocus(search: string = typeof location === 'undefined' ? '' : location.search): string | null {
  const id = new URLSearchParams(search).get('prep');
  return id && /^[\w-]{1,80}$/.test(id) ? id : null;
}

/** How often the first screen re-reads running lessons (another device may start one). */
export const LIVE_LESSONS_POLL_MS = 15_000;

/** The plan the teacher picked last on this device (first plan when none or storage is blocked). */
export function loadPlanChoice(): string {
  try {
    const v = globalThis.localStorage?.getItem(PLAN_KEY);
    if (v && LESSON_PLANS.some((p) => p.id === v)) return v;
  } catch {
    /* storage blocked: the default stands */
  }
  return LESSON_PLANS[0]!.id;
}

function savePlanChoice(id: string): void {
  try {
    globalThis.localStorage?.setItem(PLAN_KEY, id);
  } catch {
    /* storage blocked: the choice lasts this page */
  }
}
const C = TOKENS.colors;
const T = TOKENS.typography;

export interface LessonDirectorConsoleProps {
  api?: LessonApi;
  /** undefined → read localStorage; tests pass a value. */
  initialToken?: string | null;
  initialLesson?: DirectorLessonRecord | null;
  initialStudents?: AdminStudent[];
  /** Seats for the student rows' badges and controls; undefined → fetched (GET /v1/admin/seats). */
  initialSeats?: ConsoleSeat[];
  /** Running lessons for the resume card (and auto-closed ones for their box); undefined → fetched. */
  initialLive?: LiveLessonsResult;
  initialFeed?: LessonFeed & FeedLiveExtra;
  now?: () => number;
  /** The sign-up approval queue: false hides it; an object passes its test doubles. */
  signupQueue?: false | Omit<SignupQueueProps, 'token'>;
}

export function LessonDirectorConsole(props: LessonDirectorConsoleProps): React.ReactElement {
  const apiRef = useRef<LessonApi>(props.api ?? createLessonApi());
  const api = apiRef.current;
  const now = props.now ?? Date.now;
  const [token, setToken] = useState<string | null>(() =>
    props.initialToken !== undefined ? props.initialToken : loadOperatorToken()
  );
  const [lesson, setLessonState] = useState<DirectorLessonRecord | null>(() =>
    props.initialLesson !== undefined ? props.initialLesson : loadDirectorLesson()
  );
  const [keyError, setKeyError] = useState<string | null>(null);

  const setLesson = useCallback((rec: DirectorLessonRecord | null) => {
    setLessonState(rec);
    saveDirectorLesson(rec);
  }, []);

  // Back from Google sign-in: /director#oauth=<one-use code> traded for the session from this browser only (the token
  // never sits in the address bar), or #oauth_error=<code>.
  useEffect(() => {
    if (typeof location === 'undefined' || !location.hash) return;
    const r = operatorSignInFromHash(location.hash);
    if (!r) return;
    history.replaceState(null, '', location.pathname + location.search);
    if ('error' in r) {
      setKeyError(S.signInError(r.error));
      return;
    }
    api
      .oauthExchange(r.code)
      .then((x) => {
        const t = operatorTokenFromResult(x.result);
        if (!t) {
          const e = /^oauth_error=([a-z_]{1,40})$/.exec(x.result ?? '');
          setKeyError(S.signInError(e?.[1] ?? 'handoff_invalid'));
          return;
        }
        saveOperatorToken(t);
        setToken(t);
        setKeyError(null);
      })
      .catch((e: unknown) => setKeyError(S.signInError(errorCodeOf(e))));
  }, [api]);

  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onAuthError = useCallback((code: string) => {
    // Several calls answer 401 at once: only the first one decides; later ones find the token already gone.
    if (code !== 'operator_only' || !tokenRef.current) return;
    // A teacher sign-in that ended (logout elsewhere, 30 days, taken off the list): back to the sign-in box.
    if (isOperatorSession(tokenRef.current)) {
      saveOperatorToken(null);
      setToken(null);
      setKeyError(S.sessionEnded);
    } else setKeyError(S.errOperator);
  }, []);

  const keyBox = (
    <KeyBox
      api={api}
      token={token}
      error={keyError}
      onSave={(t) => {
        setToken(t);
        setKeyError(null);
      }}
      onForget={() => {
        saveOperatorToken(null);
        setToken(null);
      }}
    />
  );
  return (
    <div className="lcw-lesson" data-testid="lesson-director" style={{ display: 'grid', gap: sp(4) }}>
      <LessonStyle />
      {/* Signed in: the key box folds to the bottom (R2625 console trim); signing in or a key error keeps it on top. */}
      {!token || keyError ? keyBox : null}
      {!token ? null : lesson ? (
        <>
          <LiveLesson
            api={api}
            token={token}
            lesson={lesson}
            setLesson={setLesson}
            now={now}
            onAuthError={onAuthError}
            {...(props.initialFeed ? { initialFeed: props.initialFeed } : {})}
          />
          {/* A sign-up arriving during the lesson shows here too (only when one is waiting). */}
          {props.signupQueue !== false ? <SignupQueue token={token} hideWhenEmpty {...(props.signupQueue ?? {})} /> : null}
        </>
      ) : (
        <>
          <StudentPicker
            api={api}
            token={token}
            now={now}
            onAuthError={onAuthError}
            initialStudents={props.initialStudents}
            initialSeats={props.initialSeats}
            initialLive={props.initialLive}
            onStarted={setLesson}
          />
          {/* Student sign-ups waiting for the teacher (DirectorSignups.tsx); signupQueue={false} turns it off. */}
          {props.signupQueue !== false ? <SignupQueue token={token} {...(props.signupQueue ?? {})} /> : null}
        </>
      )}
      {token && !keyError ? (
        <details data-testid="director-key-more">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.keyMore}</summary>
          <div style={{ marginTop: sp(2) }}>{keyBox}</div>
        </details>
      ) : null}
    </div>
  );
}

/* ---------- operator key ---------- */

/** A teacher signed in with Google: who, logout, and the other browsers signed in to the same account. */
function TeacherAccount({ api, token, onSignedOut }: { api: LessonApi; token: string; onSignedOut: () => void }): React.ReactElement {
  const [info, setInfo] = useState<OperatorSessions | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.operatorSessions(token).then(setInfo).catch(() => undefined);
  }, [api, token]);
  useEffect(load, [load]);
  const me = info?.me ?? null;
  const live = (info?.sessions ?? []).filter((s) => s.live);
  const end = async (input: { id: string } | { all: true }, signOut: boolean) => {
    setBusy(true);
    try {
      await api.revokeOperatorSession(token, input);
    } catch {
      /* already ended: signing out here still forgets it */
    }
    setBusy(false);
    if (signOut) onSignedOut();
    else load();
  };
  return (
    <div data-testid="teacher-account" style={{ display: 'grid', gap: sp(2) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
        <span>{S.signedInAs(me?.name ?? '')}</span>
        <Button type="button" variant="paper" disabled={busy} onClick={() => void (me ? end({ id: me.session_id }, true) : onSignedOut())}>
          {S.logout}
        </Button>
      </div>
      {live.length > 0 ? (
        <details data-testid="teacher-devices">
          <summary style={{ cursor: 'pointer' }}>{S.devicesTitle(live.length)}</summary>
          <ul style={{ margin: `${sp(2)} 0 0`, paddingLeft: sp(4), display: 'grid', gap: sp(1) }}>
            {live.map((s) => (
              <li key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
                <span>
                  {s.id === me?.session_id ? S.thisDevice : s.label} · {S.deviceSeen(new Date(s.last_seen_at ?? s.created_at).toLocaleString('ko-KR'))}
                </span>
                {s.id === me?.session_id ? null : (
                  <Button type="button" variant="paper" disabled={busy} onClick={() => void end({ id: s.id }, false)}>
                    {S.deviceEnd}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" variant="paper" disabled={busy} onClick={() => void end({ all: true }, true)}>
            {S.logoutAll}
          </Button>
        </details>
      ) : null}
    </div>
  );
}

function KeyBox({
  api,
  token,
  error,
  onSave,
  onForget
}: {
  api: LessonApi;
  token: string | null;
  error: string | null;
  onSave: (t: string) => void;
  onForget: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(!token);
  // A token that arrives after the first render (Google sign-in fragment, another tab) closes the key form.
  useEffect(() => {
    if (token) setEditing(false);
  }, [token]);
  const [draft, setDraft] = useState('');
  const [notStored, setNotStored] = useState(false);
  const showForm = editing || !token;
  const save = () => {
    const t = draft.trim();
    if (!t) return;
    setNotStored(!saveOperatorToken(t));
    setDraft('');
    setEditing(false);
    onSave(t);
  };
  return (
    <Box title={S.keyTitle} testId="director-key" tone="tinted">
      {showForm ? (
        <div style={{ display: 'grid', gap: sp(2), marginBottom: sp(3) }}>
          <a
            href={TEACHER_SIGN_IN_PATH}
            data-testid="teacher-google"
            className="lcw-btn"
            style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: `0 ${sp(4)}`, borderRadius: 12, background: C['brand-d'], color: C['paper-0'], fontWeight: 700, textDecoration: 'none' }}
          >
            {S.googleSignIn}
          </a>
          <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px` }}>{S.googleHelp}</p>
          <strong style={{ marginTop: sp(2) }}>{S.keyOr}</strong>
        </div>
      ) : null}
      {showForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}
        >
          <label style={{ ...labelStyle, flex: '1 1 260px' }}>
            {S.keyTitle}
            <input
              type="password"
              autoComplete="off"
              value={draft}
              placeholder={S.keyPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              style={inputStyle}
            />
          </label>
          <Button type="submit" variant="brand">
            {S.keySave}
          </Button>
          <p style={{ flexBasis: '100%', margin: 0, fontSize: `${T.scale.small.sizePx}px` }}>{S.keyHelp}</p>
        </form>
      ) : isOperatorSession(token) && token ? (
        <TeacherAccount api={api} token={token} onSignedOut={onForget} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          <span>{S.keySaved}</span>
          <Button type="button" variant="paper" onClick={() => setEditing(true)}>
            {S.keyChange}
          </Button>
          <Button
            type="button"
            variant="paper"
            onClick={() => {
              onForget();
              setEditing(true);
            }}
          >
            {S.keyForget}
          </Button>
        </div>
      )}
      {notStored ? <p style={{ margin: `${sp(2)} 0 0` }}>{S.keyNotStored}</p> : null}
      {error ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice>{error}</Notice>
        </div>
      ) : null}
    </Box>
  );
}

/* ---------- student list + registration + start ---------- */

/** Saves a fetched file through a temporary object URL (the export needs the Bearer token, so no plain link). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** '오늘 기록 CSV 받기' (coordinator 11-16): today's utterance log and per-minute progress, operator only. */
export function CsvExportRow({
  api,
  token,
  onAuthError
}: {
  api: Pick<LessonApi, 'exportCsv'>;
  token: string;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<null | 'utterances' | 'lesson-minutes'>(null);
  const [error, setError] = useState<string | null>(null);
  const get = async (kind: 'utterances' | 'lesson-minutes') => {
    setBusy(kind);
    setError(null);
    try {
      const f = await api.exportCsv(token, kind);
      saveBlob(f.blob, f.filename);
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setError(S.csvFailed(code));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="director-csv" style={{ marginBottom: sp(3) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
        <Button type="button" variant="paper" data-testid="csv-utterances" disabled={busy !== null} onClick={() => void get('utterances')}>
          {busy === 'utterances' ? S.csvBusy : S.csvToday}
        </Button>
        <Button type="button" variant="paper" data-testid="csv-minutes" disabled={busy !== null} onClick={() => void get('lesson-minutes')}>
          {busy === 'lesson-minutes' ? S.csvBusy : S.csvMinutes}
        </Button>
      </div>
      <p style={{ margin: `${sp(1)} 0 0`, fontSize: `${T.scale.small.sizePx}px` }}>{S.csvHelp}</p>
      {error ? (
        <p role="alert" data-testid="csv-error" style={{ margin: `${sp(1)} 0 0` }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StudentPicker({
  api,
  token,
  now,
  onAuthError,
  initialStudents,
  initialSeats,
  initialLive,
  onStarted
}: {
  api: LessonApi;
  token: string;
  now: () => number;
  onAuthError: (code: string) => void;
  initialStudents: AdminStudent[] | undefined;
  initialSeats: ConsoleSeat[] | undefined;
  initialLive: LiveLessonsResult | undefined;
  onStarted: (rec: DirectorLessonRecord) => void;
}): React.ReactElement {
  const [live, setLive] = useState<(LiveLessonsResult & { at: number }) | null>(
    initialLive ? { ...initialLive, at: now() } : null
  );
  const liveGone = useRef(false);
  const loadLive = useCallback(async () => {
    try {
      const r = await api.liveLessons(token, includeTestLessons());
      if (!liveGone.current) setLive({ ...r, at: now() });
    } catch (e) {
      onAuthError(errorCodeOf(e));
    }
  }, [api, token, now, onAuthError]);
  // A lesson started on another device after this screen opened shows up within seconds, and one ended meanwhile
  // goes away: refetch every LIVE_LESSONS_POLL_MS and when the console comes back to the front.
  useEffect(() => {
    liveGone.current = false;
    if (!initialLive) void loadLive();
    const id = setInterval(() => void loadLive(), LIVE_LESSONS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadLive();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      liveGone.current = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadLive, initialLive]);
  const [students, setStudents] = useState<AdminStudent[] | null>(initialStudents ?? null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<{ id: string; text: string } | null>(null);
  const [planId, setPlanId] = useState<string>(loadPlanChoice);
  const seats = useConsoleSeats(api, token, initialSeats);
  const [seatOpen, setSeatOpen] = useState<string | null>(null);
  const [prep] = useState(() => prepFocus());
  const prepRow = prep && students ? students.find((s) => s.player_id === prep) ?? null : null;
  const studentsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!prepRow) return;
    const b = studentsRef.current?.querySelector<HTMLButtonElement>('[data-prep-start="1"]');
    b?.scrollIntoView?.({ block: 'center' });
    b?.focus();
  }, [prepRow]);
  const choosePlan = (id: string) => {
    setPlanId(id);
    savePlanChoice(id);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setStudents(await api.listStudents(token));
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setListError(directorErrorText(code));
    } finally {
      setLoading(false);
    }
  }, [api, token, onAuthError]);

  useEffect(() => {
    if (!initialStudents) void load();
  }, [load, initialStudents]);

  const start = async (s: Pick<AdminStudent, 'player_id' | 'nickname'>, planOverride?: string) => {
    setStartingId(s.player_id);
    setStartError(null);
    try {
      // presence: this console beats (teacherPresence.tsx), so the start is the first beat. A start for a student whose
      // lesson the server auto-closed today continues that lesson (stage_id: where the child left off).
      const res = await api.startLesson(token, { player_id: s.player_id, plan_id: planOverride ?? planId, presence: true });
      const t = now();
      onStarted({
        lesson_id: res.lesson_id,
        join_code: res.join_code,
        expires_at: res.expires_at,
        plan_id: res.plan?.id ?? planId,
        player_id: s.player_id,
        nickname: s.nickname,
        started_at: t,
        // The server puts the first stage (or, continuing, the stage the child left off) on the student screen at start.
        stage_id: res.stage_id ?? res.plan?.stages?.[0]?.id ?? planById(res.plan?.id).stages[0]!.id,
        stage_started_at: t,
        stage_ms: {},
        report_path: null
      });
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setStartError({ id: s.player_id, text: directorErrorText(code) });
    } finally {
      setStartingId(null);
    }
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: sp(1), borderBottom: border, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: sp(1), borderBottom: `1px solid ${C['line-200']}`, verticalAlign: 'middle' };

  return (
    <div style={{ display: 'grid', gap: sp(4) }}>
      {live && live.lessons.length > 0 ? (
        <Box title={S.resumeTitle} tone="tinted" testId="director-live-lessons">
          <p style={{ margin: `0 0 ${sp(2)}` }}>{S.resumeHelp}</p>
          <div style={{ display: 'grid', gap: sp(2) }}>
            {live.lessons.map((l) => {
              const plan = planById(l.plan_id);
              const stage = plan.stages.find((s) => s.id === l.stage_id);
              return (
                <div key={l.lesson_id} data-testid="live-lesson" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: sp(2), justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700 }}>
                    {S.resumeLine(l.nickname, plan.titleKo, stage?.titleKo ?? '—', kstLabel(l.started_at), l.join_code)}
                  </span>
                  <Button type="button" variant="brand" data-testid={`resume-${l.lesson_id}`} onClick={() => onStarted(recordFromLive(l, live.server_now, live.at))}>
                    {S.resumeButton}
                  </Button>
                </div>
              );
            })}
          </div>
        </Box>
      ) : null}
      {live?.auto_closed && live.auto_closed.length > 0 ? (
        <AutoClosedBox
          rows={live.auto_closed}
          startingId={startingId}
          startError={startError}
          onOpen={(r) => onStarted(recordFromAutoClosed(r))}
          onContinue={(r) => void start({ player_id: r.player_id, nickname: r.nickname }, r.plan_id)}
        />
      ) : null}
      <Box
        title={S.studentsTitle}
        testId="director-students"
        right={
          <Button
            type="button"
            variant="paper"
            onClick={() => {
              void load();
              void loadLive();
              void seats.reload();
            }}
            disabled={loading}
          >
            {loading ? S.loading : S.refresh}
          </Button>
        }
      >
        <div role="radiogroup" aria-label={S.planTitle} data-testid="director-plan" style={{ marginBottom: sp(3) }}>
          <div style={{ fontWeight: 700, marginBottom: sp(1) }}>{S.planTitle}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
            {LESSON_PLANS.map((p) => (
              <Button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === planId}
                data-testid={`plan-${p.id}`}
                variant={p.id === planId ? 'brand' : 'paper'}
                onClick={() => choosePlan(p.id)}
              >
                {p.id === planId ? '✓ ' : ''}
                {p.titleKo}
              </Button>
            ))}
          </div>
          <p style={{ margin: `${sp(1)} 0 0`, fontSize: `${T.scale.small.sizePx}px` }}>{S.planHint}</p>
        </div>
        {listError ? <Notice onRetry={() => void load()} retryLabel={S.retry}>{listError}</Notice> : null}
        {seats.error ? (
          <Notice kind="info" onRetry={() => void seats.reload()} retryLabel={S.retry}>
            {S.seat.loadError}
          </Notice>
        ) : null}
        {students && students.length === 0 ? <p>{S.studentsEmpty}</p> : null}
        {prep && students ? (
          <Notice kind="info" testId="director-prep">
            {prepRow ? M.prepHere(prepRow.nickname) : M.prepMissing}
          </Notice>
        ) : null}
        {students && students.length > 0 ? (
          <div ref={studentsRef} style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: `${T.scale.body.sizePx}px` }}>
              <thead>
                <tr>
                  <th style={th}>{S.colNickname}</th>
                  <th style={th}>{S.colLevel}</th>
                  <th style={th}>{S.colBirth}</th>
                  <th style={th}>{S.colLast}</th>
                  <th style={th}>{S.col7d}</th>
                  <th style={th}>{S.seat.col}</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <React.Fragment key={s.player_id}>
                  <tr
                    data-testid="student-row"
                    data-prep={prepRow?.player_id === s.player_id ? '1' : undefined}
                    style={prepRow?.player_id === s.player_id ? { background: C['paper-50'], outline: `3px solid ${C['sky-d']}` } : undefined}
                  >
                    <td style={{ ...td, fontWeight: 700 }}>{s.nickname}</td>
                    <td style={td}>{s.level}</td>
                    <td style={td}>{s.birth_year ?? '—'}</td>
                    <td style={td}>{kstLabel(s.last_lesson_at)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.utterances_7d ?? 0}</td>
                    <td style={td} data-testid="student-seat">
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), alignItems: 'center' }}>
                        {seats.loaded ? <ConsoleSeatBadge seat={seats.byPlayer.get(s.player_id)} now={now()} /> : null}
                        <Button
                          type="button"
                          variant="paper"
                          aria-expanded={seatOpen === s.player_id}
                          data-testid={`seat-manage-${s.player_id}`}
                          onClick={() => setSeatOpen(seatOpen === s.player_id ? null : s.player_id)}
                        >
                          {seatOpen === s.player_id ? S.seat.close : S.seat.manage}
                        </Button>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <Button
                        type="button"
                        variant="brand"
                        disabled={startingId !== null}
                        data-prep-start={prepRow?.player_id === s.player_id ? '1' : undefined}
                        onClick={() => void start(s)}
                      >
                        {startingId === s.player_id ? S.starting : S.startLesson}
                      </Button>
                      {startError?.id === s.player_id ? (
                        <div style={{ marginTop: sp(1), textAlign: 'left' }}>
                          <Notice onRetry={() => void start(s)} retryLabel={S.retry}>
                            {startError.text}
                          </Notice>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                  {seatOpen === s.player_id ? (
                    <tr data-testid="student-seat-row">
                      <td colSpan={7} style={td}>
                        <SeatManager
                          api={api}
                          token={token}
                          nickname={s.nickname}
                          playerId={s.player_id}
                          seat={seats.byPlayer.get(s.player_id)}
                          now={now}
                          onChanged={seats.reload}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Box>
      <details data-testid="director-new-student-more">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.newStudentMore}</summary>
        <div style={{ marginTop: sp(2) }}>
          <NewStudentBox api={api} token={token} onAuthError={onAuthError} onCreated={() => void load()} />
        </div>
      </details>
      <details data-testid="director-csv-more">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.csvMore}</summary>
        <div style={{ marginTop: sp(2) }}>
          <CsvExportRow api={api} token={token} onAuthError={onAuthError} />
        </div>
      </details>
      <TeacherModeHelp />
    </div>
  );
}

function NewStudentBox({
  api,
  token,
  onAuthError,
  onCreated
}: {
  api: LessonApi;
  token: string;
  onAuthError: (code: string) => void;
  onCreated: () => void;
}): React.ReactElement {
  const [form, setForm] = useState<NewStudentForm>({ nickname: '', birthYear: '', level: 'L1' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    const invalid = validateNewStudent(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const ids = newStudentIds(cryptoRand);
    const nickname = form.nickname.trim();
    try {
      await api.createPlayer(token, {
        ...ids,
        nickname,
        level: form.level,
        ...(form.birthYear.trim() ? { birth_year: Number(form.birthYear) } : {})
      });
      setDone(S.registered(nickname));
      setForm({ nickname: '', birthYear: '', level: form.level });
      onCreated();
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setError(directorErrorText(code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box title={S.newStudentTitle} testId="director-new-student">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}
      >
        <label style={{ ...labelStyle, flex: '2 1 180px' }}>
          {S.nickname}
          <input
            value={form.nickname}
            maxLength={32}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: '1 1 120px' }}>
          {S.birthYear}
          <input
            inputMode="numeric"
            value={form.birthYear}
            maxLength={4}
            onChange={(e) => setForm({ ...form, birthYear: e.target.value.replace(/\D+/g, '') })}
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>
          {S.level}
          <select
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value as NewStudentForm['level'] })}
            style={inputStyle}
          >
            {(['L1', 'L2', 'L3'] as const).map((l) => (
              <option key={l} value={l}>
                {S.levelNames[l]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="leaf" disabled={busy}>
          {busy ? S.registering : S.register}
        </Button>
      </form>
      {error ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice onRetry={() => void submit()} retryLabel={S.retry}>
            {error}
          </Notice>
        </div>
      ) : null}
      {done ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice kind="ok">{done}</Notice>
        </div>
      ) : null}
    </Box>
  );
}

/* ---------- live lesson ---------- */

const EMPTY_LIVE: FeedLive = { utterances: 0, passes: 0, stars_total: 0, words_total: 0, student_speaking_ms: 0 };

interface LiveLessonProps {
  api: LessonApi;
  token: string;
  lesson: DirectorLessonRecord;
  setLesson: (rec: DirectorLessonRecord | null) => void;
  now: () => number;
  onAuthError: (code: string) => void;
  initialFeed?: LessonFeed & FeedLiveExtra;
}

function LiveLesson({ api, token, lesson, setLesson, now, onAuthError, initialFeed }: LiveLessonProps): React.ReactElement {
  const plan = planById(lesson.plan_id);
  const [clock, setClock] = useState(() => now());
  const [feed, setFeed] = useState<FeedView>(() => (initialFeed ? mergeFeed(EMPTY_FEED_VIEW, initialFeed) : EMPTY_FEED_VIEW));
  const [live, setLive] = useState<FeedLive>(initialFeed?.live ?? EMPTY_LIVE);
  const [serverLesson, setServerLesson] = useState<LessonFeed['lesson'] | null>(initialFeed?.lesson ?? null);
  const [feedFails, setFeedFails] = useState(0);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [viewStageId, setViewStageId] = useState<string>(lesson.stage_id ?? plan.stages[0]!.id);
  // The newest stage move when the server made it by itself (docs/18 §9), shown on that stage's panel.
  const [autoMove, setAutoMove] = useState<{ stageId: string; why: string; at: number } | null>(() =>
    autoMoveOf(initialFeed?.stage_log, 0)
  );

  const [liveX, setLiveX] = useState<DirectorLiveView>(() =>
    initialFeed ? mergeDirectorLive(EMPTY_DIRECTOR_LIVE, initialFeed, now()) : EMPTY_DIRECTOR_LIVE
  );
  const liveXRef = useRef(liveX);
  liveXRef.current = liveX;
  const liveCursorRef = useRef(liveX.liveCursor);
  liveCursorRef.current = liveX.liveCursor;
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  const sinceRef = useRef(feed.since);
  sinceRef.current = feed.since;
  const inFlight = useRef(false);
  const ended = Boolean(lesson.report_path) || Boolean(serverLesson?.ended_at);

  // The server clock is the truth for "time since lesson start" (pins, feed times); local start until it arrives.
  // Moved onto this console's clock (the record and `clock` are local), so a device clock that is off does not shift
  // elapsed time or pin at_ms.
  const startedAt = (serverLesson?.started_at ? serverLesson.started_at - liveX.clockSkewMs : 0) || lesson.started_at || clock;
  // Server-stamped times (utterances, the student's last line) subtract the start on the server's own clock.
  const serverStartedAt = serverLesson?.started_at || startedAt;

  useEffect(() => {
    const id = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(id);
  }, [now]);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const f = await api.feed(token, lessonRef.current.lesson_id, sinceRef.current, liveCursorRef.current);
      setFeed((prev) => mergeFeed(prev, f));
      setLiveX((prev) => mergeDirectorLive(prev, f, now()));
      setLive(f.live ?? EMPTY_LIVE);
      setServerLesson(f.lesson);
      setAutoMove(autoMoveOf(f.stage_log, liveXRef.current.clockSkewMs));
      setFeedFails(0);
      setFeedError(null);
      const rec = lessonRef.current;
      if (f.lesson.stage_id && f.lesson.stage_id !== rec.stage_id) {
        // The server moved the stage (by itself, docs/18 §9, or another tab): follow it. The panel follows too when the
        // teacher was looking at the running stage, so its button stays "next stage" (not "back to the old one").
        const was = rec.stage_id ?? planById(rec.plan_id).stages[0]!.id;
        const to = f.lesson.stage_id;
        setLesson(applyStagePush(rec, to, now()));
        setViewStageId((v) => followStageView(v, was, to));
      }
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setFeedFails((n) => n + 1);
      setFeedError(directorErrorText(code));
    } finally {
      inFlight.current = false;
    }
  }, [api, token, now, onAuthError, setLesson]);

  useEffect(() => {
    if (ended) return undefined;
    void poll();
    const id = setInterval(() => void poll(), LESSON_POLL_MS);
    return () => clearInterval(id);
  }, [poll, ended]);

  // R2625 console trim (docs/18 §8): no pin buttons or F1/F2; event hotkeys only while 「선생님이 직접 하기」 is open.
  const elapsed = clock - startedAt;
  const lastUtterances = [...feed.utterances].reverse();

  return (
    <div style={{ display: 'grid', gap: sp(4) }} data-testid="director-live">
      <JoinCodeBar api={api} token={token} lesson={lesson} elapsedMs={elapsed} totalMinutes={plan.totalMinutes} />
      <TeacherPresenceBox api={api} token={token} lessonId={lesson.lesson_id} ended={ended} />
      {feedError ? (
        <Notice onRetry={() => void poll()} retryLabel={S.retry} testId="feed-error">
          {`${feedError} ${S.feedStale(feedFails)}`}
        </Notice>
      ) : null}
      {ended && !lesson.report_path && serverLesson?.end_reason !== 'auto_idle' ? <Notice kind="info">{S.endedElsewhereHelp}</Notice> : null}
      {serverLesson?.continues_from && !ended ? (
        <Notice kind="info" testId="continued-note">
          {A.continued(kstLabel(serverLesson.started_at))}
        </Notice>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: sp(4),
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          alignItems: 'start'
        }}
      >
        <div style={{ display: 'grid', gap: sp(4), minWidth: 0 }}>
          <StageRail
            lesson={lesson}
            clock={clock}
            viewStageId={viewStageId}
            onView={setViewStageId}
          />
          <StagePanel
            key={viewStageId}
            api={api}
            token={token}
            lesson={lesson}
            stage={stageById(plan, viewStageId) ?? plan.stages[0]!}
            clock={clock}
            onScreen={serverLesson?.targets ?? null}
            autoMove={autoMove && autoMove.stageId === viewStageId ? autoMove : null}
            disabled={ended}
            now={now}
            onAuthError={onAuthError}
            startedAt={startedAt}
            onPushed={(stageId) => {
              setLesson(applyStagePush(lessonRef.current, stageId, now()));
              setViewStageId(stageId);
              void poll();
            }}
          />
        </div>
        <div style={{ display: 'grid', gap: sp(4), minWidth: 0 }}>
          <StudentScreenBox live={liveX} localNow={clock} startedAt={serverStartedAt} />
          {/* Dan 11-19: the teacher can teach again — possession, own sentence, events (folded, docs/18 §8). */}
          <TeachHands
            api={api}
            token={token}
            lessonId={lesson.lesson_id}
            stage={stageById(plan, lesson.stage_id ?? plan.stages[0]!.id) ?? undefined}
            live={liveX}
            disabled={ended}
            onSent={() => void poll()}
            onAuthError={onAuthError}
          />
          <Box title={M.feedTitle(live.utterances, live.passes, live.stars_total)} testId="director-feed">
            {lastUtterances.length === 0 ? <p style={{ margin: 0 }}>{S.feedEmpty}</p> : null}
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2), maxHeight: '560px', overflowY: 'auto' }}>
              {lastUtterances.map((u) => (
                <li
                  key={u.id}
                  data-testid="feed-item"
                  style={{
                    border,
                    borderLeft: `${sp(1)} solid ${u.pass ? C['leaf-d'] : C['sun-d']}`,
                    borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                    padding: sp(2),
                    backgroundColor: C['paper-0']
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center', marginBottom: sp(1) }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C['ink-700'] }}>{formatClock(u.at - serverStartedAt)}</span>
                    <span style={{ color: C['sun-d'], fontWeight: 700, letterSpacing: '2px' }}>{starsText(u.stars)}</span>
                    <span
                      style={{
                        backgroundColor: u.pass ? C['leaf-d'] : C['sun-d'],
                        color: C['paper-0'],
                        padding: `0 ${sp(1)}`,
                        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                        fontSize: `${T.scale.small.sizePx}px`,
                        fontWeight: 700
                      }}
                    >
                      {u.pass ? S.feedPass : S.feedRetry}
                    </span>
                    <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-500'] }}>{u.mode}</span>
                  </div>
                  <div style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>
                    {S.feedTarget}: <span lang="en">{u.target_text || S.feedFree}</span>
                  </div>
                  <div lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px`, fontWeight: 700 }}>
                    {u.transcript}
                  </div>
                </li>
              ))}
            </ol>
          </Box>
          <EndLessonBox
            api={api}
            token={token}
            lesson={lesson}
            onAuthError={onAuthError}
            onEnded={(path) => setLesson({ ...lessonRef.current, report_path: path })}
            onReset={() => setLesson(null)}
            endedElsewhere={ended && !lesson.report_path}
            autoPending={Boolean(serverLesson?.report_pending)}
            draftSummary={serverLesson?.draft_summary_ko ?? null}
          />
          {/* The guardians' live lesson window (WP-307): kept, folded (no real lesson used it, R2625). */}
          <details data-testid="director-audio-more">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.audioMore}</summary>
            <div style={{ marginTop: sp(2) }}>
              <LessonAudioBox token={token} lessonId={lesson.lesson_id} disabled={ended} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

/** How often the live bar asks whether the child's world is open ('접속 중' / '접속 대기'). */
export const WORLD_PRESENCE_POLL_MS = 5_000;
const LINKED_REFRESH_TICKS = 6;

/** The child's world for this lesson: open now, signed in but closed, or no signed-in device (code). */
function useWorldPresence(
  api: Pick<LessonApi, 'liveLessons' | 'listStudents'>,
  token: string,
  lessonId: string,
  playerId: string
): ReturnType<typeof worldPresence> | null {
  const [state, setState] = useState<ReturnType<typeof worldPresence> | null>(null);
  useEffect(() => {
    let alive = true;
    let linked: number | null = null;
    let ticks = 0;
    const tick = async () => {
      try {
        // The device count is read again every 30 s: a device linked or unlinked during the lesson shows.
        if (linked === null || ticks++ % LINKED_REFRESH_TICKS === 0) {
          const rows = await api.listStudents(token);
          linked = rows.find((s) => s.player_id === playerId)?.linked_devices ?? 0;
        }
        const r = await api.liveLessons(token, true);
        const row = r.lessons.find((l) => l.lesson_id === lessonId);
        if (alive) setState(worldPresence(row?.world_seen_at ?? null, linked, r.server_now));
      } catch {
        /* the bar keeps its last answer; the feed shows connection trouble */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), WORLD_PRESENCE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [api, token, lessonId, playerId]);
  return state;
}

function JoinCodeBar({
  api,
  token,
  lesson,
  elapsedMs,
  totalMinutes
}: {
  api: Pick<LessonApi, 'liveLessons' | 'listStudents'>;
  token: string;
  lesson: DirectorLessonRecord;
  elapsedMs: number;
  totalMinutes: number;
}): React.ReactElement {
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const links = studentJoinLinks(currentOrigin(), lesson.join_code);
  const primary = links[0]!;
  const code = lesson.join_code;
  // A lesson is the teacher coming into the child's world (Dan 11-16 12:10): with a signed-in device the bar says
  // whether the child is there and the code folds away; without one the code stays (the only way in today).
  const presence = useWorldPresence(api, token, lesson.lesson_id, lesson.player_id);
  const signedIn = presence === 'in_world' || presence === 'waiting';
  const codeBlock = (
    <>
        <strong
          data-testid="join-code"
          aria-label={code.split('').join(' ')}
          style={{
            fontFamily: T.fonts.target,
            fontSize: presence === 'in_world' || presence === 'waiting' ? `${T.scale.display.sizePx}px` : 'clamp(56px, 11vw, 112px)',
            lineHeight: 1,
            letterSpacing: '0.12em',
            color: C.sun,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {code.slice(0, 3)}
          <span style={{ display: 'inline-block', width: '0.35em' }} />
          {code.slice(3)}
        </strong>
        <span style={{ fontSize: `${T.scale['body-l'].sizePx}px` }}>{S.joinOpen(primary.url)}</span>
        <ul data-testid="join-links" style={{ margin: 0, paddingLeft: sp(4), fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>
          {links.map((l) => (
            <li key={l.kind}>
              {l.kind === '3d' ? S.join3d : S.joinFallback}: <span style={{ color: C['paper-0'] }}>{l.url}</span>
              {l.kind === '3d' && !STUDENT_3D_LESSON_READY ? ` — ${S.join3dPending}` : ''}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          <Button
            type="button"
            variant="paper"
            onClick={async () => setCopyMsg((await copyText(primary.url)) ? S.copied : S.copyFailed)}
          >
            {S.copyJoinUrl}
          </Button>
          {copyMsg ? <span role="status">{copyMsg}</span> : null}
          {lesson.expires_at ? (
            <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>
              {S.codeValidUntil(kstLabel(lesson.expires_at))}
            </span>
          ) : null}
        </div>
    </>
  );
  return (
    <section
      data-testid="director-joincode"
      style={{
        border,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        backgroundColor: C['night-900'],
        color: C['paper-0'],
        padding: sp(4),
        display: 'flex',
        flexWrap: 'wrap',
        gap: sp(4),
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ display: 'grid', gap: sp(1) }}>
        {signedIn ? (
          <>
            <strong
              data-testid="world-presence"
              data-state={presence ?? ''}
              role="status"
              style={{ fontSize: `${T.scale.h2.sizePx}px`, lineHeight: 1.2, color: presence === 'in_world' ? C.leaf : C.sun }}
            >
              {presence === 'in_world' ? S.worldIn(lesson.nickname) : S.worldWaiting(lesson.nickname)}
            </strong>
            <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>
              {presence === 'in_world' ? S.worldInHelp : S.worldWaitingHelp}
            </span>
            {presence === 'in_world' ? (
              <details data-testid="join-code-fallback">
                <summary style={{ cursor: 'pointer', fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>{S.codeFallback}</summary>
                <div style={{ display: 'grid', gap: sp(1), marginTop: sp(2) }}>{codeBlock}</div>
              </details>
            ) : (
              // Not in the world yet: the child may come from another (not signed-in) device, so the code stays out.
              <div data-testid="join-code-waiting" style={{ display: 'grid', gap: sp(1), marginTop: sp(2) }}>
                <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>{S.codeOtherDevice}</span>
                {codeBlock}
              </div>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>
              {S.joinTitle} · {lesson.nickname}
              {presence === 'no_device' ? ` · ${S.noDevice}` : ''}
            </span>
            {codeBlock}
          </>
        )}
      </div>
      <div style={{ display: 'grid', gap: sp(0), textAlign: 'right' }}>
        <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>{S.lessonTimer}</span>
        <strong
          data-testid="lesson-timer"
          style={{
            fontSize: `${T.scale.display.sizePx}px`,
            lineHeight: `${T.scale.display.lineHeightPx}px`,
            fontVariantNumeric: 'tabular-nums',
            color: elapsedMs > totalMinutes * 60_000 ? C.brand : C['paper-0']
          }}
        >
          {formatClock(elapsedMs)}
        </strong>
        <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>{S.planned(totalMinutes)}</span>
      </div>
    </section>
  );
}

function StageRail({
  lesson,
  clock,
  viewStageId,
  onView
}: {
  lesson: DirectorLessonRecord;
  clock: number;
  viewStageId: string;
  onView: (id: string) => void;
}): React.ReactElement {
  const plan = planById(lesson.plan_id);
  return (
    <Box title={S.stageRail} testId="director-stage-rail">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
        {plan.stages.map((st) => {
          const status = stageStatus(plan, lesson, st.id);
          const el = stageElapsedMs(lesson, st.id, clock);
          const over = el > st.minutes * 60_000;
          const viewing = st.id === viewStageId;
          return (
            <li key={st.id}>
              <button
                type="button"
                data-testid={`stage-${st.id}`}
                data-status={status}
                aria-current={status === 'now' ? 'step' : undefined}
                onClick={() => onView(st.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: sp(2),
                  textAlign: 'left',
                  cursor: 'pointer',
                  minHeight: `${TOKENS.shape.touchTargetMinPx}px`,
                  padding: `${sp(1)} ${sp(2)}`,
                  fontFamily: T.fonts.ui,
                  fontSize: `${T.scale.body.sizePx}px`,
                  color: C['ink-900'],
                  backgroundColor: status === 'now' ? C.sun : status === 'done' ? C['paper-100'] : C['paper-0'],
                  border: viewing ? `${TOKENS.shape.focusOutlineWidthPx}px solid ${C['sky-d']}` : border,
                  borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                  boxShadow: status === 'now' ? TOKENS.shape.shadowDefault : 'none'
                }}
              >
                <span style={{ fontWeight: status === 'now' ? 700 : 400 }}>{st.titleKo}</span>
                <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: `${T.scale.small.sizePx}px` }}>
                  {status === 'now' ? `${S.stageNow} · ` : status === 'done' ? `${S.stageDone} · ` : ''}
                  <span style={{ color: over ? C['brand-d'] : C['ink-900'], fontWeight: over ? 700 : 400 }}>
                    {el > 0 ? formatClock(el) : '00:00'}
                  </span>
                  {` / ${st.minutes}분`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Box>
  );
}

/** The newest stage move if the server made it by itself (docs/18 §9), on this console's clock. */
/**
 * The stage panel after the server moved the stage from `was` to `to`: a teacher looking at the running stage follows it
 * (its button stays "next stage"); a teacher reading another stage's panel keeps it (PR 146 review).
 */
export function followStageView(view: string, was: string, to: string): string {
  return view === was ? to : view;
}

function autoMoveOf(log: FeedLiveExtra['stage_log'], skewMs: number): { stageId: string; why: string; at: number } | null {
  const last = log?.[log.length - 1];
  return last?.source?.startsWith('auto:') ? { stageId: last.stage_id, why: last.source.slice(5), at: last.at - skewMs } : null;
}

function StagePanel({
  api,
  token,
  lesson,
  stage,
  clock,
  onScreen,
  disabled,
  now,
  onAuthError,
  onPushed,
  startedAt,
  autoMove = null
}: {
  api: LessonApi;
  token: string;
  lesson: DirectorLessonRecord;
  stage: LessonStage;
  clock: number;
  onScreen: string[] | null;
  disabled: boolean;
  now: () => number;
  onAuthError: (code: string) => void;
  onPushed: (stageId: string) => void;
  startedAt: number;
  autoMove?: { stageId: string; why: string; at: number } | null;
}): React.ReactElement {
  const plan = planById(lesson.plan_id);
  const allTargets = new Set(stage.targets.map((t) => t.text));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushedAt, setPushedAt] = useState<number | null>(null);
  const isCurrent = lesson.stage_id === stage.id;
  const next = nextStage(plan, stage.id);

  // Retry repeats exactly the push that failed (this stage or the quick "next stage" one).
  const lastAttempt = useRef<{ st: LessonStage; chosen: Set<string>; custom: string[] } | null>(null);
  const push = async (st: LessonStage, payloadChosen: Set<string>, payloadCustom: string[]) => {
    lastAttempt.current = { st, chosen: payloadChosen, custom: payloadCustom };
    const payload = buildStagePush(st, payloadChosen, payloadCustom);
    if (payload.targets.length === 0) {
      setError(S.noTargets);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.pushStage(token, lesson.lesson_id, payload);
      setPushedAt(now());
      onPushed(st.id);
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setError(directorErrorText(code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      title={stage.titleKo}
      testId="director-stage-panel"
      right={
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
          {isCurrent ? `${S.stageTimer} ${formatClock(stageElapsedMs(lesson, stage.id, clock))} · ` : ''}
          {S.planned(stage.minutes)}
        </span>
      }
    >
      <div style={{ display: 'grid', gap: sp(3) }}>
        {autoMove ? (
          <Notice kind="ok" testId="stage-auto-moved">
            {M.autoMoved(autoMove.why, formatClock(Math.max(0, autoMove.at - startedAt)))}
          </Notice>
        ) : null}
        {isCurrent ? (
          <p data-testid="stage-auto-rule" style={{ margin: 0, color: C['ink-700'] }}>
            {M.autoRule(Math.max(1, Math.min(onScreen?.length || stage.targets.length, 2)), stage.minutes, !next)}
          </p>
        ) : null}
        <div style={{ backgroundColor: C['paper-100'], border, borderRadius: `${TOKENS.shape.radiusButtonPx}px`, padding: sp(2) }}>
          <strong style={{ display: 'block', marginBottom: sp(1) }}>{S.guideLabel}</strong>
          <p style={{ margin: 0, fontSize: `${T.scale['body-l'].sizePx}px`, lineHeight: `${T.scale['body-l'].lineHeightPx}px` }}>
            {stage.teacherGuideKo}
          </p>
          {stage.stepsKo?.length ? (
            <details style={{ marginTop: sp(2) }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.stepsMore}</summary>
              <ol data-testid="stage-steps" style={{ margin: `${sp(2)} 0 0`, paddingLeft: sp(4), display: 'grid', gap: sp(1) }}>
                {stage.stepsKo.map((step) => (
                  <li key={step} style={{ fontSize: `${T.scale.body.sizePx}px`, lineHeight: `${T.scale.body.lineHeightPx}px` }}>
                    {step}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: sp(1) }}>{S.scriptLabel}</strong>
          <p
            lang="en"
            data-testid="teacher-script"
            style={{
              margin: 0,
              fontFamily: T.fonts.target,
              fontSize: `${T.scale.h3.sizePx}px`,
              lineHeight: `${T.scale.h3.lineHeightPx}px`,
              color: C['sky-d']
            }}
          >
            “{stage.teacherScriptEn}”
          </p>
        </div>
        <p style={{ margin: 0 }}>
          <strong>{S.studentGoalLabel}:</strong> {stage.studentGoalKo}
        </p>
        <div>
          <strong style={{ display: 'block', marginBottom: sp(1) }}>{S.targetsLabel}</strong>
          <ul data-testid="stage-targets" style={{ margin: 0, paddingLeft: sp(4), display: 'grid', gap: sp(1) }}>
            {stage.targets.map((t) => (
              <li key={t.text}>
                <span style={{ color: C['sun-d'], fontWeight: 700, marginRight: sp(2) }}>{starsText(t.stars)}</span>
                <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px` }}>
                  {t.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          {/* One button: on the running stage it moves on, on another stage it goes there (all the plan's sentences). */}
          {isCurrent ? (
            next ? (
              <Button
                type="button"
                variant="brand"
                size="game"
                disabled={busy || disabled}
                data-testid="push-next"
                onClick={() => void push(next, new Set(next.targets.map((t) => t.text)), [])}
              >
                {busy ? S.pushing : M.pushNext}
              </Button>
            ) : null
          ) : (
            <Button
              type="button"
              variant="brand"
              size="game"
              disabled={busy || disabled}
              data-testid="push-stage"
              onClick={() => void push(stage, allTargets, [])}
            >
              {busy ? S.pushing : M.pushThis}
            </Button>
          )}
          {pushedAt ? (
            <span role="status" style={{ fontWeight: 700, color: C['leaf-d'] }}>
              {S.pushedAt(formatClock(pushedAt - startedAt))}
            </span>
          ) : null}
        </div>
        {error ? (
          <Notice
            onRetry={() => {
              const a = lastAttempt.current;
              void (a ? push(a.st, a.chosen, a.custom) : push(stage, allTargets, []));
            }}
            retryLabel={S.retry}
          >
            {error}
          </Notice>
        ) : null}
      </div>
    </Box>
  );
}

/** Lessons the server closed as 'left without ending' (edge LESSON_IDLE_CLOSE_MS) whose report is not sent yet. */
function AutoClosedBox({
  rows,
  startingId,
  startError,
  onOpen,
  onContinue
}: {
  rows: AutoClosedLessonRow[];
  startingId: string | null;
  startError: { id: string; text: string } | null;
  onOpen: (r: AutoClosedLessonRow) => void;
  onContinue: (r: AutoClosedLessonRow) => void;
}): React.ReactElement {
  const [focus] = useState(() => autoCloseFocus());
  // The hub card's button lands here: bring that row's button into view once (Button does not forward refs).
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const b = boxRef.current?.querySelector<HTMLButtonElement>('[data-auto-focus="1"]');
    b?.scrollIntoView?.({ block: 'center' });
    b?.focus();
  }, []);
  return (
    <Box title={A.boxTitle} tone="tinted" testId="director-auto-closed">
      <p style={{ margin: `0 0 ${sp(2)}` }}>{A.boxHelp}</p>
      <div ref={boxRef} style={{ display: 'grid', gap: sp(2) }}>
        {rows.map((r) => {
          const plan = planById(r.plan_id);
          const marked = focus?.lessonId === r.lesson_id;
          return (
            <div
              key={r.lesson_id}
              data-testid="auto-closed-lesson"
              data-marked={marked ? '1' : undefined}
              style={{
                display: 'grid',
                gap: sp(1),
                padding: sp(2),
                borderRadius: 8,
                border: marked ? `3px solid ${C['sky-d']}` : border,
                backgroundColor: C['paper-0']
              }}
            >
              <span style={{ fontWeight: 700 }}>
                {A.line(r.nickname, plan.titleKo, kstLabel(r.started_at), kstLabel(r.ended_at), r.utterances, r.passes)}
              </span>
              {r.draft_summary_ko ? <span style={{ fontSize: `${T.scale.small.sizePx}px` }}>{r.draft_summary_ko}</span> : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
                <Button
                  type="button"
                  variant="brand"
                  data-testid={`auto-report-${r.lesson_id}`}
                  data-auto-focus={marked && focus?.next === 'report' ? '1' : undefined}
                  onClick={() => onOpen(r)}
                >
                  {A.openReport}
                </Button>
                <Button
                  type="button"
                  variant="paper"
                  data-testid={`auto-continue-${r.lesson_id}`}
                  data-auto-focus={marked && focus?.next === 'continue' ? '1' : undefined}
                  disabled={startingId === r.player_id}
                  onClick={() => onContinue(r)}
                >
                  {startingId === r.player_id ? A.continuing : A.continueLesson}
                </Button>
              </div>
              {startError?.id === r.player_id ? <Notice>{startError.text}</Notice> : null}
            </div>
          );
        })}
      </div>
    </Box>
  );
}

function EndLessonBox({
  api,
  token,
  lesson,
  onAuthError,
  onEnded,
  onReset,
  endedElsewhere = false,
  autoPending = false,
  draftSummary = null
}: {
  api: LessonApi;
  token: string;
  lesson: DirectorLessonRecord;
  onAuthError: (code: string) => void;
  onEnded: (reportPath: string) => void;
  onReset: () => void;
  /** Ended on another device: no new report form, only the existing link (the server hands it back) or a new lesson. */
  endedElsewhere?: boolean;
  /** Closed by the server's idle sweep, report not sent: the comment form and an explicit send (send: true). */
  autoPending?: boolean;
  draftSummary?: string | null;
}): React.ReactElement {
  const [comment, setComment] = useState('');
  const [next, setNext] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const end = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.endLesson(token, lesson.lesson_id, {
        teacher_comment: comment.trim().slice(0, TEACHER_COMMENT_MAX),
        next_lesson_at: next.trim().slice(0, NEXT_LESSON_MAX),
        // The auto-closed lesson's report goes out only on this explicit send (the teacher pressed it twice).
        ...(autoPending ? { send: true } : {})
      });
      onEnded(res.report_path || `/r/${res.share_token}`);
    } catch (e) {
      const code = errorCodeOf(e);
      onAuthError(code);
      setError(directorErrorText(code));
    } finally {
      setBusy(false);
    }
  };

  if (lesson.report_path) {
    const url = `${currentOrigin()}${lesson.report_path}`;
    return (
      <Box title={S.reportReady} testId="director-report" tone="tinted">
        <div style={{ display: 'grid', gap: sp(2) }}>
          <label style={labelStyle}>
            {S.reportLink}
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={inputStyle} data-testid="report-url" />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
            <Button type="button" variant="brand" onClick={async () => setCopyMsg((await copyText(url)) ? S.copied : S.copyFailed)}>
              {S.copyReport}
            </Button>
            <a
              href={`${lesson.report_path}?preview=1`}
              target="_blank"
              rel="noopener"
              style={{ color: C['sky-d'], fontWeight: 700, padding: sp(1) }}
            >
              {S.previewReport}
            </a>
            {copyMsg ? <span role="status">{copyMsg}</span> : null}
          </div>
          <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px` }}>{S.previewNote}</p>
          <div>
            <Button type="button" variant="paper" onClick={onReset}>
              {S.newLesson}
            </Button>
          </div>
        </div>
      </Box>
    );
  }

  const commentFields = (
    <>
      <label style={labelStyle}>
        {S.teacherComment}
        <textarea
          value={comment}
          maxLength={TEACHER_COMMENT_MAX}
          rows={3}
          onChange={(e) => setComment(e.target.value)}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>
      <label style={labelStyle}>
        {S.nextLesson}
        <input value={next} maxLength={NEXT_LESSON_MAX} onChange={(e) => setNext(e.target.value)} style={inputStyle} />
      </label>
    </>
  );

  if (endedElsewhere && autoPending) {
    return (
      <Box title={A.endedAutoTitle} testId="director-ended-auto" tone="tinted">
        <div style={{ display: 'grid', gap: sp(2) }}>
          <p style={{ margin: 0 }}>{A.endedAutoHelp}</p>
          {draftSummary ? (
            <div data-testid="auto-draft">
              <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{A.draftLabel}</span>
              <div style={{ fontWeight: 700 }}>{draftSummary}</div>
            </div>
          ) : null}
          {commentFields}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
            <Button type="button" variant="brand" disabled={busy} onClick={() => void end()} data-testid="send-auto-report">
              {busy ? A.sending : armed ? A.sendConfirm : A.send}
            </Button>
            {armed && !busy ? (
              <Button type="button" variant="paper" onClick={() => setArmed(false)}>
                ✕
              </Button>
            ) : null}
            <Button type="button" variant="paper" onClick={onReset} data-testid="auto-back">
              {A.backToList}
            </Button>
          </div>
          {error ? (
            <Notice onRetry={() => void end()} retryLabel={S.retry}>
              {error}
            </Notice>
          ) : null}
        </div>
      </Box>
    );
  }

  if (endedElsewhere) {
    const fetchReport = async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.endLesson(token, lesson.lesson_id, {});
        onEnded(res.report_path || `/r/${res.share_token}`);
      } catch (e) {
        const code = errorCodeOf(e);
        onAuthError(code);
        setError(directorErrorText(code));
      } finally {
        setBusy(false);
      }
    };
    return (
      <Box title={S.lessonEndedElsewhere} testId="director-ended-elsewhere" tone="tinted">
        <div style={{ display: 'grid', gap: sp(2) }}>
          <p style={{ margin: 0 }}>{S.endedElsewhereHelp}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
            <Button type="button" variant="brand" disabled={busy} onClick={() => void fetchReport()} data-testid="fetch-report">
              {busy ? S.loading : S.fetchReport}
            </Button>
            <Button type="button" variant="paper" onClick={onReset} data-testid="new-lesson">
              {S.newLesson}
            </Button>
          </div>
          {error ? (
            <Notice onRetry={() => void fetchReport()} retryLabel={S.retry}>
              {error}
            </Notice>
          ) : null}
        </div>
      </Box>
    );
  }

  return (
    <Box title={S.endTitle} testId="director-end">
      <div style={{ display: 'grid', gap: sp(2) }}>
        {commentFields}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void end()} data-testid="end-lesson">
            {busy ? S.ending : armed ? S.endConfirm : S.endButton}
          </Button>
          {armed && !busy ? (
            <Button type="button" variant="paper" onClick={() => setArmed(false)}>
              ✕
            </Button>
          ) : null}
        </div>
        {error ? (
          <Notice onRetry={() => void end()} retryLabel={S.retry}>
            {error}
          </Notice>
        ) : null}
      </div>
    </Box>
  );
}
