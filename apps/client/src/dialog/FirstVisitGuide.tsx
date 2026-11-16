import { MIC_STATUS_KEY as LIVE_MIC_STATUS_KEY } from './mic-status.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { live } from './strings.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { WorldHandle } from '../world/api.js';
import { errandGiverNameKo, errandGoalKo, fetchErrand, type ErrandView } from './errand.js';
import { MicController, type MicView } from './mic-controller.js';
import { micClosed, micCue, playSfx, unlockDialogAudio } from './sound.js';
import type { SpeechEngine } from './speech.js';
import { createDialogSpeechEngine } from './server-stt.js';
import { readStudentToken, SubmitError, type SoloPlayerRef } from './submit.js';
import { currentGoal, goalLine, goalWalkLabel, onGoalChange, type GoalDef } from './goals.js';

/**
 * docs/08 G15 첫 접속 안내: mic check -> move -> first order within 3 minutes (docs/01 활성화, docs/09 첫 문장까지
 * 시간), carried by the first-visit errand (docs/03 D1): the neighbour at the honey cafe door (cast pack: Mia) asks for a cold
 * water, the child orders it from the cafe owner inside (the first order) and brings it out to her for 50 coins. The headset tip and the "volume with a
 * guardian" note are shown once (docs/12 3·4장). The server owns the errand; this screen shows the step and the way.
 */

const F = live('firstVisit');
/** The world's errand giver at the honey cafe door (town.ts `errand_neighbor`). */
export const ERRAND_GIVER_NPC_ID = 'errand_neighbor';
const SEEN_KEY = 'lcw.firstVisitSeen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode: shown again next time, harmless */
  }
}

export interface FirstVisitGuideProps {
  world: WorldHandle | null;
  player?: SoloPlayerRef;
  /** The errand as the shell knows it (results of dialogs update it); null until fetched. */
  errand: ErrandView | null;
  onErrand: (e: ErrandView | null) => void;
  /** A lesson or a dialog window is on screen. */
  hidden?: boolean;
  speech?: SpeechEngine;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function FirstVisitGuide(props: FirstVisitGuideProps): React.ReactElement | null {
  const { world, errand, onErrand, hidden, baseUrl, fetchImpl } = props;
  const token = readStudentToken() || props.player?.deviceToken || '';
  const [intro, setIntro] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** The errand is behind the child (done and its reward line shown): the town goals take the goal line (R2625). */
  const [errandOver, setErrandOver] = useState(false);
  /** When the reward line for the hand-over started (once per page). */
  const rewardAt = useRef<number | null>(null);
  const lastState = useRef<string | null>(null);
  /** State of the last full view fetched; a dialog that moved the errand only reports the new state. */
  const fetchedState = useRef<string | null>(null);
  const onErrandRef = useRef(onErrand);
  onErrandRef.current = onErrand;
  const state = errand?.state ?? null;

  // Fetch the errand (the first call starts the activation clock on the server), and again when a dialog moved it.
  useEffect(() => {
    if (!token) return;
    if (state !== null && state === fetchedState.current) return;
    let live = true;
    void fetchErrand({ token, baseUrl, fetchImpl })
      .then((e) => {
        if (!live) return;
        fetchedState.current = e.state;
        onErrandRef.current(e);
        if (e.state === 'offered' && !seen()) setIntro(true);
      })
      .catch((err) => {
        if (err instanceof SubmitError && err.kind === 'auth') onErrandRef.current(null);
      });
    return () => {
      live = false;
    };
  }, [token, state, baseUrl, fetchImpl]);

  // Goal line on top and the reward toast.
  useEffect(() => {
    if (!errand || !world) return;
    const prev = lastState.current;
    // the town goals own the goal line once the errand is over (first run: "Errand done!" came back over them each
    // time a dialog closed). While hidden the last shown step is kept: the hand-over happens with the dialog open, and
    // the reward toast must still play when it closes (it was skipped: done looked "done before this visit").
    if (hidden || errandOver) return;
    lastState.current = errand.state;
    world.setGoal(errandGoalKo(errand));
    if (errand.state === 'done') {
      if (rewardAt.current === null) {
        // done on an earlier visit: straight to the town goals
        if (!prev || prev === 'done') {
          setErrandOver(true);
          return undefined;
        }
        rewardAt.current = Date.now();
        setToast(F.rewardToast.replace('{coins}', String(errand.reward_coins || 50)));
        playSfx('coin.drop');
      }
      // The refetch after the hand-over brings a new errand object and runs this again: the reward line keeps its
      // 5 s (it was cut at once on a 1440 run, the second run reading the step as "done before this visit").
      const id = setTimeout(() => {
        setToast(null);
        setErrandOver(true);
      }, Math.max(0, 5000 - (Date.now() - (rewardAt.current ?? Date.now()))));
      return () => clearTimeout(id);
    }
    return undefined;
  }, [errand, world, hidden, errandOver]);

  // Guests have no errand (it needs a linked device): they start on the town goals at once.
  if (!token || errandOver) return <TownGoals world={world} hidden={hidden} />;
  if (!errand) return null;
  if (intro && !hidden) {
    return (
      <IntroCard
        speech={props.speech}
        onDone={(status) => {
          sessionSet(MIC_STATUS_KEY, status);
          markSeen();
          setIntro(false);
        }}
      />
    );
  }
  if (hidden) return null;
  // The giver waits at the honey cafe door (world errand_neighbor) and the cafe is behind her: to her to start and to hand
  // over, to the counter to order. A world without walkToNpc walks to the scene.
  const walk =
    errand.state === 'accepted'
      ? { label: `☕ ${F.walkCafe}`, scene: 'honey_cafe' as const, npcId: null }
      : errand.state === 'offered' || errand.state === 'carrying'
        ? { label: `🙋 ${F.walkGiver.replace('{giver}', errandGiverNameKo())}`, scene: 'honey_cafe' as const, npcId: ERRAND_GIVER_NPC_ID }
        : null;
  return (
    <>
      {walk && world ? (
        <button
          type="button"
          className="lcw-errand-walk"
          onClick={(e) => {
            // a focused button keeps the keys (the world ignores keys aimed at buttons): WASD must walk right after
            e.currentTarget.blur();
            unlockDialogAudio();
            playSfx('ui.click');
            if (walk.npcId && world.walkToNpc) void world.walkToNpc(walk.npcId);
            else void world.goToScene(walk.scene);
          }}
          style={WALK_STYLE}
        >
          {walk.label}
        </button>
      ) : null}
      {toast ? (
        <div role="status" className="lcw-errand-toast" style={TOAST_STYLE}>
          🪙 {toast}
        </div>
      ) : null}
    </>
  );
}

const WALK_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  // above the world's controls line (hud .lw-help: bottom 80px on a desktop, 96px under 600px, ~26px tall),
  // which it covered at bottom 96 on a 1440 screen (frame lane, 11-16)
  bottom: 132,
  minHeight: S.touchTargetMinPx,
  padding: '8px 14px',
  background: C['paper-0'],
  color: C['ink-900'],
  border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: S.radiusButtonPx,
  boxShadow: S.shadowDefault,
  fontFamily: T.fonts.ui,
  fontWeight: 800,
  fontSize: T.scale.body.sizePx,
  pointerEvents: 'auto',
  cursor: 'pointer'
};

