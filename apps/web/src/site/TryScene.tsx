/**
 * W06 /try (docs/14 §8, WP-702): account-free, server-free trial. One obvious action per step so a child finishes
 * without instructions: start (sound on) → walk to the cafe → hear the owner → pick a sentence → say it → the drink
 * pops into slot 1 → drink → "이 월드를 저장할까요" → hand-off to a parent.
 *
 * The stage below is the voxel SVG scene (light, works on every phone). When the world domain ships createWorld
 * (docs/19 §2) the same reducer drives the 3D scene on capable devices; this stage stays as the low-tier path.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { detectInAppBrowser } from '../inapp.js';
import { chooseTryPath, detectSpeechSupport, type SpeechSupport, type TryPath } from '../tryFlow.js';
import { InAppBrowserBanner } from '../WebUx.js';
import { SLink } from './SiteShell.js';
import { blip, isSoundOn, sayEnglish, setSoundOn, stopSpeaking } from './sound.js';
import { TRY } from './tryCopy.js';
import { TrySpeak } from './TrySpeak.js';
import {
  TRY_INITIAL,
  TRY_NPC,
  TRY_OFFERS,
  TRY_PRICES,
  TRY_WALK_STEPS,
  tryReducer,
  type TryPhase,
  type TryState
} from './tryState.js';
import { track } from './track.js';
import { Toast, useShareToParent } from './widgets.js';
import { IsoGroup, box, cafe, character, grass, honeyCup, isoPoint, merge, placeAt, projectIso, road, shift, tree, type Vox } from './voxel.js';

const U = 10;
const WALK_TICK_MS = 170;
const GREET_FALLBACK_MS = 4_500;
const DRINK_MS = 1_800;
const KID_START: [number, number] = [1, 8];

/* ---------- stage ---------- */

function usePlaza() {
  return useMemo(() => {
    const ground = merge(grass(26, 14), road(0, 8, 16, 2), road(14, 7, 2, 1));
    const back = merge(
      shift(cafe(), 12, 0, 0),
      placeAt(tree(), 3, 2),
      placeAt(character({ shirt: 'leaf', hair: 'sun-d', waveArm: false }), 7, 4)
    );
    const backWave = placeAt(character({ shirt: 'leaf', hair: 'sun-d', waveArm: true }), 7, 4);
    const front = merge(placeAt(tree(), 23, 12), box(18, 11, 0, 4, 1, 1, 'sun-d'), box(18, 11, 1, 4, 1, 1, 'sun-d'));
    const frontKid = placeAt(character({ shirt: 'grape', pants: 'ink-700' }), 10, 12);
    const frontKidWave = placeAt(character({ shirt: 'grape', pants: 'ink-700', waveArm: true }), 10, 12);
    const kid = placeAt(character({}), KID_START[0], KID_START[1]);
    const b = projectIso(merge(ground, back, front, frontKid, kid), U);
    return { ground, back, backWave, front, frontKid, frontKidWave, kid, vb: { x: b.minX - U, y: b.minY - U * 3, w: b.width + U * 2, h: b.height + U * 4 } };
  }, []);
}

