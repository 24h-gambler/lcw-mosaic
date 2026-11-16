/**
 * /join — the child's lesson screen (docs/18 §1). Code → lesson token → the sentences the teacher put up, a big mic
 * button (browser speech recognition, en-US, 3 alternatives) with a typing fallback, and the server's stars and words.
 * No prices, payment or deadlines (AGENTS 4.9). The server scores; the client only measures and sends.
 */
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createMediaClipRecorder, turnClipRecordingOff, uploadClip, type ClipRecorder } from '@lcw/audio';
import { flushOutbox, isRetryableStatus, newUtteranceClientId, outboxSessionStore, pushOutbox, readOutbox } from '@lcw/content';
import { Button, TOKENS } from '@lcw/ui';
import {
  LessonApiError,
  createLessonApi,
  errorCodeOf,
  loadStudentSession,
  saveStudentSession,
  type LessonApi,
  type UtteranceInput
} from './lessonApi.js';
import {
  INITIAL_JOIN_STATE,
  LESSON_POLL_MS,
  TARGET_TEXT_MAX,
  clampMs,
  displayTarget,
  heardWordMask,
  hintLevelFor,
  joinCodeFromSearch,
  joinReducer,
  pickAlternative,
  targetCards,
  type JoinState,
  type SpeechAlternative,
  type TargetCard
} from './lessonFlow.js';
import { detectInAppBrowser } from './inapp.js';
import { InAppBrowserBanner } from './WebUx.js';
import { LessonStyle, Notice, border, sp } from './lessonUi.js';
import { LESSON_STRINGS_KO } from './strings.js';
import { P } from './presenceStrings.js';
// The same 1PC teacher panel as the 3D screen: a low-spec PC takes the lesson here (docs/19 §4).
import { TeacherPanel } from '../../client/src/lesson/TeacherPanel.js';

/** The lesson mic check this tab ran on the 3D screen (same keys as apps/client lesson/api.ts); null when none. */
function readMicStatus(): string | null {
  try {
    const v = globalThis.sessionStorage?.getItem('lcw.micStatus') ?? null;
    return v === 'ok' || v === 'quiet' || v === 'none' || v === 'skipped' ? v : null;
  } catch {
    return null;
  }
}

const S = LESSON_STRINGS_KO.join;
const C = TOKENS.colors;
const T = TOKENS.typography;

/* ---------- browser speech recognition (typed locally: not in lib.dom) ---------- */

interface RecAlternative {
  transcript: string;
  confidence?: number;
}
interface RecLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<RecAlternative>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecLike;