const TOAST_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  // under the goal line, which wraps to two lines on a phone (about 125px tall there)
  top: 150,
  transform: 'translateX(-50%)',
  background: C.sun,
  color: C['ink-900'],
  border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: S.radiusCardPx,
  boxShadow: S.shadowDefault,
  padding: '8px 16px',
  whiteSpace: 'nowrap',
  fontFamily: T.fonts.ui,
  fontWeight: 800,
  fontSize: T.scale.body.sizePx
};

/** The world's goal marker (world lane, 11-16): the NPC the goal points at gets a '!' and the talk prompt. */
function setGoalNpc(world: WorldHandle, id: string | null): void {
  (world as { setGoalNpc?: (id: string | null) => void }).setGoalNpc?.(id);
}

/**
 * The town goals after the errand (dialog/goals.ts, R2625): the goal line, the '!' over the NPC to find, a walk
 * button there, and a toast when a step is done. Hidden while a lesson or a dialog window is on screen; it puts its
 * goal back when they close (the lesson clears the marker when it ends, this sets it again for solo play).
 */
export function TownGoals(props: { world: WorldHandle | null; hidden?: boolean }): React.ReactElement | null {
  const { world, hidden } = props;
  const [goal, setGoalState] = useState<GoalDef | null>(() => currentGoal());
  const [toast, setToast] = useState<string | null>(null);
  /** The tour ended in this visit: its "seen the whole town" line stays up with the toast. */
  const [tourDone, setTourDone] = useState(false);
  useEffect(
    () =>
      onGoalChange((next, finished) => {
        setGoalState(next);
        if (!finished) return;
        setToast(next ? F.goalStepToast : F.goalTourDone);
        if (!next) setTourDone(true);
        playSfx('coin.drop');
      }),
    []
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => {
      setToast(null);
      if (tourDone) {
        setTourDone(false);
        world?.setGoal('');
      }
    }, 5000);
    return () => clearTimeout(id);
  }, [toast, tourDone, world]);
  useEffect(() => {
    if (!world || hidden) return;
    if (goal) {
      world.setGoal(goalLine(goal));
      setGoalNpc(world, goal.npcId);
    } else if (tourDone) {
      world.setGoal(F.goalTourDone);
      setGoalNpc(world, null);
    }
  }, [world, goal, hidden, tourDone]);
  if (hidden) return null;
  return (
    <>
      {goal && world ? (
        <button
          type="button"
          className="lcw-errand-walk lcw-goal-walk"
          data-goal={goal.id}
          onClick={(e) => {
            e.currentTarget.blur();
            unlockDialogAudio();
            playSfx('ui.click');
            if (world.walkToNpc) void world.walkToNpc(goal.npcId);
            else void world.goToScene(goal.scene);
          }}
          style={WALK_STYLE}
        >
          {goalWalkLabel(goal)}
        </button>
      ) : null}
      {toast ? (
        <div role="status" className="lcw-errand-toast lcw-goal-toast" style={TOAST_STYLE}>
          ⭐ {toast}
        </div>
      ) : null}
    </>
  );
}

