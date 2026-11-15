import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UI_STRINGS_KO } from '@lcw/content';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { WorldHandle } from '../world/api.js';
import { errandGoalKo, fetchErrand, type ErrandView } from './errand.js';
import { MicController, type MicView } from './mic-controller.js';
import { micClosed, micCue, playSfx, unlockDialogAudio } from './sound.js';
import type { SpeechEngine } from './speech.js';
import { createDialogSpeechEngine } from './server-stt.js';
import { readStudentToken, SubmitError, type SoloPlayerRef } from './submit.js';

/**
 * docs/08 G15 첫 접속 안내: mic check -> move -> first order within 3 minutes (docs/01 활성화, docs/09 첫 문장까지
 * 시간), carried by the first-visit errand (docs/03 D1): the neighbour Mina at the honey cafe door asks for a cold
 * water, the child orders it from Hani inside (the first order) and brings it out to her for 50 coins. The headset tip and the "volume with a
 * guardian" note are shown once (docs/12 3·4장). The server owns the errand; this screen shows the step and the way.
 */

const F = UI_STRINGS_KO.firstVisit;
/** The world's errand giver at the honey cafe door (town.ts `errand_neighbor`). */
export const ERRAND_GIVER_NPC_ID = 'errand_neighbor';
/** Asked of the world domain (walk up to an NPC and face it); optional until it lands in WorldHandle. */
type WorldWithWalk = WorldHandle & { walkToNpc?: (npcId: string) => Promise<void> };
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
    lastState.current = errand.state;
    if (hidden) return;
    world.setGoal(errandGoalKo(errand));
    if (errand.state === 'done') {
      if (prev && prev !== 'done') {
        setToast(F.rewardToast.replace('{coins}', String(errand.reward_coins || 50)));
        playSfx('coin.drop');
      }
      const id = setTimeout(() => {
        world.setGoal('');
        setToast(null);
      }, 5000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [errand, world, hidden]);

  if (!token || !errand) return null;
  if (intro && !hidden) {
    return (
      <IntroCard
        speech={props.speech}
        onDone={() => {
          markSeen();
          setIntro(false);
        }}
      />
    );
  }
  if (hidden) return null;
  // Mina waits at the honey cafe door (world errand_neighbor) and the cafe is behind her: to her to start and to hand
  // over, to the counter to order. A world without walkToNpc walks to the scene.
  const walk =
    errand.state === 'accepted'
      ? { label: `☕ ${F.walkCafe}`, scene: 'honey_cafe' as const, npcId: null }
      : errand.state === 'offered' || errand.state === 'carrying'
        ? { label: `🙋 ${F.walkMina}`, scene: 'honey_cafe' as const, npcId: ERRAND_GIVER_NPC_ID }
        : null;
  return (
    <>
      {walk && world ? (
        <button
          type="button"
          className="lcw-errand-walk"
          onClick={() => {
            unlockDialogAudio();
            playSfx('ui.click');
            const w = world as WorldWithWalk;
            if (walk.npcId && w.walkToNpc) void w.walkToNpc(walk.npcId);
            else void world.goToScene(walk.scene);
          }}
          style={{
            position: 'absolute',
            left: 12,
            bottom: 96,
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
          }}
        >
          {walk.label}
        </button>
      ) : null}
      {toast ? (
        <div
          role="status"
          className="lcw-errand-toast"
          style={{
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
          }}
        >
          🪙 {toast}
        </div>
      ) : null}
    </>
  );
}

/** The first screen: headset tip, volume with a guardian, and a short "Hello!" mic check (skippable). */
function IntroCard(props: { speech?: SpeechEngine; onDone: () => void }): React.ReactElement {
  const engine = useMemo(() => props.speech ?? createDialogSpeechEngine(), [props.speech]);
  const ok = useMemo(() => engine.availability().ok, [engine]);
  const [mic, setMic] = useState<MicView>({ recording: false, interim: '', hangover: false, level: 0 });
  const [note, setNote] = useState<string | null>(ok ? null : F.micNone);
  const [heard, setHeard] = useState<string | null>(null);
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
        } else setNote(F.micQuiet);
      },
      onIssue: (issue) => setNote(issue === 'no_speech' ? F.micQuiet : F.micNone)
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
    <div className="lcw-firstvisit" role="dialog" aria-modal="true" aria-label={F.title} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: `${C['ink-900']}40`, pointerEvents: 'auto', fontFamily: T.fonts.ui }}>
      <div style={{ width: 'min(460px, 100%)', background: C['paper-50'], color: C['ink-900'], border: `${S.borderWidthPx}px solid ${C['ink-900']}`, borderRadius: S.radiusCardPx, boxShadow: S.shadowDefault, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: T.scale.h3.sizePx, lineHeight: 1.3 }}>{F.title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span aria-hidden>🎧</span>
          <span>{F.headset}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: C['ink-700'], fontSize: T.scale.small.sizePx }}>
          <span aria-hidden>🔈</span>
          <span>{F.volume}</span>
        </div>
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
          <button type="button" style={btn(false)} onClick={props.onDone}>
            {F.skip}
          </button>
          <button type="button" className="lcw-firstvisit-go" style={btn(true)} onClick={props.onDone}>
            {F.next}
          </button>
        </div>
      </div>
    </div>
  );
}

export { errandDialogFor } from './errand.js';