export function findRecognition(g: unknown = globalThis): RecognitionCtor | null {
  const w = g as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const BLOCKING_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

export interface StudentJoinProps {
  api?: LessonApi;
  initialState?: JoinState;
  /** null = no recognizer (forces typing); undefined = detect in the browser. */
  recognition?: RecognitionCtor | null;
  userAgent?: string;
  now?: () => number;
}

function initialJoinState(): JoinState {
  const s = loadStudentSession();
  if (s) return joinReducer(INITIAL_JOIN_STATE, { type: 'resume', token: s.token, lessonId: s.lessonId, nickname: s.nickname });
  // /join?code=123456 (link from the teacher, or the 3D client sending a low-tier device here) joins at once.
  const code = joinCodeFromSearch(typeof location !== 'undefined' ? location.search : '');
  return code ? joinReducer(joinReducer(INITIAL_JOIN_STATE, { type: 'code_changed', value: code }), { type: 'submit' }) : INITIAL_JOIN_STATE;
}

export function StudentJoin(props: StudentJoinProps): React.ReactElement {
  const apiRef = useRef<LessonApi>(props.api ?? createLessonApi());
  const api = apiRef.current;
  const now = props.now ?? Date.now;
  const [state, dispatch] = useReducer(joinReducer, undefined, () => props.initialState ?? initialJoinState());

  // Join request.
  useEffect(() => {
    if (state.phase !== 'joining') return undefined;
    let live = true;
    api
      .join(state.code)
      .then((r) => {
        if (!live) return;
        saveStudentSession({ token: r.student_token, lessonId: r.lesson_id, nickname: r.nickname, voiceStore: r.voice_store === true });
        dispatch({ type: 'join_ok', result: r });
      })
      .catch((e: unknown) => {
        if (live) dispatch({ type: 'join_failed', code: errorCodeOf(e) });
      });
    return () => {
      live = false;
    };
  }, [state.phase, state.code, api]);

  // Answers kept on this device while the connection was down (packages/content lesson-outbox).
  const lessonId = state.lessonId;
  const [outboxN, setOutboxN] = useState(() => (lessonId ? readOutbox(outboxSessionStore(), lessonId).length : 0));
  const flushing = useRef(false);

  // Lesson state polling (stops when the lesson ends).
  const polling = state.phase === 'lesson' && Boolean(state.token);
  const token = state.token;
  useEffect(() => {
    if (!polling || !token) return undefined;
    let live = true;
    const tick = async () => {
      try {
        const st = await api.lessonState(token, readMicStatus());
        if (live) dispatch({ type: 'state', state: st });
        // Back online: what the child said meanwhile goes now, in order.
        if (live && lessonId && !flushing.current && readOutbox(outboxSessionStore(), lessonId).length > 0) {
          flushing.current = true;
          try {
            const res = await flushOutbox({
              store: outboxSessionStore(),
              lessonId,
              send: (b) => api.postUtterance(token, b as unknown as UtteranceInput),
              statusOf: (e) => (e instanceof LessonApiError ? e.status : null)
            });
            if (live) {
              if (res.sent.length) dispatch({ type: 'outbox_results', results: res.sent });
              setOutboxN(res.left);
            }
          } finally {
            flushing.current = false;
          }
        }
      } catch (e) {
        if (!live) return;
        const code = errorCodeOf(e);
        if (code === 'student_only') saveStudentSession(null);
        dispatch({ type: 'state_failed', code });
      }
    };
    void tick();
    const id = setInterval(() => void tick(), LESSON_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [polling, token, api, lessonId]);

  const leave = () => {
    saveStudentSession(null);
    dispatch({ type: 'leave' });
  };

  const ua = props.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const detection = detectInAppBrowser(ua);
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '/join';

  return (
    <div
      className="lcw-lesson"
      data-testid="student-join"
      data-phase={state.phase}
      style={{ maxWidth: '760px', margin: '0 auto', display: 'grid', gap: sp(4) }}
    >
      <LessonStyle />
      {detection.kind && state.phase !== 'ended' ? <InAppBrowserBanner detection={detection} pageUrl={pageUrl} /> : null}
      {state.phase === 'code' || state.phase === 'joining' ? (
        <CodeEntry state={state} onChange={(v) => dispatch({ type: 'code_changed', value: v })} onSubmit={() => dispatch({ type: 'submit' })} />
      ) : null}
      {state.phase === 'lesson' && token ? (
        <LessonPlay
          api={api}
          token={token}
          state={state}
          now={now}
          recognition={props.recognition === undefined ? findRecognition() : props.recognition}
          isIosWebView={Boolean(detection.kind && detection.isIOS)}
          onResult={(result) => dispatch({ type: 'utterance_result', result })}
          outboxN={outboxN}
          onQueued={setOutboxN}
          onSessionGone={() => {
            saveStudentSession(null);
            dispatch({ type: 'state_failed', code: 'student_only' });
          }}
        />
      ) : null}
      {state.phase === 'ended' ? <EndScreen state={state} onLeave={leave} /> : null}
    </div>
  );
}

/* ---------- code entry ---------- */

function CodeEntry({
  state,
  onChange,
  onSubmit
}: {
  state: JoinState;
  onChange: (v: string) => void;
  onSubmit: () => void;
}): React.ReactElement {
  const busy = state.phase === 'joining';
  return (
    <section
      style={{
        backgroundColor: C['paper-0'],
        border,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        padding: sp(5),
        display: 'grid',
        gap: sp(3),
        textAlign: 'center',
        maxWidth: '520px',
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box'
      }}
    >
      <JoinMascot />
      <h1 style={{ margin: 0, fontSize: `${T.scale.h1.sizePx}px`, lineHeight: `${T.scale.h1.lineHeightPx}px` }}>{S.title}</h1>
      <p style={{ margin: 0, fontSize: `${T.scale['body-l'].sizePx}px` }}>{S.codePrompt}</p>
      <p data-testid="fallback-note" style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>
        {S.fallbackNote}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        style={{ display: 'grid', gap: sp(3) }}
      >
        <input
          aria-label={S.codeLabel}
          data-testid="join-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={state.code}
          disabled={busy}
          placeholder="••••••"
          onChange={(e) => onChange(e.target.value)}
          style={{
            border,
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
            fontFamily: T.fonts.target,
            fontSize: `${T.scale.display.sizePx}px`,
            letterSpacing: '0.3em',
            textAlign: 'center',
            padding: `${sp(2)} ${sp(2)}`,
            width: '100%',
            boxSizing: 'border-box',
            backgroundColor: C['paper-50'],
            color: C['ink-900']
          }}
        />
        <Button type="submit" variant="brand" size="game" disabled={busy} style={{ fontSize: `${T.scale.h3.sizePx}px` }}>
          {busy ? S.entering : S.enter}
        </Button>
      </form>
      {state.error ? (
        <Notice kind="info" testId="join-error">
          {state.error}
        </Notice>
      ) : null}
    </section>
  );
}

/** A small block-style face; pure SVG from tokens (no image assets). */
function JoinMascot(): React.ReactElement {
  return (
    <svg viewBox="0 0 64 48" width="96" height="72" aria-hidden="true" style={{ margin: '0 auto', display: 'block' }}>
      <rect x="12" y="4" width="40" height="40" fill={C.sun} stroke={C['ink-900']} strokeWidth="2" />
      <rect x="12" y="4" width="40" height="10" fill={C['ink-700']} />
      <rect x="22" y="20" width="6" height="6" fill={C['ink-900']} />
      <rect x="36" y="20" width="6" height="6" fill={C['ink-900']} />
      <rect x="24" y="32" width="16" height="4" fill={C['brand-d']} />
    </svg>
  );
}

/* ---------- lesson ---------- */

interface LessonPlayProps {
  api: LessonApi;
  token: string;
  state: JoinState;
  now: () => number;
  recognition: RecognitionCtor | null;
  isIosWebView: boolean;
  onResult: (r: NonNullable<JoinState['last']>) => void;
  onSessionGone: () => void;
  /** voice_store on (from /v1/join): a recorder for the spoken turn, else null. Test seam. */
  makeClipRecorder?: () => ClipRecorder | null;
  /** Answers waiting on this device; onQueued gets the new count after one is kept. */
  outboxN?: number;
  onQueued?: (n: number) => void;
}

/** The guardian turned voice_store on for this lesson's child: record spoken turns for the guardian's replay. */
function defaultClipRecorder(): ClipRecorder | null {
  return loadStudentSession()?.voiceStore ? createMediaClipRecorder() : null;
}

type MicIssue = null | 'none' | 'blocked';

function LessonPlay({
  api,
  token,
  state,
  now,
  recognition,
  isIosWebView,
  onResult,
  onSessionGone,
  makeClipRecorder = defaultClipRecorder,
  outboxN = 0,
  onQueued
}: LessonPlayProps): React.ReactElement {
  const lesson = state.lesson;
  const mode = lesson?.mode;
  const cards = targetCards(lesson?.targets ?? []);
  const targetsKey = `${lesson?.stage_id ?? ''}|${(lesson?.targets ?? []).join('|')}`;
  const recCtor = isIosWebView ? null : recognition;

  const [selected, setSelected] = useState(0);
  const [micIssue, setMicIssue] = useState<MicIssue>(recCtor ? null : 'none');
  const [typing, setTyping] = useState(!recCtor);
  const [typed, setTyped] = useState('');
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  // The "saved, will send" note goes once the outbox is empty (sent).
  useEffect(() => {
    if (outboxN === 0) setSavedOffline(false);
  }, [outboxN]);
  const [notHeard, setNotHeard] = useState(false);
  const [heard, setHeard] = useState<{ text: string; target: string } | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const shownAt = useRef(now());
  const firstKeyAt = useRef<number | null>(null);
  const pending = useRef<UtteranceInput | null>(null);
  const recRef = useRef<RecLike | null>(null);

  // New sentences on screen: reset the choice and restart the "time to speak" clock.
  useEffect(() => {
    setSelected(0);
    setShowResult(false);
    setNotHeard(false);
    setHeard(null);
    shownAt.current = now();
    firstKeyAt.current = null;
  }, [targetsKey, now]);

  useEffect(() => () => recRef.current?.abort(), []);

  const card: TargetCard | null = cards[Math.min(selected, cards.length - 1)] ?? null;

  const send = useCallback(
    async (payload: UtteranceInput, clip?: Promise<Blob | null>) => {
      pending.current = payload;
      setSending(true);
      setSendFailed(false);
      setSavedOffline(false);
      // One id per answer and the stage it answers: a lost response or a resend from the outbox is the same answer.
      const body: UtteranceInput = {
        ...payload,
        client_id: payload.client_id ?? newUtteranceClientId(now()),
        ...(state.lesson?.stage_id ? { stage_id: state.lesson.stage_id } : {})
      };
      try {
        const r = await api.postUtterance(token, body);
        // Only when the server asked (voice_store on); the child never waits for the upload.
        if (r.audio_upload && clip) void uploadClip(r.audio_upload, clip);
        onResult(r);
        setHeard({ text: payload.transcript, target: payload.target_text });
        setShowResult(true);
        setResultKey((k) => k + 1);
        pending.current = null;
        shownAt.current = now();
        firstKeyAt.current = null;
      } catch (e) {
        if (errorCodeOf(e) === 'student_only') onSessionGone();
        else if (e instanceof LessonApiError && isRetryableStatus(e.status) && state.lessonId) {
          // No connection: keep it on this device (sent after the next good poll), no "send again" (a second answer).
          onQueued?.(pushOutbox(outboxSessionStore(), state.lessonId, { body: body as never, queuedAt: now() }));
          pending.current = null;
          setSavedOffline(true);
        } else setSendFailed(true);
      } finally {
        setSending(false);
      }
    },
    [api, token, onResult, onSessionGone, now, state.lesson?.stage_id, state.lessonId, onQueued]
  );

  const startListening = () => {
    if (!card || listening || sending) return;
    if (!recCtor) {
      setMicIssue('none');
      setTyping(true);
      return;
    }
    let r: RecLike;
    try {
      r = new recCtor();
    } catch {
      setMicIssue('none');
      setTyping(true);
      return;
    }
    const target = card;
    const a = {
      tapAt: now(),
      speechStart: null as number | null,
      speechEnd: null as number | null,
      resultAt: null as number | null,
      alts: [] as SpeechAlternative[],
      error: null as string | null
    };
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.continuous = false;
    r.onspeechstart = () => {
      if (a.speechStart === null) a.speechStart = now();
    };
    r.onspeechend = () => {
      a.speechEnd = now();
    };
    r.onresult = (e) => {
      const first = e.results[0];
      a.alts = first
        ? Array.from(first).map((x) => ({
            transcript: x.transcript ?? '',
            confidence: typeof x.confidence === 'number' ? Math.max(0, Math.min(1, x.confidence)) : 0
          }))
        : [];
      a.resultAt = now();
    };
    r.onerror = (e) => {
      a.error = e.error ?? 'unknown';
    };
    const clipRec = makeClipRecorder();
    r.onend = () => {
      recRef.current = null;
      setListening(false);
      if (a.error && BLOCKING_ERRORS.has(a.error)) {
        // Recognition lost the mic while the recorder held it too: stop recording on this device (recognition wins).
        if (clipRec) turnClipRecordingOff();
        clipRec?.abort();
        setMicIssue('blocked');
        setTyping(true);
        return;
      }
      const pick = pickAlternative(a.alts, target.text, mode);
      if (!pick) {
        clipRec?.abort();
        setNotHeard(true);
        return;
      }
      const clip = clipRec ? clipRec.stop() : undefined;
      const start = a.speechStart ?? a.tapAt;
      void send({
        target_text: target.text.slice(0, TARGET_TEXT_MAX),
        transcript: pick.transcript.trim().slice(0, 400),
        chosen_stars: target.stars,
        hint_level: hintLevelFor(mode),
        latency_ms: clampMs(start - shownAt.current),
        dur_ms: clampMs((a.speechEnd ?? a.resultAt ?? now()) - start),
        stt_source: 'browser',
        confidence: pick.confidence
      }, clip);
    };
    try {
      r.start();
      clipRec?.start();
      recRef.current = r;
      setListening(true);
      setNotHeard(false);
      setShowResult(false);
    } catch {
      setMicIssue('blocked');
      setTyping(true);
    }
  };

  const stopListening = () => recRef.current?.stop();

  const sendTyped = () => {
    const text = typed.trim();
    if (!card || !text || sending) return;
    const typedAt = firstKeyAt.current ?? now();
    void send({
      target_text: card.text.slice(0, TARGET_TEXT_MAX),
      transcript: text.slice(0, 400),
      chosen_stars: card.stars,
      hint_level: hintLevelFor(mode),
      latency_ms: clampMs(typedAt - shownAt.current),
      // Typing is not speaking time.
      dur_ms: 0,
      stt_source: 'keyboard',
      confidence: 1
    });
    setTyped('');
  };

  const last = state.last;
  return (
    <div style={{ display: 'grid', gap: sp(3) }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: `${T.scale.h2.sizePx}px`, lineHeight: `${T.scale.h2.lineHeightPx}px` }}>
          {S.hello(state.nickname)}
        </h1>
        {state.coins !== null || last || lesson?.teacher ? (
          <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
            {lesson?.teacher ? (
              <Chip testId="teacher">
                {lesson.teacher.present ? `👩‍🏫 ${P.childWithTeacher(lesson.teacher.name ?? '선생님')}` : P.childAlone}
              </Chip>
            ) : null}
            {state.coins !== null ? <Chip testId="coins">{`${S.coins} ${state.coins.toLocaleString('ko-KR')}`}</Chip> : null}
            {last ? <Chip testId="said-today">{`${S.saidToday} ${last.utterances_today}`}</Chip> : null}
          </div>
        ) : null}
      </header>
      <TeacherPanel lessonId={state.lessonId} planId={lesson?.plan_id ?? null} stageId={lesson?.stage_id ?? null} />
      {state.pollFailures >= 2 ? <Notice kind="info">{S.reconnecting}</Notice> : null}
      {lesson?.teacher && !lesson.teacher.present ? (
        <Notice kind="info" testId="alone-notice">
          {P.childAloneDetail}
        </Notice>
      ) : null}
      {lesson?.stage_goal_ko ? (
        <p style={{ margin: 0, fontSize: `${T.scale['body-l'].sizePx}px`, fontWeight: 700 }} data-testid="stage-goal">
          {lesson.stage_goal_ko}
        </p>
      ) : null}
      {cards.length === 0 ? (
        <section
          style={{ border, borderRadius: `${TOKENS.shape.radiusCardPx}px`, backgroundColor: C['paper-0'], padding: sp(5), textAlign: 'center' }}
        >
          <p style={{ margin: 0, fontSize: `${T.scale.h3.sizePx}px` }}>{S.waiting}</p>
          <p className="lcw-dots" aria-hidden="true" style={{ fontSize: `${T.scale.h1.sizePx}px`, margin: 0, color: C.brand }}>
            <span>●</span> <span>●</span> <span>●</span>
          </p>
        </section>
      ) : (
        <>
          <p style={{ margin: 0, color: C['ink-700'] }}>
            {mode === 'recall' ? S.recallNote : mode === 'free' ? S.freeNote : S.pickOne}
          </p>
          <div role="radiogroup" aria-label={S.pickOne} style={{ display: 'grid', gap: sp(2) }}>
            {cards.map((c, i) => (
              <TargetButton
                key={`${c.text}-${i}`}
                card={c}
                text={displayTarget(c.text, mode)}
                selected={i === selected}
                onSelect={() => {
                  setSelected(i);
                  setShowResult(false);
                  setNotHeard(false);
                }}
              />
            ))}
          </div>
          <SpeakArea
            typing={typing}
            listening={listening}
            sending={sending}
            micIssue={micIssue}
            hasMic={Boolean(recCtor)}
            typed={typed}
            onTyped={(v) => {
              if (firstKeyAt.current === null) firstKeyAt.current = now();
              setTyped(v);
            }}
            onSpeak={startListening}
            onStop={stopListening}
            onSendTyped={sendTyped}
            onTypeMode={(on) => setTyping(on)}
          />
          {sendFailed && pending.current ? (
            <Notice kind="info" onRetry={() => pending.current && void send(pending.current)} retryLabel={S.send}>
              {S.sendFailed}
            </Notice>
          ) : null}
          {savedOffline ? <Notice kind="info">{S.savedOffline}</Notice> : null}
          {outboxN > 0 ? (
            <p data-testid="join-outbox" style={{ margin: 0, fontWeight: 700 }}>
              {S.queued(outboxN)}
            </p>
          ) : null}
          {notHeard ? <Notice kind="info">{S.notHeard}</Notice> : null}
          {showResult && last && heard ? <ResultPanel key={resultKey} result={last} heard={heard} mode={mode} /> : null}
        </>
      )}
    </div>
  );
}

function Chip({ children, testId }: { children: React.ReactNode; testId?: string }): React.ReactElement {
  return (
    <span
      data-testid={testId}
      style={{
        border,
        borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
        backgroundColor: C.sun,
        color: C['ink-900'],
        padding: `${sp(1)} ${sp(2)}`,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums'
      }}
    >
      {children}
    </span>
  );
}

function TargetButton({
  card,
  text,
  selected,
  onSelect
}: {
  card: TargetCard;
  text: string;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const meta = TOKENS.semantic.stars[card.stars];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid="target-card"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: sp(3),
        width: '100%',
        minHeight: '88px',
        textAlign: 'left',
        cursor: 'pointer',
        padding: `${sp(2)} ${sp(3)}`,
        backgroundColor: selected ? C[meta.color] : C['paper-0'],
        color: C['ink-900'],
        border: `${meta.borderWidthPx + 1}px solid ${C['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: selected ? TOKENS.shape.shadowDefault : TOKENS.shape.shadowPressed,
        transition: `background-color ${TOKENS.motion.fastMs}ms ease-out`
      }}
    >
      <span
        aria-label={`${card.stars}성`}
        style={{ fontSize: `${T.scale.h3.sizePx}px`, fontWeight: 700, minWidth: '72px', color: selected ? C['ink-900'] : C['sun-d'] }}
      >
        {'★'.repeat(meta.starCount)}
      </span>
      <span
        lang="en"
        style={{
          flex: 1,
          fontFamily: T.fonts.target,
          fontSize: `clamp(${T.targetSentenceMinPx}px, 4.5vw, ${T.scale.h2.sizePx}px)`,
          lineHeight: 1.3,
          fontWeight: 700
        }}
      >
        {text}
      </span>
    </button>
  );
}

function SpeakArea({
  typing,
  listening,
  sending,
  micIssue,
  hasMic,
  typed,
  onTyped,
  onSpeak,
  onStop,
  onSendTyped,
  onTypeMode
}: {
  typing: boolean;
  listening: boolean;
  sending: boolean;
  micIssue: MicIssue;
  hasMic: boolean;
  typed: string;
  onTyped: (v: string) => void;
  onSpeak: () => void;
  onStop: () => void;
  onSendTyped: () => void;
  onTypeMode: (on: boolean) => void;
}): React.ReactElement {
  if (sending) {
    return (
      <p role="status" style={{ textAlign: 'center', fontSize: `${T.scale.h3.sizePx}px`, fontWeight: 700, margin: sp(3) }}>
        {S.checking}{' '}
        <span className="lcw-dots" aria-hidden="true">
          <span>●</span>
          <span>●</span>
          <span>●</span>
        </span>
      </p>
    );
  }
  if (typing) {
    return (
      <div style={{ display: 'grid', gap: sp(2) }} data-testid="typing-area">
        {micIssue ? <Notice kind="info">{micIssue === 'blocked' ? S.micBlocked : S.noMic}</Notice> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSendTyped();
          }}
          style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}
        >
          <input
            lang="en"
            aria-label={S.typeLabel}
            placeholder={S.typePlaceholder}
            value={typed}
            maxLength={400}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => onTyped(e.target.value)}
            style={{
              flex: '1 1 260px',
              border,
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              fontFamily: T.fonts.target,
              fontSize: `${T.scale.h3.sizePx}px`,
              padding: `${sp(2)} ${sp(3)}`,
              minHeight: `${TOKENS.shape.gameButtonMinPx}px`,
              backgroundColor: C['paper-0'],
              color: C['ink-900']
            }}
          />
          <Button type="submit" variant="brand" size="game" disabled={!typed.trim()}>
            {S.send}
          </Button>
        </form>
        {hasMic && micIssue !== 'blocked' ? (
          <div>
            <Button type="button" variant="paper" onClick={() => onTypeMode(false)}>
              {S.backToMic}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: sp(2), justifyItems: 'center' }}>
      <button
        type="button"
        data-testid="mic-button"
        className={listening ? 'lcw-pulse' : undefined}
        onClick={listening ? onStop : onSpeak}
        aria-pressed={listening}
        style={{
          width: '160px',
          height: '160px',
          borderRadius: '50%',
          border: `${TOKENS.shape.borderWidthPx + 2}px solid ${C['ink-900']}`,
          backgroundColor: listening ? C.brand : C['brand-d'],
          color: C['paper-0'],
          fontFamily: T.fonts.ui,
          fontSize: `${T.scale.h3.sizePx}px`,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: TOKENS.shape.shadowDefault,
          display: 'grid',
          placeItems: 'center',
          gap: sp(0)
        }}
      >
        <MicGlyph />
        <span>{listening ? S.stopSpeak : S.speak}</span>
      </button>
      {listening ? (
        <p role="status" style={{ margin: 0, fontWeight: 700 }}>
          {S.listening}
        </p>
      ) : null}
      <Button type="button" variant="paper" onClick={() => onTypeMode(true)}>
        {S.typeInstead}
      </Button>
    </div>
  );
}

function MicGlyph(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" fill={C['paper-0']} />
      <rect x="6" y="11" width="2" height="4" fill={C['paper-0']} />
      <rect x="16" y="11" width="2" height="4" fill={C['paper-0']} />
      <rect x="8" y="15" width="8" height="2" fill={C['paper-0']} />
      <rect x="11" y="17" width="2" height="3" fill={C['paper-0']} />
      <rect x="8" y="20" width="8" height="2" fill={C['paper-0']} />
    </svg>
  );
}

function ResultPanel({
  result,
  heard,
  mode
}: {
  result: NonNullable<JoinState['last']>;
  heard: { text: string; target: string };
  mode: string | undefined;
}): React.ReactElement {
  const earned = Math.max(0, Math.min(3, result.stars));
  // Word colouring is a reading aid only; recall keeps the sentence hidden and free talk has no single target.
  const mask = mode === 'recall' || mode === 'free' ? null : heardWordMask(heard.text, heard.target);
  return (
    <section
      data-testid="result-panel"
      aria-live="polite"
      style={{
        border,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        backgroundColor: result.pass ? C['paper-0'] : C['paper-100'],
        padding: sp(4),
        display: 'grid',
        gap: sp(2),
        textAlign: 'center'
      }}
    >
      <div aria-label={`별 ${earned}개`} style={{ fontSize: '64px', lineHeight: 1, letterSpacing: '8px' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={i < earned ? 'lcw-star-in' : undefined}
            style={{
              color: i < earned ? C.sun : C['line-200'],
              WebkitTextStroke: `2px ${C['ink-900']}`,
              animationDelay: `${i * 120}ms`
            }}
          >
            ★
          </span>
        ))}
      </div>
      <p data-testid="feedback" style={{ margin: 0, fontSize: `${T.scale.h3.sizePx}px`, lineHeight: `${T.scale.h3.lineHeightPx}px`, fontWeight: 700 }}>
        {result.feedback_ko}
      </p>
      <p style={{ margin: 0, color: C['ink-700'] }}>
        {S.heard}:{' '}
        {mask ? (
          <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px` }}>
            {heard.target.split(/\s+/).map((w, i) => (
              <span
                key={`${w}-${i}`}
                style={{
                  color: mask[i] ? C['leaf-d'] : C['sun-d'],
                  textDecoration: mask[i] ? 'none' : 'underline',
                  fontWeight: 700,
                  marginRight: '0.3em'
                }}
              >
                {w}
              </span>
            ))}
          </span>
        ) : (
          <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px`, fontWeight: 700 }}>
            “{heard.text}”
          </span>
        )}
      </p>
      <p style={{ margin: 0, fontWeight: 700, color: C['sky-d'] }}>{result.pass ? S.nextOne : S.tryAgain}</p>
    </section>
  );
}

/* ---------- ending ---------- */

function EndScreen({ state, onLeave }: { state: JoinState; onLeave: () => void }): React.ReactElement {
  return (
    <section
      data-testid="join-ended"
      style={{
        border,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        boxShadow: TOKENS.shape.shadowDefault,
        backgroundColor: C['paper-0'],
        padding: sp(5),
        display: 'grid',
        gap: sp(3),
        textAlign: 'center'
      }}
    >
      <div className="lcw-star-in" aria-hidden="true" style={{ fontSize: '80px', lineHeight: 1, color: C.sun, WebkitTextStroke: `2px ${C['ink-900']}` }}>
        ★
      </div>
      <h1 style={{ margin: 0, fontSize: `${T.scale.h1.sizePx}px`, lineHeight: `${T.scale.h1.lineHeightPx}px` }}>
        {S.endTitle(state.nickname)}
      </h1>
      {state.saidCount > 0 ? (
        <div style={{ display: 'flex', gap: sp(2), justifyContent: 'center', flexWrap: 'wrap' }}>
          <Chip>{S.endSaid(state.saidCount)}</Chip>
          <Chip>{S.endStars(state.starsEarned)}</Chip>
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: `${T.scale.h3.sizePx}px` }}>{S.endBye}</p>
      <div>
        <Button type="button" variant="paper" onClick={onLeave}>
          {S.leave}
        </Button>
      </div>
    </section>
  );
}