/** How the "Hello!" check ended: heard words, too quiet, no usable microphone (blocked / unsupported), or not tried. */
export type MicCheckStatus = 'ok' | 'quiet' | 'none' | 'skipped';
/** sessionStorage key the lesson client reads to tell the teacher console the student's mic (docs/19 4장). */
export const MIC_STATUS_KEY = LIVE_MIC_STATUS_KEY;
const LESSON_CHECK_KEY = 'lcw.lessonMicChecked';

function sessionGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionSet(k: string, v: string): void {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* private mode: the check shows again next time, harmless */
  }
}

/** The mic status of the last check in this tab (null: not checked yet). */
export function readMicStatus(): MicCheckStatus | null {
  const v = sessionGet(MIC_STATUS_KEY);
  return v === 'ok' || v === 'quiet' || v === 'none' || v === 'skipped' ? v : null;
}

/**
 * The same "Hello!" check for players who never see the errand intro (audit G15, 11-16): a lesson student gets it once
 * per lesson when they join (before the teacher's first sentence; the status goes to the teacher console through the
 * lesson state poll), a guest once on this device. Children with a device see it inside the first-visit intro.
 */
export function MicCheckGate(props: { identityKind: string; lessonCode?: string; hidden?: boolean; speech?: SpeechEngine }): React.ReactElement | null {
  // The student session can appear while the page is open ("🎓 수업 코드 넣기" on a bare /world/): look again now and then.
  const [, setTick] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const who = micCheckAudience(props.identityKind, props.lessonCode);
  if (!who || closed || props.hidden) return null;
  const pending = who.audience === 'lesson' ? !who.keys.some((k) => sessionGet(k) === '1') : !seen();
  if (!pending) return null;
  return (
    <IntroCard
      speech={props.speech}
      title={who.audience === 'lesson' ? F.lessonMicTitle : F.title}
      tips={who.audience === 'guest'}
      onDone={(status) => {
        sessionSet(MIC_STATUS_KEY, status);
        // a ?code= student joins while the card is open: remember the lesson id too, so both ways in agree
        const now = micCheckAudience(props.identityKind, props.lessonCode);
        if (now?.audience === 'lesson') for (const k of now.keys) sessionSet(k, '1');
        else markSeen();
        setClosed(true);
      }}
    />
  );
}

/** Student session keys the lesson client writes (lesson/api.ts STUDENT_TOKEN_KEY / STUDENT_LESSON_KEY). */
const STUDENT_TOKEN = 'lcw.studentToken';
const STUDENT_LESSON = 'lcw.studentLessonId';

/**
 * Who gets which check: a lesson student — a `?code=` link, or a student session in this tab (/join and "수업 코드
 * 넣기" both land on a bare /world/ with it) — once per lesson (keyed by lesson id, and by the code before the join
 * answers); a guest once per device; a child with a device sees it inside the first-visit intro instead (null).
 */
export function micCheckAudience(identityKind: string, lessonCode?: string): { audience: 'lesson' | 'guest'; keys: string[] } | null {
  const lessonId = sessionGet(STUDENT_LESSON);
  const student = !!sessionGet(STUDENT_TOKEN) && !!lessonId;
  if (identityKind === 'lesson' || student) {
    const ids = [student ? lessonId : null, lessonCode ?? null].filter((x): x is string => !!x);
    return { audience: 'lesson', keys: ids.map((x) => `${LESSON_CHECK_KEY}:${x}`) };
  }
  return identityKind === 'guest' ? { audience: 'guest', keys: [SEEN_KEY] } : null;
}

