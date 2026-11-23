/**
 * Start flow (docs/08 §8.4 G07 → §8.6 G15, Dan 11-16 R2555): title screen over the living town → (first time) make
 * my world: a name and a few fun details, the rest random from a seed → the 3x3 world revealed card by card → the
 * world, where the first-visit guide (G15) takes over. A returning child goes straight into their world.
 *
 * Dan 11-16 14:3x: a guest makes no world. The title offers a guest only "Sign up" (/signup), "I have an account ·
 * Sign in" (/signup?mode=signin) and "Try it for 3 minutes" (/try). A signed-in child picks the language to learn once
 * (English now; the others are listed as coming soon), kept on the device and with the child on the server, and the
 * screen speaks that language from then on with an optional Korean help line (world/lang.ts).
 *
 * A signed-in student whose teacher has started the lesson joins it without pressing anything, from any stage here
 * and later in the world (`LessonAutoJoin`). `/world/?code=` (and the old /game/ address) never reaches this screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LEARN_LANGS, WORLD_BUDDIES, WORLD_NAME_MAX, WORLD_SEASONS, WORLD_TIMES, cleanWorldName, randomWorldChoice, readLearnLang, type LearnLang, type WorldSetup, type WorldSetupChoice, type WorldSetupOption } from '@lcw/content';
import { generateWorldLayout } from '@lcw/sim-core';
import { COLOR_TOKENS as C, MOTION_TOKENS as M, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { WorldHandle } from '../world/api.js';
import { browserStore, type PlayerIdentity } from '../world/identity.js';
import { BIOME_NAMES, START_STRINGS as X } from './strings.js';
import { chosenLearnLang, helpKoOn, onLearnLang, setHelpKo, setLearnLang, type Bi } from '../world/lang.js';
import { loadStudentSession } from '../lesson/api.js';
import {
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  TRY_PATH,
  cleanLessonCode,
  joinDeviceLesson,
  lessonLive,
  liveLessonId,
  loadMyWorld,
  makeMyWorld,
  saveLearnLang,
  titleActions,
  type DeviceLessonSession,
  type FetchLike,
  type KeyStore,
  type MyWorldState
} from './api.js';

const LIVE_POLL_MS = 5000;
const STYLE_ID = 'lcw-start-style';

export interface StartFlowProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
  /** The child is in their world (the first-visit guide may start now). */
  onPlay: (world: WorldSetup | null) => void;
  /** '수업 들어가기' gave this device's student session: the shell starts the lesson layer with it. */
  onLessonSession: (s: DeviceLessonSession) => void;
  fetchFn?: FetchLike;
  store?: KeyStore | null;
}

type Stage = 'title' | 'lang' | 'make' | 'reveal';

/** Re-render when the learn language or the Korean help changes (here, another lane's toggle, another tab). */
export function useHelpKo(): boolean {
  const [on, setOn] = useState(helpKoOn);
  useEffect(() => onLearnLang((v) => setOn(v.helpKo)), []);
  return on;
}

/** A screen line: the language the child learns, and the Korean help line under it when that is on. */
export function Say(p: { line: Bi; help?: boolean }): React.ReactElement {
  const on = p.help ?? helpKoOn();
  return (
    <>
      {p.line.en}
      {on && p.line.ko && p.line.ko !== p.line.en ? (
        <small className="lcw-ko" lang="ko">
          {p.line.ko}
        </small>
      ) : null}
    </>
  );
}

/** The Korean help switch (a quiet link; parents and younger children find it on the title). */
function HelpKoToggle(p: { on: boolean }): React.ReactElement {
  return (
    <button type="button" className="lcw-start__link" lang="ko" data-testid="start-help-ko" aria-pressed={p.on} onClick={() => {
        setHelpKo(!p.on);
        // HUD buttons and other lanes' labels are set once when the world is built: reload so all follow at once
        if (typeof location !== 'undefined') location.reload();
      }}>
      {p.on ? X.helpKoOff : X.helpKoOn}
    </button>
  );
}