function useCafeInside() {
  return useMemo(() => {
    const floor: Vox[] = [];
    for (let x = 0; x < 14; x++) for (let y = 0; y < 12; y++) floor.push({ x, y, z: -1, c: (x + y) % 2 === 0 ? 'paper-100' : 'line-200' });
    const walls = merge(box(0, 0, 0, 14, 1, 7, 'paper-0'), box(0, 0, 0, 1, 12, 7, 'paper-0'), box(0, 0, 0, 14, 1, 1, 'sun-d'), box(0, 0, 0, 1, 12, 1, 'sun-d'));
    const shelf = merge(box(4, 1, 4, 6, 1, 1, 'sun-d'), box(5, 1, 5, 1, 1, 1, 'sky'), box(7, 1, 5, 1, 1, 1, 'brand'), box(9, 1, 5, 1, 1, 1, 'leaf'));
    const sign = merge(box(0, 3, 4, 1, 4, 2, 'sun'), box(0, 4, 4, 1, 2, 1, 'brand-d'));
    const owner = placeAt(character({ shirt: 'sky-d', pants: 'ink-700', hair: 'ink-900' }), 7, 2);
    const counter = merge(box(3, 4, 0, 8, 2, 3, 'sun-d'), box(3, 4, 3, 8, 2, 1, 'paper-0'));
    const kid = placeAt(character({}), 7, 9);
    const kidCup = placeAt(character({ cup: true }), 7, 9);
    const cupOnCounter = shift(honeyCup(), 6, 4, 4);
    const b = projectIso(merge(floor, walls, owner, counter, kid, cupOnCounter), U);
    return { floor, walls, shelf, sign, owner, counter, kid, kidCup, cupOnCounter, vb: { x: b.minX - U, y: b.minY - U * 2, w: b.width + U * 2, h: b.height + U * 3 } };
  }, []);
}

function pctOf(vb: { x: number; y: number; w: number; h: number }, x: number, y: number, z: number) {
  const [sx, sy] = isoPoint(x, y, z, U);
  return { left: `${((sx - vb.x) / vb.w) * 100}%`, top: `${((sy - vb.y) / vb.h) * 100}%` };
}

function TryStage2D({ s, onCafeTap, bubble }: { s: TryState; onCafeTap: () => void; bubble: string | null }): React.ReactElement {
  const plaza = usePlaza();
  const inside = useCafeInside();
  const outside = s.phase === 'start' || s.phase === 'walk';
  if (outside) {
    const { vb } = plaza;
    const dx = s.step * U;
    const dy = (s.step * U) / 2;
    return (
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={TRY.stageLabel} shapeRendering="crispEdges">
        <IsoGroup voxels={plaza.ground} unit={U} />
        <g onClick={onCafeTap} style={{ cursor: s.phase === 'walk' ? 'pointer' : 'default' }}>
          <IsoGroup voxels={plaza.back} unit={U} />
        </g>
        <IsoGroup voxels={plaza.backWave} unit={U} className="s-wave-b" />
        <g style={{ transform: `translate(${dx}px, ${dy}px)`, transition: `transform ${WALK_TICK_MS}ms linear` }}>
          <IsoGroup voxels={plaza.kid} unit={U} className={s.phase === 'walk' && s.step > 0 ? 's-bob' : undefined} />
        </g>
        <IsoGroup voxels={plaza.frontKid} unit={U} className="s-wave-a" />
        <IsoGroup voxels={plaza.frontKidWave} unit={U} className="s-wave-b" />
        <IsoGroup voxels={plaza.front} unit={U} />
      </svg>
    );
  }
  const { vb } = inside;
  const holding = s.phase === 'drink';
  return (
    <>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={TRY.stageLabel} shapeRendering="crispEdges">
        <IsoGroup voxels={inside.floor} unit={U} />
        <IsoGroup voxels={inside.walls} unit={U} />
        <IsoGroup voxels={inside.shelf} unit={U} />
        <IsoGroup voxels={inside.sign} unit={U} />
        <IsoGroup voxels={inside.owner} unit={U} />
        <IsoGroup voxels={inside.counter} unit={U} />
        {s.phase === 'receive' ? <IsoGroup voxels={inside.cupOnCounter} unit={U} className="s-popin" /> : null}
        <IsoGroup voxels={holding ? inside.kidCup : inside.kid} unit={U} className={s.phase === 'end' || s.phase === 'drink' ? 's-bob' : undefined} />
      </svg>
      {bubble ? (
        <div className="s-bubble" lang="en" style={{ ...pctOf(vb, 8, 1, 16), transform: 'translate(-50%, -100%)', maxWidth: '70%', fontSize: 15, lineHeight: '20px' }} key={bubble}>
          {bubble}
        </div>
      ) : null}
      {s.stars > 0 && (s.phase === 'receive' || s.phase === 'drink') ? (
        <span className="s-starburst" style={pctOf(vb, 8, 9, 15)} aria-hidden="true" key={s.phase}>
          {'★'.repeat(s.stars)}
        </span>
      ) : null}
    </>
  );
}