/** The first screen: headset tip, volume with a guardian, and a short "Hello!" mic check (skippable). */
function IntroCard(props: { speech?: SpeechEngine; title?: string; tips?: boolean; onDone: (status: MicCheckStatus) => void }): React.ReactElement {
  const engine = useMemo(() => props.speech ?? createDialogSpeechEngine(), [props.speech]);
  const ok = useMemo(() => engine.availability().ok, [engine]);
  const [mic, setMic] = useState<MicView>({ recording: false, interim: '', hangover: false, level: 0 });
  const [note, setNote] = useState<string | null>(ok ? null : F.micNone);
  const [heard, setHeard] = useState<string | null>(null);
  const status = useRef<MicCheckStatus>(ok ? 'skipped' : 'none');
  const ctrl = useRef<MicController | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    const c = new MicController(engine, {
      onView: (v) => {
        setMic(v);
        if (!v.recording) micClosed();
      },
      onFinal: (r) => {
        playSfx('dlg.mic_off');
        const text = r?.transcript.trim() ?? '';
        if (text) {
          setHeard(text);
          setNote(F.micOk.replace('{heard}', text));
          status.current = 'ok';
        } else {
          setNote(F.micQuiet);
          if (status.current !== 'ok') status.current = 'quiet';
        }
      },
      onIssue: (issue) => {
        setNote(issue === 'no_speech' ? F.micQuiet : F.micNone);
        if (status.current !== 'ok') status.current = issue === 'no_speech' ? 'quiet' : 'none';
      }
    });
    ctrl.current = c;
    return () => {
      pending.current = false;
      if (c.recording) micClosed();
      c.dispose();
    };
  }, [engine]);

  const tapMic = () => {
    unlockDialogAudio();
    const c = ctrl.current;
    if (!c || pending.current) return;
    if (c.recording) {
      c.tap();
      return;
    }
    setNote(null);
    pending.current = true;
    void micCue().then((go) => {
      pending.current = false;
      if (go && ctrl.current === c && !c.recording) c.tap();
    });
  };

  const btn = (primary: boolean): React.CSSProperties => ({
    minHeight: S.touchTargetMinPx,
    padding: '10px 16px',
    background: primary ? C['brand-d'] : C['paper-0'],
    color: primary ? C['paper-0'] : C['ink-900'],
    border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
    borderRadius: S.radiusButtonPx,
    boxShadow: S.shadowDefault,
    fontWeight: 800,
    fontSize: T.scale.body.sizePx,
    cursor: 'pointer'
  });

  return (
    <div className="lcw-firstvisit" role="dialog" aria-modal="true" aria-label={F.title} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: `${C['ink-900']}40`, pointerEvents: 'auto', fontFamily: T.fonts.ui }}>
      <div style={{ width: 'min(460px, 100%)', background: C['paper-50'], color: C['ink-900'], border: `${S.borderWidthPx}px solid ${C['ink-900']}`, borderRadius: S.radiusCardPx, boxShadow: S.shadowDefault, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: T.scale.h3.sizePx, lineHeight: 1.3 }}>{props.title ?? F.title}</h2>
        {props.tips === false ? null : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span aria-hidden>🎧</span>
              <span>{F.headset}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: C['ink-700'], fontSize: T.scale.small.sizePx }}>
              <span aria-hidden>🔈</span>
              <span>{F.volume}</span>
            </div>
          </>
        )}
        <div style={{ borderTop: `1px dashed ${C['ink-700']}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>{F.micTitle}</strong>
          <button type="button" className="lcw-firstvisit-mic" style={btn(false)} disabled={!ok} data-on={mic.recording} onClick={tapMic}>
            {mic.recording ? `⏹ ${F.micListening}` : `🎤 ${F.micCta}`}
          </button>
          <div aria-live="polite" style={{ minHeight: 22, color: heard ? C['leaf-d'] : C['ink-700'], fontWeight: heard ? 700 : 400 }}>
            {note ?? ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" style={btn(false)} onClick={() => props.onDone(status.current)}>
            {F.skip}
          </button>
          <button type="button" className="lcw-firstvisit-go" style={btn(true)} onClick={() => props.onDone(status.current)}>
            {F.next}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The same "Hello!" check card, for the settings screen (G14 마이크 점검: check again any time). */
export { IntroCard as MicCheckCard };

export { errandDialogFor } from './errand.js';
