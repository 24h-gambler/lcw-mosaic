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
  type AdminStudent,
  type DirectorLessonRecord,
  type FeedLive,
  type LessonApi,
  type LessonFeed,
  type LiveLessonRow,
  type OperatorSessions,
  type PinInput,
  type PinKind
} from './lessonApi.js';
import {
  EMPTY_FEED_VIEW,
  LESSON_POLL_MS,
  NEXT_LESSON_MAX,
  PIN_NOTE_MAX,
  TEACHER_COMMENT_MAX,
  TARGET_TEXT_MAX,
  applyStagePush,
  buildPin,
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
import { handleDirectorKeydown } from './director.js';
import { EMPTY_DIRECTOR_LIVE, mergeDirectorLive, type DirectorLiveView } from './directorLiveState.js';
import { EventsBox, HelpsStrip, NextLessonBox, PossessBox, ProgressBox, StudentScreenBox } from './DirectorLive.js';
import { LessonAudioBox } from './LessonAudioBox.js';
import { Box, LessonStyle, Notice, Stat, border, copyText, currentOrigin, inputStyle, labelStyle, sp } from './lessonUi.js';
import { LESSON_STRINGS_KO } from './strings.js';
import { TeacherModeHelp, TeacherPresenceBox } from './teacherPresence.js';

const S = LESSON_STRINGS_KO.director;

const PLAN_KEY = 'lcw.director.plan';
/** `/director?include_test=1`: smoke and demo students' lessons show on the resume card too (production checks). */
export function includeTestLessons(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('include_test') === '1';
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
  /** Running lessons for the resume card; undefined → fetched. */
  initialLive?: { lessons: LiveLessonRow[]; server_now: number };
  initialFeed?: LessonFeed;
  now?: () => number;
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

  return (
    <div className="lcw-lesson" data-testid="lesson-director" style={{ display: 'grid', gap: sp(4) }}>
      <LessonStyle />
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
      {!token ? null : lesson ? (
        <LiveLesson
          api={api}
          token={token}
          lesson={lesson}
          setLesson={setLesson}
          now={now}
          onAuthError={onAuthError}
          {...(props.initialFeed ? { initialFeed: props.initialFeed } : {})}
        />
      ) : (
        <StudentPicker
          api={api}
          token={token}
          now={now}
          onAuthError={onAuthError}
          initialStudents={props.initialStudents}
          initialLive={props.initialLive}
          onStarted={setLesson}
        />
      )}
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
  initialLive,
  onStarted
}: {
  api: LessonApi;
  token: string;
  now: () => number;
  onAuthError: (code: string) => void;
  initialStudents: AdminStudent[] | undefined;
  initialLive: { lessons: LiveLessonRow[]; server_now: number } | undefined;
  onStarted: (rec: DirectorLessonRecord) => void;
}): React.ReactElement {
  const [live, setLive] = useState<{ lessons: LiveLessonRow[]; server_now: number; at: number } | null>(
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

  const start = async (s: AdminStudent) => {
    setStartingId(s.player_id);
    setStartError(null);
    try {
      // presence: this console beats (teacherPresence.tsx), so the start is the first beat.
      const res = await api.startLesson(token, { player_id: s.player_id, plan_id: planId, presence: true });
      const t = now();
      onStarted({
        lesson_id: res.lesson_id,
        join_code: res.join_code,
        expires_at: res.expires_at,
        plan_id: res.plan?.id ?? planId,
        player_id: s.player_id,
        nickname: s.nickname,
        started_at: t,
        // The server puts the first stage with all its sentences on the student screen at start.
        stage_id: res.plan?.stages?.[0]?.id ?? planById(res.plan?.id).stages[0]!.id,
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
            }}
            disabled={loading}
          >
            {loading ? S.loading : S.refresh}
          </Button>
        }
      >
        <CsvExportRow api={api} token={token} onAuthError={onAuthError} />
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
        {students && students.length === 0 ? <p>{S.studentsEmpty}</p> : null}
        {students && students.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: `${T.scale.body.sizePx}px` }}>
              <thead>
                <tr>
                  <th style={th}>{S.colNickname}</th>
                  <th style={th}>{S.colLevel}</th>
                  <th style={th}>{S.colBirth}</th>
                  <th style={th}>{S.colLast}</th>
                  <th style={th}>{S.col7d}</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.player_id} data-testid="student-row">
                    <td style={{ ...td, fontWeight: 700 }}>{s.nickname}</td>
                    <td style={td}>{s.level}</td>
                    <td style={td}>{s.birth_year ?? '—'}</td>
                    <td style={td}>{kstLabel(s.last_lesson_at)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.utterances_7d ?? 0}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <Button
                        type="button"
                        variant="brand"
                        disabled={startingId !== null}
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
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Box>
      <Box title="1PC · 2PC" testId="director-teacher-mode"><TeacherModeHelp /></Box>
      <NewStudentBox api={api} token={token} onAuthError={onAuthError} onCreated={() => void load()} />
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
  initialFeed?: LessonFeed;
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

  const [liveX, setLiveX] = useState<DirectorLiveView>(() =>
    initialFeed ? mergeDirectorLive(EMPTY_DIRECTOR_LIVE, initialFeed, now()) : EMPTY_DIRECTOR_LIVE
  );
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
      setFeedFails(0);
      setFeedError(null);
      const rec = lessonRef.current;
      if (f.lesson.stage_id && f.lesson.stage_id !== rec.stage_id) {
        // Another tab (or a reload before the push answered) moved the stage: follow the server.
        setLesson(applyStagePush(rec, f.lesson.stage_id, now()));
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

  /* ----- pins (F1/F2 + buttons) ----- */
  const [pinNote, setPinNote] = useState('');
  const [pinFlash, setPinFlash] = useState<string | null>(null);
  const [failedPins, setFailedPins] = useState<PinInput[]>([]);
  const pinCtx = useRef({ note: '', lastTranscript: null as string | null, stageTitle: null as string | null });
  pinCtx.current = {
    note: pinNote,
    lastTranscript: feed.utterances[feed.utterances.length - 1]?.transcript ?? null,
    stageTitle: stageById(plan, lesson.stage_id)?.titleKo ?? null
  };
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;

  const sendPin = useCallback(
    async (pin: PinInput) => {
      try {
        await api.addPin(token, lessonRef.current.lesson_id, pin);
        setPinFlash(`${S.pinSaved} · ${S.pinKinds[pin.kind]} ${formatClock(pin.at_ms)}`);
        setPinNote('');
        void poll();
        return true;
      } catch (e) {
        onAuthError(errorCodeOf(e));
        setFailedPins((prev) => [...prev, pin]);
        return false;
      }
    },
    [api, token, poll, onAuthError]
  );

  const addPin = useCallback(
    (kind: PinKind) => {
      void sendPin(buildPin(kind, now(), startedRef.current, pinCtx.current));
    },
    [sendPin, now]
  );

  useEffect(() => {
    if (ended) return undefined;
    const onKey = (e: KeyboardEvent) => {
      handleDirectorKeydown(e, 0, (b) => addPin(b.kind));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addPin, ended]);

  const retryPins = async () => {
    const pending = failedPins;
    setFailedPins([]);
    for (const p of pending) await sendPin(p);
  };

  const elapsed = clock - startedAt;
  const lastUtterances = [...feed.utterances].reverse();
  const currentStage = stageById(plan, lesson.stage_id ?? serverLesson?.stage_id ?? undefined) ?? undefined;
  const runningMinute = ended ? null : Math.max(0, Math.floor(elapsed / 60_000));

  return (
    <div style={{ display: 'grid', gap: sp(4) }} data-testid="director-live">
      <JoinCodeBar lesson={lesson} elapsedMs={elapsed} totalMinutes={plan.totalMinutes} />
      <TeacherPresenceBox api={api} token={token} lessonId={lesson.lesson_id} ended={ended} />
      <HelpsStrip utterances={live.utterances} pins={feed.pins.length} minutes={liveX.minutes.length} />
      {feedError ? (
        <Notice onRetry={() => void poll()} retryLabel={S.retry} testId="feed-error">
          {`${feedError} ${S.feedStale(feedFails)}`}
        </Notice>
      ) : null}
      {ended && !lesson.report_path ? <Notice kind="info">{S.endedElsewhereHelp}</Notice> : null}
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
          <PossessBox
            api={api}
            token={token}
            lessonId={lesson.lesson_id}
            stage={currentStage}
            live={liveX}
            disabled={ended}
            onSent={() => void poll()}
            onAuthError={onAuthError}
          />
          <EventsBox
            api={api}
            token={token}
            lessonId={lesson.lesson_id}
            stage={currentStage}
            disabled={ended}
            onSent={() => void poll()}
            onAuthError={onAuthError}
          />
        </div>
        <div style={{ display: 'grid', gap: sp(4), minWidth: 0 }}>
          <StudentScreenBox live={liveX} localNow={clock} startedAt={serverStartedAt} />
          <LessonAudioBox token={token} lessonId={lesson.lesson_id} disabled={ended} />
          <Box title={S.liveTitle} testId="director-counters">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
              <Stat label={S.countSaid} value={live.utterances} testId="count-said" />
              <Stat label={S.countPass} value={live.passes} testId="count-pass" />
              <Stat label={S.countStars} value={live.stars_total} testId="count-stars" />
              <Stat label={S.countWords} value={live.words_total} testId="count-words" />
              <Stat label={S.countSpeaking} value={formatClock(live.student_speaking_ms)} />
            </div>
          </Box>
          <ProgressBox minutes={liveX.minutes} live={liveX} plan={plan} runningMinute={runningMinute} />
          <Box title={S.pinsTitle} testId="director-pins">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginBottom: sp(2) }}>
              <Button type="button" variant="sky" disabled={ended} onClick={() => addPin('coaching')}>
                {S.pinCoaching}
              </Button>
              <Button type="button" variant="leaf" disabled={ended} onClick={() => addPin('expression')}>
                {S.pinExpression}
              </Button>
            </div>
            <input
              value={pinNote}
              maxLength={PIN_NOTE_MAX}
              placeholder={S.pinNotePlaceholder}
              aria-label={S.pinNotePlaceholder}
              onChange={(e) => setPinNote(e.target.value)}
              style={inputStyle}
            />
            {pinFlash ? (
              <p role="status" style={{ margin: `${sp(2)} 0 0`, fontWeight: 700, color: C['leaf-d'] }}>
                {pinFlash}
              </p>
            ) : null}
            {failedPins.length > 0 ? (
              <div style={{ marginTop: sp(2) }}>
                <Notice onRetry={() => void retryPins()} retryLabel={S.pinRetry} testId="pins-failed">
                  {S.pinFailed(failedPins.length)}
                </Notice>
              </div>
            ) : null}
            {feed.pins.length > 0 ? (
              <ul style={{ margin: `${sp(2)} 0 0`, paddingLeft: sp(4) }}>
                {feed.pins.map((p) => (
                  <li key={p.id}>
                    <strong>{formatClock(p.at_ms)}</strong> {S.pinKinds[p.kind] ?? p.kind}
                    {p.note ? ` · ${p.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </Box>
          <Box title={S.feedTitle} testId="director-feed">
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
          />
          <NextLessonBox plan={plan} />
        </div>
      </div>
    </div>
  );
}

function JoinCodeBar({
  lesson,
  elapsedMs,
  totalMinutes
}: {
  lesson: DirectorLessonRecord;
  elapsedMs: number;
  totalMinutes: number;
}): React.ReactElement {
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const links = studentJoinLinks(currentOrigin(), lesson.join_code);
  const primary = links[0]!;
  const code = lesson.join_code;
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
        <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C.silver }}>
          {S.joinTitle} · {lesson.nickname}
        </span>
        <strong
          data-testid="join-code"
          aria-label={code.split('').join(' ')}
          style={{
            fontFamily: T.fonts.target,
            fontSize: 'clamp(56px, 11vw, 112px)',
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
  startedAt
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
}): React.ReactElement {
  const plan = planById(lesson.plan_id);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(stage.targets.map((t) => t.text)));
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
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

  const toggle = (text: string) =>
    setChosen((prev) => {
      const n = new Set(prev);
      if (n.has(text)) n.delete(text);
      else n.add(text);
      return n;
    });

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
        <div style={{ backgroundColor: C['paper-100'], border, borderRadius: `${TOKENS.shape.radiusButtonPx}px`, padding: sp(2) }}>
          <strong style={{ display: 'block', marginBottom: sp(1) }}>{S.guideLabel}</strong>
          <p style={{ margin: 0, fontSize: `${T.scale['body-l'].sizePx}px`, lineHeight: `${T.scale['body-l'].lineHeightPx}px` }}>
            {stage.teacherGuideKo}
          </p>
          {stage.stepsKo?.length ? (
            <ol data-testid="stage-steps" style={{ margin: `${sp(2)} 0 0`, paddingLeft: sp(4), display: 'grid', gap: sp(1) }}>
              {stage.stepsKo.map((step) => (
                <li key={step} style={{ fontSize: `${T.scale.body.sizePx}px`, lineHeight: `${T.scale.body.lineHeightPx}px` }}>
                  {step}
                </li>
              ))}
            </ol>
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
        <fieldset style={{ border, borderRadius: `${TOKENS.shape.radiusButtonPx}px`, padding: sp(2), margin: 0 }}>
          <legend style={{ fontWeight: 700, padding: `0 ${sp(1)}` }}>{S.targetsLabel}</legend>
          <div style={{ display: 'grid', gap: sp(1) }}>
            {stage.targets.map((t) => (
              <label
                key={t.text}
                style={{ display: 'flex', gap: sp(2), alignItems: 'center', minHeight: `${TOKENS.shape.touchTargetMinPx}px`, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={chosen.has(t.text)}
                  onChange={() => toggle(t.text)}
                  style={{ width: '22px', height: '22px' }}
                />
                <span style={{ color: C['sun-d'], fontWeight: 700, minWidth: '44px' }}>{starsText(t.stars)}</span>
                <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px` }}>
                  {t.text}
                </span>
              </label>
            ))}
            {custom.map((c, i) => (
              <div key={`${c}-${i}`} style={{ display: 'flex', gap: sp(2), alignItems: 'center' }}>
                <span style={{ minWidth: '44px', fontWeight: 700 }}>+</span>
                <span lang="en" style={{ flex: 1, fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px` }}>
                  {c}
                </span>
                <Button type="button" variant="paper" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                  {S.removeCustom}
                </Button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (v) setCustom([...custom, v]);
                setDraft('');
              }}
              style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}
            >
              <input
                lang="en"
                value={draft}
                maxLength={TARGET_TEXT_MAX}
                placeholder={S.customPlaceholder}
                aria-label={S.customPlaceholder}
                onChange={(e) => setDraft(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 220px', width: 'auto' }}
              />
              <Button type="submit" variant="paper">
                {S.addCustom}
              </Button>
            </form>
          </div>
        </fieldset>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          <Button
            type="button"
            variant="brand"
            size="game"
            disabled={busy || disabled}
            data-testid="push-stage"
            onClick={() => void push(stage, chosen, custom)}
          >
            {busy ? S.pushing : S.pushStage}
          </Button>
          {isCurrent && next ? (
            <Button
              type="button"
              variant="sky"
              disabled={busy || disabled}
              onClick={() => void push(next, new Set(next.targets.map((t) => t.text)), [])}
            >
              {S.pushNext}
            </Button>
          ) : null}
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
              void (a ? push(a.st, a.chosen, a.custom) : push(stage, chosen, custom));
            }}
            retryLabel={S.retry}
          >
            {error}
          </Notice>
        ) : null}
        <div style={{ borderTop: `1px solid ${C['line-200']}`, paddingTop: sp(2) }}>
          <strong style={{ display: 'block', marginBottom: sp(1) }}>{S.onStudentScreen}</strong>
          {onScreen && onScreen.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: sp(4) }} data-testid="on-screen">
              {onScreen.map((t) => (
                <li key={t} lang="en">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: C['ink-500'] }}>{S.nothingOnScreen}</p>
          )}
        </div>
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
  endedElsewhere = false
}: {
  api: LessonApi;
  token: string;
  lesson: DirectorLessonRecord;
  onAuthError: (code: string) => void;
  onEnded: (reportPath: string) => void;
  onReset: () => void;
  /** Ended on another device: no new report form, only the existing link (the server hands it back) or a new lesson. */
  endedElsewhere?: boolean;
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
        next_lesson_at: next.trim().slice(0, NEXT_LESSON_MAX)
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