export function injectStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.lcw-start{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 16px;box-sizing:border-box;font-family:${T.fonts.ui};color:${C['ink-900']};overflow:auto}
.lcw-start__shade{position:absolute;inset:0;background:linear-gradient(180deg,${C['night-900']}26 0%,${C['night-900']}00 40%,${C['night-900']}8C 100%);pointer-events:none}
.lcw-start__logo{position:relative;margin-top:6vh;text-align:center;animation:lcw-start-pop ${M.slowMs * 2}ms ease-out both}
.lcw-start__brand{font-family:${T.fonts.pixel};font-size:${T.scale.display.sizePx * 1.6}px;line-height:1;color:${C.sun};letter-spacing:4px;text-shadow:4px 4px 0 ${C['ink-900']},-2px -2px 0 ${C['ink-900']},2px -2px 0 ${C['ink-900']},-2px 2px 0 ${C['ink-900']}}
.lcw-start__tag{display:inline-block;margin-top:12px;padding:6px 14px;background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};font-weight:800;font-size:${T.scale['body-l'].sizePx}px}
.lcw-start__panel{position:relative;width:min(440px,100%);display:flex;flex-direction:column;gap:12px;margin-bottom:4vh}
.lcw-start__hello{text-align:center;font-weight:800;font-size:${T.scale.h3.sizePx}px;color:${C['paper-0']};text-shadow:2px 2px 0 ${C['ink-900']}}
.lcw-btn{min-height:${S.gameButtonMinPx}px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};background:${C['paper-50']};color:${C['ink-900']};font-family:${T.fonts.ui};font-weight:800;font-size:${T.scale['body-l'].sizePx}px;padding:0 16px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;box-sizing:border-box}
.lcw-btn:active{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
.lcw-btn:focus-visible{outline:${S.focusOutlineWidthPx}px solid ${C.sky};outline-offset:2px}
.lcw-btn--main{background:${C.brand};color:${C['paper-0']};font-size:${T.scale.h3.sizePx}px;min-height:${S.gameButtonMinPx + 8}px}
.lcw-btn--lesson{background:${C.leaf};color:${C['paper-0']};flex-direction:column;gap:2px;min-height:${S.gameButtonMinPx + 20}px}
.lcw-btn--lesson small{font-size:${T.scale.small.sizePx}px;font-weight:700;opacity:.95}
.lcw-btn--quiet{background:${C['paper-0']}}
.lcw-btn[disabled]{opacity:.6;cursor:default}
.lcw-start__fold{background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:12px;display:flex;flex-direction:column;gap:8px}
.lcw-start__fold input{height:48px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;font-size:${T.scale.h3.sizePx}px;letter-spacing:6px;text-align:center;font-family:${T.fonts.target};min-width:0}
.lcw-start__hint{font-size:${T.scale.small.sizePx}px;color:${C['ink-700']}}
.lcw-start__link{background:none;border:0;color:${C['paper-0']};text-decoration:underline;font-weight:700;font-size:${T.scale.small.sizePx}px;cursor:pointer;padding:6px;text-shadow:1px 1px 0 ${C['ink-900']}}
.lcw-card{background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault}}
.lcw-make{position:relative;width:min(720px,100%);margin:auto 0;padding:20px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.lcw-make h1{margin:0;font-size:${T.scale.h2.sizePx}px;line-height:${T.scale.h2.lineHeightPx}px}
.lcw-make p{margin:0}
.lcw-make__name{height:52px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;font-size:${T.scale.h3.sizePx}px;padding:0 12px;font-family:${T.fonts.ui};width:100%;box-sizing:border-box}
.lcw-make__row{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px}
.lcw-make__label{font-weight:800;font-size:${T.scale.body.sizePx}px;margin-bottom:6px}
.lcw-opt{min-height:88px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-family:${T.fonts.ui};color:${C['ink-900']};padding:6px 4px}
.lcw-opt b{font-size:${T.scale['body-l'].sizePx}px}
.lcw-opt span{font-size:${T.scale.micro.sizePx}px;color:${C['ink-700']};text-align:center}
.lcw-opt i{font-style:normal;font-size:28px;line-height:32px}
.lcw-opt[aria-pressed="true"]{background:${C.sun};box-shadow:${S.shadowDefault};transform:translate(-2px,-2px)}
.lcw-make__foot{display:flex;gap:10px;flex-wrap:wrap}
.lcw-make__foot .lcw-btn{flex:1 1 160px}
.lcw-reveal{position:relative;width:min(560px,100%);margin:auto 0;padding:20px;display:flex;flex-direction:column;gap:14px;align-items:stretch;box-sizing:border-box;text-align:center}
.lcw-reveal h1{margin:0;font-size:${T.scale.h2.sizePx}px}
.lcw-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;perspective:800px}
.lcw-flip{position:relative;aspect-ratio:1/1;transform-style:preserve-3d;transition:transform ${M.slowMs * 2}ms ease-in-out}
.lcw-flip.on{transform:rotateY(180deg)}
.lcw-flip>div{position:absolute;inset:0;backface-visibility:hidden;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:4px;box-sizing:border-box}
.lcw-flip__back{background:${C['night-700']};color:${C.sun};font-family:${T.fonts.pixel};font-size:28px}
.lcw-flip__face{background:${C['paper-0']};transform:rotateY(180deg);font-weight:800;font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px}
.lcw-flip__face i{font-style:normal;font-size:30px;line-height:34px}
.lcw-flip--home .lcw-flip__face{background:${C.sun}}
.lcw-reveal__chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;font-weight:700}
.lcw-reveal__chips span{background:${C['paper-0']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;padding:4px 10px}
.lcw-invite{position:absolute;left:0;right:0;margin:0 auto;top:16px;box-sizing:border-box;width:min(420px,calc(100% - 32px));padding:14px;display:flex;flex-direction:column;gap:10px;z-index:30;animation:lcw-start-pop ${M.slowMs}ms ease-out both}
.lcw-invite b{font-size:${T.scale.h3.sizePx}px}
.lcw-pass-chip{position:absolute;left:50%;top:64px;transform:translateX(-50%);z-index:30;padding:6px 14px;background:${C["paper-50"]};border:${S.borderWidthPx}px solid ${C["ink-900"]};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};font-family:${T.fonts.ui};font-weight:800;font-size:${T.scale.body.sizePx}px;color:${C["ink-900"]};white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}
.lcw-invite__row{display:flex;gap:8px}
.lcw-ko{display:block;font-size:${T.scale.small.sizePx}px;font-weight:700;opacity:.85;line-height:1.3}
.lcw-btn .lcw-ko{font-size:${T.scale.micro.sizePx}px}
.lcw-btn{flex-direction:column}
.lcw-lang{position:relative;width:min(560px,100%);margin:auto 0;padding:20px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.lcw-lang h1{margin:0;font-size:${T.scale.h2.sizePx}px;line-height:${T.scale.h2.lineHeightPx}px}
.lcw-lang p{margin:0}
.lcw-lang__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.lcw-lang__card{min-height:96px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-family:${T.fonts.ui};color:${C['ink-900']};padding:8px}
.lcw-lang__card b{font-size:${T.scale.h3.sizePx}px}
.lcw-lang__card i{font-style:normal;font-weight:800;font-size:26px;line-height:32px;font-family:${T.fonts.target}}
.lcw-lang__card span{font-size:${T.scale.small.sizePx}px;color:${C['ink-700']}}
.lcw-lang__card[aria-pressed="true"]{background:${C.sun};box-shadow:${S.shadowDefault};transform:translate(-2px,-2px)}
.lcw-lang__card[disabled]{opacity:.55;cursor:default}
.lcw-lang .lcw-start__link{color:${C["ink-900"]};text-shadow:none}
.lcw-invite__row .lcw-btn{flex:1}
@keyframes lcw-start-pop{from{opacity:0;transform:translateY(-12px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.lcw-flip{transition:none}.lcw-start__logo,.lcw-invite{animation:none}}
`;
  document.head.appendChild(st);
}

function defaultName(id: PlayerIdentity | null): string {
  const nick = id?.kind === 'child' ? id.nickname.trim() : '';
  if (!nick) return '';
  return cleanWorldName(X.make.nameDefault(nick)) ?? cleanWorldName(nick) ?? '';
}

/**
 * The learn language between this device and the server, once my world is known: the server's choice wins on a new
 * device; a device choice the server lacks (saved offline) goes up quietly; neither means the child has not chosen.
 */
export function syncLearnLang(server: LearnLang | null | undefined, device: LearnLang | null): { set: LearnLang | null; push: LearnLang | null; ask: boolean } {
  const s = readLearnLang(server);
  if (s) return { set: s === device ? null : s, push: null, ask: false };
  if (device) return { set: null, push: server === null ? device : null, ask: false };
  return { set: null, push: null, ask: server === null };
}

export function StartFlow(props: StartFlowProps): React.ReactElement | null {
  const { world, identity, onPlay, onLessonSession } = props;
  const fetchFn = useMemo<FetchLike>(() => props.fetchFn ?? ((i, init) => globalThis.fetch(i, init)), [props.fetchFn]);
  const store = props.store === undefined ? browserStore() : props.store;
  const [stage, setStage] = useState<Stage>('title');
  const [mine, setMine] = useState<MyWorldState | null>(null);
  const [live, setLive] = useState(false);
  const [joining, setJoining] = useState(false);
  const [made, setMade] = useState<WorldSetup | null>(null);
  const done = useRef(false);
  const helpKo = useHelpKo();

  useEffect(() => injectStyle(), []);
  useEffect(() => {
    world?.setAttract?.(true);
  }, [world]);

  useEffect(() => {
    let alive = true;
    if (!identity) return;
    void loadMyWorld(identity, store, fetchFn).then((m) => {
      if (!alive) return;
      setMine(m);
      if (identity.kind !== 'child' || m.made === 'unknown') return;
      const sync = syncLearnLang(m.learnLang, chosenLearnLang());
      if (sync.set) setLearnLang(sync.set);
      if (sync.push) void saveLearnLang(identity, sync.push, fetchFn);
      // signed up, not chosen yet: the language comes before anything else (Dan 11-16 14:3x)
      if (sync.ask) setStage((st) => (st === 'title' ? 'lang' : st));
    });
    return () => {
      alive = false;
    };
  }, [identity, store, fetchFn]);

  // The teacher's lesson for a signed-in student: asked now and every few seconds while the title is open.
  useEffect(() => {
    if (identity?.kind !== 'child') return;
    let alive = true;
    const ask = () => void lessonLive(identity, fetchFn).then((l) => alive && setLive(l));
    ask();
    const t = setInterval(ask, LIVE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [identity, fetchFn]);

  const play = useCallback(
    (w: WorldSetup | null) => {
      if (done.current) return;
      done.current = true;
      world?.setAttract?.(false);
      onPlay(w);
    },
    [world, onPlay]
  );

  const enterLesson = useCallback(async (): Promise<boolean> => {
    setJoining(true);
    const s = await joinDeviceLesson(identity, fetchFn);
    setJoining(false);
    if (!s) {
      setLive(false);
      return false;
    }
    if (done.current) return true;
    done.current = true;
    world?.setAttract?.(false);
    onLessonSession(s);
    return true;
  }, [identity, fetchFn, world, onLessonSession]);

  // The student presses nothing (Dan 11-16 12:10): a live lesson takes the child into it from the title at once. A
  // failed join tries again on the next poll that finds the lesson live.
  const autoTried = useRef(false);
  useEffect(() => {
    if (!live || identity?.kind !== 'child' || autoTried.current || done.current) return;
    autoTried.current = true;
    void enterLesson().then((ok) => {
      if (!ok) autoTried.current = false;
    });
  }, [live, identity, enterLesson]);

  if (stage === 'lang') {
    return (
      <div className="lcw-start" data-testid="start-lang">
        <div className="lcw-start__shade" />
        <LangPick
          help={helpKo}
          onPick={async (lang) => {
            setLearnLang(lang);
            // kept on the device at once; the server copy is retried on the next visit if this one fails
            void saveLearnLang(identity, lang, fetchFn);
            setMine((m) => (m ? { ...m, learnLang: lang } : m));
            setStage(mine?.made === false ? 'make' : 'title');
          }}
        />
      </div>
    );
  }
  if (stage === 'make') {
    return (
      <div className="lcw-start" data-testid="start-make">
        <div className="lcw-start__shade" />
        <MakeWorld
          help={helpKo}
          initialName={defaultName(identity)}
          onMake={async (choice) => {
            const w = await makeMyWorld(identity, choice, store, fetchFn);
            if (!w) return false;
            setMade(w);
            setStage('reveal');
            return true;
          }}
        />
      </div>
    );
  }
  if (stage === 'reveal' && made) {
    return (
      <div className="lcw-start" data-testid="start-reveal">
        <div className="lcw-start__shade" />
        <Reveal world={made} help={helpKo} onEnter={() => play(made)} />
      </div>
    );
  }

  const actions = titleActions(identity, mine, live);
  const nick = identity?.kind === 'child' ? identity.nickname : '';
  const myName = mine?.made === true ? mine.world.name : '';
  return (
    <div className="lcw-start" data-testid="start-title">
      <div className="lcw-start__shade" />
      <div className="lcw-start__logo">
        <div className="lcw-start__brand">{X.brand}</div>
        <div className="lcw-start__tag">
          <Say line={X.tagline} help={helpKo} />
        </div>
      </div>
      <div className="lcw-start__panel">
        <div className="lcw-start__hello">
          <Say line={nick ? X.hello(nick) : X.helloGuest} help={helpKo} />
        </div>
        {actions.includes('wait') ? (
          <button type="button" className="lcw-btn lcw-btn--main" disabled data-testid="start-wait">
            <Say line={X.loading} help={helpKo} />
          </button>
        ) : null}
        {actions.includes('signup') ? (
          <>
            <a className="lcw-btn lcw-btn--main" href={SIGN_UP_PATH} data-testid="start-signup" title={X.signUpHint.en}>
              <Say line={X.signUp} help={helpKo} />
            </a>
            <a className="lcw-btn lcw-btn--quiet" href={SIGN_IN_PATH} data-testid="start-signin">
              <Say line={X.signIn} help={helpKo} />
            </a>
            <a className="lcw-btn lcw-btn--quiet" href={TRY_PATH} data-testid="start-try">
              <Say line={X.tryIt} help={helpKo} />
            </a>
          </>
        ) : null}
        {actions.includes('lesson') ? (
          <div className="lcw-btn lcw-btn--lesson" role="status" aria-live="polite" data-testid="start-lesson">
            <small>
              <Say line={X.lessonLive} help={helpKo} />
            </small>
            <Say line={joining ? X.lessonJoining : X.lessonEnter} help={helpKo} />
          </div>
        ) : null}
        {actions.includes('continue') ? (
          <button
            type="button"
            className={`lcw-btn ${actions.includes('lesson') ? 'lcw-btn--quiet' : 'lcw-btn--main'}`}
            data-testid="start-continue"
            onClick={() => play(mine?.made === true ? mine.world : null)}
          >
            <Say line={myName ? X.continueWorld(myName) : X.start} help={helpKo} />
          </button>
        ) : null}
        {actions.includes('make') ? (
          <button
            type="button"
            className={`lcw-btn ${actions.includes('lesson') ? 'lcw-btn--quiet' : 'lcw-btn--main'}`}
            data-testid="start-make-open"
            onClick={() => setStage('make')}
          >
            <Say line={X.makeWorld} help={helpKo} />
          </button>
        ) : null}
        <FriendWorld help={helpKo} />
        {/* R329: one line back to the introduction, so the world's first screen is never a dead end. */}
        <a className="lcw-start__link" href="/about" data-testid="start-intro">
          <Say line={X.intro} help={helpKo} />
        </a>
        <HelpKoToggle on={helpKo} />
      </div>
    </div>
  );
}

/**
 * '친구 월드 가기': a 6-digit code is a world invitation (a friend's world, a guest pass; Dan 11-16 12:10), folded
 * under one link. Lessons never need it (the teacher comes into the child's world). Until world invitations have
 * their own address the code goes to /world/?code=, which the server answers today.
 */
function FriendWorld(p: { help: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const ok = cleanLessonCode(code);
  if (!open) {
    return (
      <button type="button" className="lcw-start__link" data-testid="start-friend" onClick={() => setOpen(true)}>
        <Say line={X.friendWorld} help={p.help} />
      </button>
    );
  }
  return (
    <form
      className="lcw-start__fold"
      data-testid="start-code-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) location.assign(`/world/?code=${ok}`);
      }}
    >
      <label className="lcw-make__label" htmlFor="lcw-start-code">
        <Say line={X.codeLabel} help={p.help} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="lcw-start-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ flex: 1 }}
        />
        <button type="submit" className="lcw-btn lcw-btn--main" disabled={!ok}>
          <Say line={X.codeGo} help={false} />
        </button>
      </div>
      <div className="lcw-start__hint">
        <Say line={X.codeHint} help={p.help} />
      </div>
      <a className="lcw-start__hint" href="/link" style={{ fontWeight: 700 }}>
        <Say line={X.linkDevice} help={p.help} />
      </a>
    </form>
  );
}

/** "What language do you want to learn?": English open, the others listed as coming soon (Dan 11-16 14:3x). */
export function LangPick(p: { help: boolean; onPick: (lang: LearnLang) => Promise<void> }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <div className="lcw-lang lcw-card" data-testid="lang-pick">
      <h1>
        <Say line={X.lang.title} help={p.help} />
      </h1>
      <p>
        <Say line={X.lang.lead} help={p.help} />
      </p>
      <div className="lcw-lang__grid" role="group" aria-label={X.lang.title.en}>
        {LEARN_LANGS.map((l) => {
          const lang = readLearnLang(l.id);
          return (
            <button
              key={l.id}
              type="button"
              className="lcw-lang__card"
              disabled={!lang || busy}
              data-lang={l.id}
              onClick={() => {
                if (!lang) return;
                setBusy(true);
                void p.onPick(lang).finally(() => setBusy(false));
              }}
            >
              <i aria-hidden>{l.flag}</i>
              <b>{l.label}</b>
              <span>{lang ? (busy ? X.lang.saving.en : p.help ? l.labelKo : X.lang.pick.en) : p.help ? `${X.lang.soon.en} · ${X.lang.soon.ko}` : X.lang.soon.en}</span>
            </button>
          );
        })}
      </div>
      <HelpKoToggle on={p.help} />
    </div>
  );
}

function OptionRow<K extends string>(p: { label: Bi; help: boolean; options: readonly WorldSetupOption<K>[]; value: K; onPick: (k: K) => void; testId: string }): React.ReactElement {
  return (
    <div>
      <div className="lcw-make__label">
        <Say line={p.label} help={p.help} />
      </div>
      <div className="lcw-make__row" role="group" aria-label={p.label.en} data-testid={p.testId}>
        {p.options.map((o) => (
          <button key={o.id} type="button" className="lcw-opt" aria-pressed={o.id === p.value} onClick={() => p.onPick(o.id)} data-opt={o.id}>
            <i aria-hidden>{o.emoji}</i>
            <b>{o.labelEn}</b>
            <span>{p.help ? `${o.hintEn} · ${o.labelKo}: ${o.hintKo}` : o.hintEn}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MakeWorld(p: { initialName: string; help: boolean; onMake: (c: WorldSetupChoice & { name: string }) => Promise<boolean> }): React.ReactElement {
  const [name, setName] = useState(p.initialName);
  const [choice, setChoice] = useState<WorldSetupChoice>(() => randomWorldChoice(Math.random));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const clean = cleanWorldName(name);
  const set = <K extends keyof WorldSetupChoice>(k: K) => (v: WorldSetupChoice[K]) => setChoice((c) => ({ ...c, [k]: v }));
  return (
    <form
      className="lcw-make lcw-card"
      data-testid="make-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!clean || busy) return;
        setBusy(true);
        setFailed(false);
        void p.onMake({ ...choice, name: clean }).then((ok) => {
          setBusy(false);
          if (!ok) setFailed(true);
        });
      }}
    >
      <h1>
        <Say line={X.make.title} help={p.help} />
      </h1>
      <p>
        <Say line={X.make.lead} help={p.help} />
      </p>
      <div>
        <label className="lcw-make__label" htmlFor="lcw-world-name">
          <Say line={X.make.nameLabel} help={p.help} />
        </label>
        <input
          id="lcw-world-name"
          className="lcw-make__name"
          value={name}
          maxLength={WORLD_NAME_MAX}
          placeholder={X.make.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          data-testid="make-name"
        />
        <div className="lcw-start__hint">
          <Say line={X.make.nameRule} help={p.help} />
        </div>
      </div>
      <OptionRow label={X.make.season} help={p.help} options={WORLD_SEASONS} value={choice.season} onPick={set('season')} testId="make-season" />
      <OptionRow label={X.make.time} help={p.help} options={WORLD_TIMES} value={choice.time} onPick={set('time')} testId="make-time" />
      <OptionRow label={X.make.buddy} help={p.help} options={WORLD_BUDDIES} value={choice.buddy} onPick={set('buddy')} testId="make-buddy" />
      {failed ? (
        <p className="lcw-start__hint">
          <Say line={X.make.failed} help={p.help} />
        </p>
      ) : null}
      <div className="lcw-make__foot">
        <button type="button" className="lcw-btn" onClick={() => setChoice(randomWorldChoice(Math.random))} data-testid="make-dice">
          🎲 <Say line={X.make.dice} help={p.help} />
        </button>
        <button type="submit" className="lcw-btn lcw-btn--main" disabled={!clean || busy} data-testid="make-submit">
          <Say line={busy ? X.make.making : X.make.submit} help={p.help} />
        </button>
      </div>
    </form>
  );
}

/** The 3x3 sectors of this seed (sim-core generateWorldLayout): the town in the middle, eight places around it. */
export function revealCards(world: WorldSetup): Array<{ key: string; emoji: string; name: string; nameKo: string; home: boolean }> {
  const layout = generateWorldLayout(world.seed);
  const cells = [...layout.sectors].sort((a, b) => a.gz - b.gz || a.gx - b.gx);
  return cells.map((s) =>
    s.isPlaza || !s.biome
      ? { key: 'home', emoji: '🏘️', name: world.name, nameKo: world.name, home: true }
      : {
          key: s.biome.id,
          emoji: BIOME_NAMES[s.biome.id]?.emoji ?? '❓',
          name: BIOME_NAMES[s.biome.id]?.name.en ?? s.biome.id,
          nameKo: BIOME_NAMES[s.biome.id]?.name.ko ?? s.biome.id,
          home: false
        }
  );
}

function Reveal(p: { world: WorldSetup; help: boolean; onEnter: () => void }): React.ReactElement {
  const cards = useMemo(() => revealCards(p.world), [p.world]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    // the middle first, then around it (one card every 160 ms)
    const order = [4, 0, 1, 2, 5, 8, 7, 6, 3];
    let i = 0;
    const t = setInterval(() => {
      i++;
      setShown(i);
      if (i >= order.length) clearInterval(t);
    }, 160);
    return () => clearInterval(t);
  }, []);
  const order = [4, 0, 1, 2, 5, 8, 7, 6, 3];
  const on = new Set(order.slice(0, shown));
  const pick = <K extends string>(list: readonly WorldSetupOption<K>[], id: K) => list.find((o) => o.id === id);
  const chips = [pick(WORLD_SEASONS, p.world.season), pick(WORLD_TIMES, p.world.time), pick(WORLD_BUDDIES, p.world.buddy)];
  return (
    <div className="lcw-reveal lcw-card" data-testid="reveal">
      <h1>
        <Say line={X.reveal.title(p.world.name)} help={p.help} />
      </h1>
      <p>
        <Say line={X.reveal.lead} help={p.help} />
      </p>
      <div className="lcw-grid">
        {cards.map((c, i) => (
          <div key={`${c.key}-${i}`} className={`lcw-flip${on.has(i) ? ' on' : ''}${c.home ? ' lcw-flip--home' : ''}`} data-testid="reveal-card">
            <div className="lcw-flip__back">?</div>
            <div className="lcw-flip__face">
              <i aria-hidden>{c.emoji}</i>
              <span>
                <Say line={c.home ? X.reveal.center : { en: c.name, ko: c.nameKo }} help={p.help} />
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="lcw-reveal__chips">
        {chips.map((o) => (o ? <span key={o.id}>{`${o.emoji} ${o.labelEn}`}</span> : null))}
        <span>{X.reveal.seed(p.world.seed)}</span>
      </div>
      <button type="button" className="lcw-btn lcw-btn--main" onClick={p.onEnter} disabled={shown < 9} data-testid="reveal-enter" autoFocus>
        <Say line={X.reveal.enter} help={p.help} />
      </button>
    </div>
  );
}

/**
 * In the world: when the teacher starts the lesson, a signed-in student joins it without pressing anything (Dan 11-16
 * 12:10: the teacher comes into the student's world). A short notice says so; the lesson layer takes over.
 */
export function LessonAutoJoin(props: {
  identity: PlayerIdentity | null;
  onLessonSession: (s: DeviceLessonSession) => void;
  fetchFn?: FetchLike;
}): React.ReactElement | null {
  const { identity, onLessonSession } = props;
  const fetchFn = useMemo<FetchLike>(() => props.fetchFn ?? ((i, init) => globalThis.fetch(i, init)), [props.fetchFn]);
  const [notice, setNotice] = useState(false);
  const busy = useRef(false);
  useEffect(() => injectStyle(), []);
  useEffect(() => {
    if (identity?.kind !== 'child') return;
    let alive = true;
    const ask = () =>
      void liveLessonId(identity, fetchFn).then(async (l) => {
        // none live, a join on its way, or this tab is already in that lesson: nothing to do
        if (!alive || !l || busy.current || loadStudentSession()?.lessonId === l) return;
        busy.current = true;
        const s = await joinDeviceLesson(identity, fetchFn);
        busy.current = false;
        if (!alive || !s) return;
        setNotice(true);
        onLessonSession(s);
      });
    ask();
    const t = setInterval(ask, LIVE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [identity, fetchFn, onLessonSession]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(false), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="lcw-invite lcw-card" role="status" aria-live="polite" data-testid="lesson-invite">
      <b>
        📣 <Say line={X.invite.title} />
      </b>
    </div>
  );
}