function CupIcon(): React.ReactElement {
  const v = useMemo(() => honeyCup(), []);
  const b = projectIso(v, 6);
  return (
    <svg viewBox={`${b.minX - 2} ${b.minY - 2} ${b.width + 4} ${b.height + 4}`} aria-hidden="true">
      <IsoGroup voxels={v} unit={6} />
    </svg>
  );
}

function Hud({ s, onDrink }: { s: TryState; onDrink: () => void }): React.ReactElement {
  const thirst = s.drank ? 95 : 35;
  const warm = s.drank ? 90 : 40;
  return (
    <>
      <div className="s-gauges" aria-label="상태">
        <span className="s-gauge">
          {TRY.thirst}
          <i>
            <b style={{ width: `${thirst}%` }} />
          </i>
        </span>
        <span className="s-gauge">
          {TRY.warm}
          <i data-k="warm">
            <b style={{ width: `${warm}%` }} />
          </i>
        </span>
      </div>
      <div className="s-coins" aria-label={TRY.coins(s.coins)}>
        ◆ {s.coins}
      </div>
      <div className="s-hud" role="group" aria-label="소지품 칸">
        {[1, 2, 3, 4, 5].map((n) => {
          const cup = n === 1 && s.cup;
          const cookie = n === 2 && s.cookie;
          return (
            <button
              key={n}
              type="button"
              className={`s-slot ${cup || cookie ? 's-popin' : ''}`}
              data-ready={cup && s.phase === 'receive' ? '1' : '0'}
              disabled={!(cup && s.phase === 'receive')}
              onClick={onDrink}
              aria-label={cup ? `${n}번 칸: ${TRY.slotCup}` : cookie ? `${n}번 칸: ${TRY.slotCookie}` : `${n}번 칸: 비어 있음`}
            >
              <small>{n}</small>
              {cup ? <CupIcon /> : cookie ? <span aria-hidden="true">◍</span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------- panel ---------- */

function detectPath(): { path: TryPath; ua: string } {
  if (typeof window === 'undefined') return { path: 'recognition', ua: '' };
  const ua = navigator.userAgent;
  const det = detectInAppBrowser(ua);
  const raw = detectSpeechSupport(window as unknown as Parameters<typeof detectSpeechSupport>[0]);
  const eff: SpeechSupport = det.kind && det.isIOS ? { ...raw, recognition: false } : raw;
  return { path: chooseTryPath(eff), ua };
}

export interface TrySceneProps {
  /** For tests and screenshots: start at a given phase. */
  initial?: Partial<TryState>;
  /** Overrides the detected speech path (tests). */
  pathOverride?: TryPath;
}

export function TryScene({ initial, pathOverride }: TrySceneProps): React.ReactElement {
  const [s, dispatch] = useReducer(tryReducer, { ...TRY_INITIAL, ...initial });
  const [{ path, ua }, setEnv] = useState<{ path: TryPath; ua: string }>({ path: pathOverride ?? 'recognition', ua: '' });
  const [bubble, setBubble] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const { share, toast, clear } = useShareToParent();
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const d = detectPath();
    setEnv({ path: pathOverride ?? d.path, ua: d.ua });
  }, [pathOverride]);
  useEffect(() => () => {
    if (recording) URL.revokeObjectURL(recording);
  }, [recording]);
  useEffect(() => () => stopSpeaking(), []);

  const stopWalk = useCallback(() => {
    if (walkTimer.current) clearInterval(walkTimer.current);
    walkTimer.current = null;
  }, []);
  const startWalk = useCallback(() => {
    if (walkTimer.current) return;
    walkTimer.current = setInterval(() => {
      blip('step');
      dispatch({ type: 'walk' });
    }, WALK_TICK_MS);
  }, []);
  useEffect(() => {
    if (s.phase !== 'walk') stopWalk();
  }, [s.phase, stopWalk]);
  useEffect(() => stopWalk, [stopWalk]);

  // keyboard: → / D walks, 1 drinks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.phase === 'walk' && (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        blip('step');
        dispatch({ type: 'walk' });
      }
      if (s.phase === 'receive' && e.key === '1') {
        e.preventDefault();
        dispatch({ type: 'drink' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.phase]);

  // phase side effects
  useEffect(() => {
    if (s.phase === 'greet') {
      setBubble(TRY_NPC.welcome);
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        dispatch({ type: 'greeted' });
      };
      const fallback = setTimeout(go, GREET_FALLBACK_MS);
      sayEnglish(TRY_NPC.welcome, { onEnd: () => setTimeout(go, 400) });
      return () => clearTimeout(fallback);
    }
    if (s.phase === 'receive') {
      const line = TRY_NPC.serve(s.stars);
      setBubble(line);
      blip('pop');
      sayEnglish(line, {
        onEnd: () => {
          if (recording && audioRef.current && isSoundOn()) void audioRef.current.play().catch(() => undefined);
        }
      });
    }
    if (s.phase === 'drink') {
      setBubble(null);
      blip('gulp');
      const id = setTimeout(() => dispatch({ type: 'drank' }), DRINK_MS);
      return () => clearTimeout(id);
    }
    if (s.phase === 'choose') setBubble(TRY_NPC.welcome);
    if (s.phase === 'speak') setBubble(null);
    return undefined;
  }, [s.phase, s.stars, recording]);

  const start = (withSound: boolean) => {
    setSoundOn(withSound);
    setSound(withSound);
    track('try_start');
    dispatch({ type: 'start', sound: withSound });
  };
  const toggleSound = () => {
    const v = !sound;
    setSoundOn(v);
    setSound(v);
    if (!v) stopSpeaking();
  };
  const detection = useMemo(() => detectInAppBrowser(ua), [ua]);

  return (
    <div className="s-try" data-testid="try-scene" data-phase={s.phase}>
      <div className="s-try-top">
        <SLink to="/" className="s-btn s-btn-ghost" aria-label="LCW 처음으로">
          {TRY.back}
        </SLink>
        <span className="s-try-goal" aria-live="polite">
          {TRY.goals[s.phase]}
        </span>
        {s.phase !== 'start' ? (
          <button type="button" className="s-btn s-btn-icon" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? TRY.soundOn : TRY.soundOff}>
            {sound ? '♪' : '×'}
          </button>
        ) : null}
      </div>
      {detection.kind && typeof window !== 'undefined' ? (
        <div className="s-inapp">
          <InAppBrowserBanner detection={detection} pageUrl={window.location.href} />
        </div>
      ) : null}
      <main id="main" className="s-try-body">
        <div className="s-try-stage">
          <TryStage2D s={s} bubble={bubble} onCafeTap={() => s.phase === 'walk' && startWalk()} />
          {s.phase !== 'start' ? <Hud s={s} onDrink={() => dispatch({ type: 'drink' })} /> : null}
          {s.phase === 'save' ? (
            <div className="s-overlay">
              <div className="s-card s-modal s-stack s-risein" role="dialog" aria-modal="true" aria-labelledby="save-title">
                <h2 id="save-title" className="s-h3">
                  {TRY.saveTitle}
                </h2>
                <p className="s-muted">{TRY.saveBody}</p>
                <div className="s-row">
                  <button
                    type="button"
                    className="s-btn s-btn-brand s-btn-lg"
                    autoFocus
                    onClick={() => {
                      track('save_yes');
                      dispatch({ type: 'save', yes: true });
                    }}
                  >
                    {TRY.saveYes}
                  </button>
                  <button
                    type="button"
                    className="s-btn s-btn-lg"
                    onClick={() => {
                      track('save_no');
                      dispatch({ type: 'save', yes: false });
                    }}
                  >
                    {TRY.saveNo}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <section className="s-try-panel" aria-label="체험 진행">
          <Panel
            s={s}
            path={path}
            sound={sound}
            recording={recording}
            onStart={start}
            onStep={() => {
              blip('step');
              dispatch({ type: 'walk' });
            }}
            onHold={startWalk}
            onRelease={stopWalk}
            onAuto={startWalk}
            onGreeted={() => dispatch({ type: 'greeted' })}
            onPick={(n) => {
              blip('tap');
              dispatch({ type: 'pick', stars: n });
            }}
            onRepick={() => dispatch({ type: 'repick' })}
            onSpoke={(stars, text, rec) => {
              track('order_done');
              if (rec) setRecording(rec);
              dispatch({ type: 'spoke', stars, text });
            }}
            onDrink={() => dispatch({ type: 'drink' })}
            onShare={share}
            onRestart={() => dispatch({ type: 'restart' })}
          />
          {recording ? <audio ref={audioRef} src={recording} preload="auto" hidden /> : null}
        </section>
      </main>
      <Toast text={toast} onDone={clear} />
    </div>
  );
}

interface PanelProps {
  s: TryState;
  path: TryPath;
  sound: boolean;
  recording: string | null;
  onStart: (sound: boolean) => void;
  onStep: () => void;
  onHold: () => void;
  onRelease: () => void;
  onAuto: () => void;
  onGreeted: () => void;
  onPick: (n: 1 | 2 | 3) => void;
  onRepick: () => void;
  onSpoke: (stars: 1 | 2 | 3, text: string, rec: string | null) => void;
  onDrink: () => void;
  onShare: () => void;
  onRestart: () => void;
}

function Panel(p: PanelProps): React.ReactElement {
  const { s } = p;
  const phase: TryPhase = s.phase;
  if (phase === 'start')
    return (
      <div className="s-stack s-risein" style={{ gap: 16 }}>
        <h1 className="s-h2">{TRY.startTitle}</h1>
        <p className="s-lead">{TRY.startBody}</p>
        <button type="button" className="s-btn s-btn-brand s-btn-mic" onClick={() => p.onStart(true)} autoFocus>
          ▶ {TRY.startBtn}
        </button>
        <button type="button" className="s-btn s-btn-ghost" onClick={() => p.onStart(false)} style={{ justifySelf: 'start' }}>
          {TRY.startQuiet}
        </button>
        <p className="s-note">{TRY.localOnly}</p>
      </div>
    );
  if (phase === 'walk')
    return (
      <div className="s-stack" style={{ gap: 16 }}>
        <p className="s-lead">{TRY.walkHint}</p>
        <div className="s-row" style={{ gap: 16 }}>
          <button
            type="button"
            className="s-btn s-btn-sun s-arrow-btn"
            aria-label={TRY.walkBtn}
            onClick={p.onStep}
            onPointerDown={p.onHold}
            onPointerUp={p.onRelease}
            onPointerLeave={p.onRelease}
            onPointerCancel={p.onRelease}
            autoFocus
          >
            →
          </button>
          <button type="button" className="s-btn" onClick={p.onAuto}>
            {TRY.autoWalk}
          </button>
        </div>
        <div aria-label={`카페까지 ${TRY_WALK_STEPS - s.step}걸음`} style={{ height: 12, border: '2px solid currentColor' }}>
          <div className="s-btn-leaf" style={{ height: '100%', width: `${(s.step / TRY_WALK_STEPS) * 100}%`, transition: 'width 160ms linear' }} />
        </div>
        <p className="s-small">{TRY.walkKeys}</p>
      </div>
    );
  if (phase === 'greet')
    return (
      <div className="s-stack" style={{ gap: 12 }}>
        <div className="s-npcline s-risein">
          <span className="s-who">{TRY.npc}</span>
          <span className="s-en-sm" lang="en" style={{ fontSize: 20, lineHeight: '28px' }}>
            {TRY_NPC.welcome}
          </span>
          <span className="s-small">{TRY.welcomeKo}</span>
        </div>
        <button type="button" className="s-btn s-btn-brand s-btn-lg" onClick={p.onGreeted} style={{ justifySelf: 'start' }}>
          {TRY.next} →
        </button>
      </div>
    );
  if (phase === 'choose')
    return (
      <div className="s-stack" style={{ gap: 12 }}>
        <div className="s-npcline">
          <span className="s-who">{TRY.npc}</span>
          <span className="s-small">{TRY.welcomeKo}</span>
        </div>
        <h2 className="s-h3">{TRY.chooseTitle}</h2>
        <p className="s-small">{TRY.chooseHint}</p>
        <div className="s-pickgrid">
          {[...TRY_OFFERS].reverse().map((o) => (
            <button key={o.stars} type="button" className="s-pick" data-stars={o.stars} onClick={() => p.onPick(o.stars)} autoFocus={o.stars === 3}>
              <span className="s-stars" aria-label={`별 ${o.stars}개`}>
                {'★'.repeat(o.stars)}
              </span>
              <span className="s-en-sm" lang="en" style={{ fontSize: 18, lineHeight: '24px' }}>
                {o.text}
              </span>
              <span className="s-coin">
                {o.stars === 3 ? <span className="s-tag s-tag-sample" style={{ marginRight: 6 }}>{TRY.challenge}</span> : null}◆ {TRY_PRICES[o.stars]}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  if (phase === 'speak') return <TrySpeak offers={TRY_OFFERS} aim={s.aim} path={p.path} onDone={p.onSpoke} onRepick={p.onRepick} />;
  if (phase === 'receive')
    return (
      <div className="s-stack" style={{ gap: 12 }}>
        <div className="s-npcline s-risein">
          <span className="s-who">{TRY.npc}</span>
          <span className="s-en-sm" lang="en" style={{ fontSize: 20, lineHeight: '28px' }}>
            {TRY_NPC.serve(s.stars)}
          </span>
          <span className="s-small">{TRY.serveKo(s.stars)}</span>
        </div>
        <button type="button" className="s-btn s-btn-brand s-btn-mic" onClick={p.onDrink} autoFocus>
          {TRY.drinkBtn}
        </button>
        <p className="s-small">{TRY.drinkHint}</p>
      </div>
    );
  if (phase === 'drink' || phase === 'save')
    return (
      <div className="s-stack">
        <p className="s-h2" aria-live="polite">
          {TRY.goals.drink}
        </p>
      </div>
    );
  return (
    <div className="s-end s-risein" data-testid="try-end">
      <h2 className="s-h2">
        {'★'.repeat(s.stars)} {TRY.endTitle}
      </h2>
      <div className="s-card-flat s-stack" style={{ gap: 4 }}>
        <span className="s-small">{TRY.endSaid}</span>
        <span className="s-en" lang="en">
          “{s.said}”
        </span>
        {p.recording ? (
          <span className="s-stack" style={{ gap: 4 }}>
            <span className="s-small">{TRY.myVoice}</span>
            <audio controls src={p.recording} />
          </span>
        ) : null}
      </div>
      <p className="s-muted">{s.saved ? TRY.endSavedYes : TRY.endSavedNo}</p>
      <button type="button" className="s-btn s-btn-brand s-btn-mic" onClick={p.onShare}>
        {TRY.sendParent}
      </button>
      <button type="button" className="s-btn" onClick={p.onRestart} style={{ justifySelf: 'start' }}>
        {s.stars < 3 ? TRY.again3 : TRY.againAny}
      </button>
      <div className="s-row" style={{ gap: 8, marginTop: 8 }}>
        <SLink to="/parents" className="s-btn s-btn-ghost">
          {TRY.forParents}
        </SLink>
        <SLink to="/pricing" className="s-btn s-btn-ghost">
          {TRY.forAdults}
        </SLink>
        <SLink to="/tutoring#consult" className="s-btn s-btn-ghost">
          {TRY.forTutoring}
        </SLink>
      </div>
    </div>
  );
}
