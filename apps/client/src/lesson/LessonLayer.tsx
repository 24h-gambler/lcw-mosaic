/**
 * Lesson layer of the 3D client (docs/19 §4, props per §5). App mounts it always; it draws nothing unless there is a
 * lesson (`?code=` in the URL or a student session in this tab). It owns joining, the 3-second state poll, scene
 * changes, possession bubbles and director events, and hands the dialog panel a submit that goes to
 * /v1/lesson/utterance. App only mounts it when the device runs the world (else App shows the /join card itself).
 * Until the world handle arrives it draws its own goal bar and bubbles.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getLessonNpc, type LessonDirectorEventKind, type LessonHintLevel, type LessonNpcContext, type LessonUtteranceMode } from '@lcw/content';
import type { Level } from '@lcw/schemas';
import { TOKENS } from '@lcw/ui';
import { codeFromSearch, createStudentLessonApi, loadStudentSession, type DialogResult, type LessonOffer, type StudentLessonApi, type UtteranceSubmit } from './api.js';
import { LessonController, initialLessonView, type LessonView, type LessonWorld } from './controller.js';
import { MIC_BLOCKING_ERRORS, maskTarget, micUnreliable, pickHeard, type HeardAlternative } from './hint.js';
import { LESSON_STRINGS_KO as S } from './strings.js';
import { playLessonSfx, unlockLessonAudio } from './sfx.js';

const C = TOKENS.colors;
const T = TOKENS.typography;
const SP = TOKENS.spacing;

export interface LessonNpcRef {
  id: string;
  ctx: LessonNpcContext;
  nameKo: string;
  nameEn: string;
}

export interface LessonDialogConfig {
  level: Level;
  mode: LessonUtteranceMode;
  offers: LessonOffer[];
  hint: LessonHintLevel;
  /** Takes the dialog panel's UtteranceSubmit (unknown shape on purpose: see readUtteranceSubmit). */
  submit: (u: unknown) => Promise<DialogResult>;
  onDone: (r: DialogResult) => void;
  onClose?: () => void;
}

export interface LessonLayerProps {
  world: LessonWorld | null;
  /** The dialog domain's panel; returns null when it is not available, then the layer's own panel is used. */
  renderDialog?: (npc: LessonNpcRef, cfg: LessonDialogConfig) => React.ReactNode;
  /** True while a lesson is live: App shows the "수업 중" badge and stops opening solo dialogs on NPC taps. */
  onLessonActive?: (active: boolean) => void;
  api?: StudentLessonApi;
  search?: string;
  /** False when the device cannot run the 3D world: the lesson continues on the /join word-card screen. */
  canRender3d?: boolean;
}

/** World members the layer uses beyond the controller's (docs/19 §2): the child's own line as a bubble. */
type LayerWorld = LessonWorld & { playerSay?(text: string): void };

export function hasWebGL(): boolean {
  try {
    if (typeof document === 'undefined') return true;
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    // Give the probe context back at once: browsers keep ~16 and drop the oldest (the game's renderer) first.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function isLessonPage(search: string): boolean {
  return Boolean(codeFromSearch(search) ?? loadStudentSession());
}

export function LessonLayer(props: LessonLayerProps): React.ReactElement | null {
  const onActive = useRef(props.onLessonActive);
  onActive.current = props.onLessonActive;
  const search = props.search ?? (typeof location === 'undefined' ? '' : location.search);
  const code = codeFromSearch(search);
  const [active] = useState(() => Boolean(code ?? loadStudentSession()));
  const [view, setView] = useState<LessonView>(initialLessonView);
  const api = useMemo(() => props.api ?? createStudentLessonApi(), [props.api]);
  const worldRef = useRef<LayerWorld | null>(props.world);
  worldRef.current = props.world;
  const ctl = useMemo(
    () =>
      new LessonController({
        api,
        // The world can arrive after the first render; the controller always talks to the current one.
        world: {
          goToScene: (id) => worldRef.current?.goToScene(id) ?? Promise.resolve(),
          npcSay: (n, t, o) => worldRef.current?.npcSay(n, t, o),
          setGoal: (g, t) => worldRef.current?.setGoal(g, t),
          celebrate: (s) => worldRef.current?.celebrate(s),
          setPossessed: (n) => worldRef.current?.setPossessed?.(n),
          playDirectorEvent: (k, d) => {
            playLessonSfx(k);
            worldRef.current?.playDirectorEvent?.(k, d);
          }
        },
        ui: props.canRender3d === false ? 'cards' : '3d',
        onChange: setView
      }),
    [api]
  );

  // App decides WebGL once (canRunWorld) and never mounts the layer without it; no probing here on every render.
  const lowTier = props.canRender3d === false;
  const live = view.phase === 'live';
  useEffect(() => {
    onActive.current?.(live);
  }, [live]);
  useEffect(() => () => onActive.current?.(false), []);
  useEffect(() => {
    if (!active) return;
    const unlock = () => unlockLessonAudio();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    if (lowTier) {
      // docs/19 §4: devices without WebGL or on the low tier take the lesson on /join (same API, same session).
      const t = setTimeout(() => location.replace(`/join${code ? `?code=${code}` : ''}`), 1200);
      return () => clearTimeout(t);
    }
    void ctl.start(code);
    return () => ctl.stop();
  }, [active, lowTier, ctl, code]);

  if (!active && view.phase === 'needs_code' && !code) return null;
  if (lowTier) return <Shell><CenterCard><p style={bodyL}>{S.lowTier}</p></CenterCard></Shell>;
  if (view.phase === 'needs_code' || view.phase === 'joining') {
    return (
      <Shell>
        <CodeEntry busy={view.phase === 'joining'} errorCode={view.errorCode} initial={code ?? ''} onSubmit={(c) => void ctl.join(c)} />
      </Shell>
    );
  }
  if (view.phase === 'ended') {
    return (
      <Shell>
        <CenterCard>
          <div style={{ fontSize: 56, lineHeight: '64px' }} aria-hidden>⭐</div>
          <h1 style={{ ...h2, margin: `${SP[2]}px 0` }}>{S.ended.title}</h1>
          <p style={bodyL}>{S.ended.body}</p>
          {view.lastResult ? <p style={{ ...bodyL, fontWeight: 700 }}>{S.ended.today(view.lastResult.utterancesToday)}</p> : null}
        </CenterCard>
      </Shell>
    );
  }

  const npc = getLessonNpc(view.npcId);
  const npcRef: LessonNpcRef = { id: view.npcId, ctx: npc?.ctx ?? 'guide', nameKo: npc?.nameKo ?? view.npcId, nameEn: npc?.nameEn ?? view.npcId };
  const cfg: LessonDialogConfig = {
    level: view.level,
    mode: view.mode,
    offers: view.offers,
    hint: view.hint,
    submit: ctl.submit,
    onDone: () => undefined
  };
  const external = props.renderDialog?.(npcRef, cfg) ?? null;

  // New stage or new sentences from the teacher: the panel starts fresh (selection, heard text, open microphone).
  const panelKey = `${view.stageSeq}:${view.offers.map((o) => o.text).join('|')}`;
  return (
    <Shell>
      <EventEffect kind={view.banner?.kind ?? null} id={view.banner?.id ?? null} handledByWorld={Boolean(props.world?.playDirectorEvent)} />
      {/* One column: the top stack and the speaking panel share the height and each shrinks (the panel scrolls), so on a
          short phone the panel never covers the teacher's bubble or the event banner. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: SP[2], padding: SP[2] }}>
        <div className="lcw-top" style={{ display: 'flex', flexDirection: 'column', gap: SP[2], flex: '0 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: SP[2], alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            {props.world ? <span /> : <GoalBar goalKo={view.goalKo} />}
            <StatusPill view={view} onLeave={() => ctl.leave()} />
          </div>
          {props.world ? null : <Bubbles view={view} />}
          <EventBanner view={view} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flex: '0 1 auto', minHeight: 0 }}>
          <div className="lcw-panel" style={{ width: '100%', maxWidth: 720, pointerEvents: 'auto', overflowY: 'auto', maxHeight: '100%' }}>
            {external ?? (
            <SpeakPanel
              key={panelKey}
              npc={npcRef}
              view={view}
              submit={ctl.submit}
              onSaid={(text) => worldRef.current?.playerSay?.(text)}
              onResult={(r) => {
                if (r.pass) worldRef.current?.celebrate(Math.min(3, Math.max(0, Math.round(r.stars))) as 0 | 1 | 2 | 3);
              }}
            />
          )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ---------- pieces ---------- */

const bodyL: React.CSSProperties = { fontFamily: T.fonts.ui, fontSize: T.scale['body-l'].sizePx, lineHeight: `${T.scale['body-l'].lineHeightPx}px`, color: C['ink-900'], margin: 0 };
const h2: React.CSSProperties = { fontFamily: T.fonts.ui, fontSize: T.scale.h2.sizePx, lineHeight: `${T.scale.h2.lineHeightPx}px`, color: C['ink-900'], fontWeight: 800 };
const card: React.CSSProperties = {
  background: C['paper-0'],
  border: `${TOKENS.shape.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: TOKENS.shape.radiusCardPx,
  boxShadow: TOKENS.shape.shadowDefault
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div data-lcw-lesson style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40, fontFamily: T.fonts.ui }}>
      <style>{LESSON_CSS}</style>
      {children}
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: `${C['night-900']}8C`, pointerEvents: 'auto', padding: SP[3] }}>
      <div style={{ ...card, background: C['paper-50'], padding: SP[5], maxWidth: 520, width: '100%', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

function CodeEntry(p: { busy: boolean; errorCode: string | null; initial: string; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState(p.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const digits = code.padEnd(6, ' ').slice(0, 6).split('');
  const err = p.errorCode ? (S.code.errors[p.errorCode] ?? S.code.errors.default) : null;
  return (
    <CenterCard>
      <div style={{ fontSize: 44 }} aria-hidden>🏡</div>
      <h1 style={{ ...h2, margin: `${SP[2]}px 0 ${SP[1]}px` }}>{S.code.title}</h1>
      <p style={{ ...bodyL, color: C['ink-700'] }}>{S.code.sub}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6 && !p.busy) p.onSubmit(code);
        }}
        style={{ marginTop: SP[4] }}
      >
        <label style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap: SP[1], cursor: 'text' }}>
          {digits.map((d, i) => (
            <span
              key={i}
              style={{
                width: 'min(13vw, 56px)',
                height: 'min(16vw, 68px)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 'min(9vw, 36px)',
                fontWeight: 800,
                fontFamily: T.fonts.target,
                background: C['paper-0'],
                border: `3px solid ${i === code.length ? C.sky : C['ink-900']}`,
                borderRadius: TOKENS.shape.radiusCardPx,
                color: C['ink-900']
              }}
            >
              {d.trim()}
            </span>
          ))}
          <input
            ref={ref}
            aria-label={S.code.title}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ position: 'absolute', inset: 0, opacity: 0, fontSize: 16 }}
          />
        </label>
        {err ? <p role="alert" style={{ ...bodyL, color: C['danger-d'], marginTop: SP[3] }}>{err}</p> : null}
        <button type="submit" disabled={code.length !== 6 || p.busy} className="lcw-btn" style={{ ...bigButton(C['leaf-d']), marginTop: SP[4], width: '100%', opacity: code.length === 6 ? 1 : 0.5 }}>
          {p.busy ? S.code.joining : S.code.enter}
        </button>
      </form>
    </CenterCard>
  );
}

function bigButton(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: C['paper-0'],
    border: `${TOKENS.shape.borderWidthPx}px solid ${C['ink-900']}`,
    borderRadius: TOKENS.shape.radiusButtonPx,
    boxShadow: TOKENS.shape.shadowDefault,
    minHeight: TOKENS.shape.gameButtonMinPx,
    padding: `${SP[2]}px ${SP[4]}px`,
    fontFamily: T.fonts.ui,
    fontSize: T.scale['body-l'].sizePx,
    fontWeight: 800,
    cursor: 'pointer'
  };
}

function StatusPill({ view, onLeave }: { view: LessonView; onLeave: () => void }) {
  const ok = view.connection === 'ok';
  const [asking, setAsking] = useState(false);
  const small: React.CSSProperties = { ...card, boxShadow: 'none', padding: `${SP[1]}px ${SP[2]}px`, fontSize: T.scale.small.sizePx, cursor: 'pointer', minHeight: TOKENS.shape.touchTargetMinPx, color: C['ink-900'] };
  if (asking) {
    // Two taps to leave: a stray tap on a phone must not drop the child out of the lesson.
    return (
      <div role="group" aria-label={S.status.leaveAsk} style={{ ...card, display: 'flex', gap: SP[1], alignItems: 'center', padding: SP[1], pointerEvents: 'auto', marginLeft: 'auto' }}>
        <span style={{ fontSize: T.scale.small.sizePx, fontWeight: 700, padding: `0 ${SP[1]}px` }}>{S.status.leaveAsk}</span>
        <button type="button" onClick={() => setAsking(false)} style={{ ...small, background: C['leaf-d'], color: C['paper-0'], fontWeight: 800 }}>{S.status.leaveNo}</button>
        <button type="button" onClick={onLeave} style={small}>{S.status.leaveYes}</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: SP[1], pointerEvents: 'auto', marginLeft: 'auto' }}>
      <span
        role="status"
        style={{
          ...card,
          boxShadow: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: SP[1],
          padding: `${SP[1]}px ${SP[2]}px`,
          fontSize: T.scale.small.sizePx,
          fontWeight: 700,
          color: C['ink-900']
        }}
      >
        <span className={ok ? '' : 'lcw-blink'} style={{ width: 10, height: 10, borderRadius: 5, background: ok ? C.leaf : C.sun, display: 'inline-block' }} />
        {ok ? S.status.ok(view.nickname) : S.status.retrying}
      </span>
      <button type="button" onClick={() => setAsking(true)} style={small}>
        {S.status.leave}
      </button>
    </div>
  );
}

function GoalBar({ goalKo }: { goalKo: string }) {
  if (!goalKo) return null;
  return (
    <div style={{ display: 'flex', flex: '1 1 260px', minWidth: 0 }}>
      <div style={{ ...card, background: C['night-900'], color: C['paper-0'], padding: `${SP[1]}px ${SP[3]}px`, display: 'flex', gap: SP[2], alignItems: 'center', maxWidth: 640 }}>
        <span style={{ background: C.sun, color: C['ink-900'], fontWeight: 800, fontSize: T.scale.micro.sizePx, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{S.goal.label}</span>
        <span style={{ fontSize: T.scale.body.sizePx, fontWeight: 700 }}>{goalKo}</span>
      </div>
    </div>
  );
}

function EventBanner({ view }: { view: LessonView }) {
  const b = view.banner;
  if (!b) return null;
  return (
    <div key={b.id} className="lcw-pop" style={{ display: 'flex', justifyContent: 'center' }}>
      <div role="alert" style={{ ...card, background: C.sun, padding: `${SP[3]}px ${SP[4]}px`, display: 'flex', gap: SP[3], alignItems: 'center', maxWidth: 640 }}>
        <span style={{ fontSize: 48, lineHeight: '52px' }} aria-hidden>{b.icon}</span>
        <div>
          <div className="lcw-banner-text" style={{ ...bodyL, fontWeight: 800, fontSize: T.scale.h3.sizePx, lineHeight: `${T.scale.h3.lineHeightPx}px` }}>{b.textKo}</div>
          {b.detail ? <div style={{ ...bodyL, fontFamily: T.fonts.target, marginTop: SP[1] }}>{b.detail}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Screen-space fallback effect when the world does not play the event itself (no flashing: docs/08 motion caps). */
function EventEffect({ kind, id, handledByWorld }: { kind: LessonDirectorEventKind | null; id: string | null; handledByWorld: boolean }) {
  if (!kind || !id || handledByWorld) return null;
  if (kind === 'blackout') return <div key={id} className="lcw-blackout" style={{ position: 'absolute', inset: 0, background: C['night-900'] }} />;
  if (kind === 'weather_shift' || kind === 'star_celebration') {
    const glyph = kind === 'weather_shift' ? '❄' : '⭐';
    return (
      <div key={id} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} className="lcw-fall" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.35}s`, fontSize: 18 + ((i * 7) % 18), color: kind === 'weather_shift' ? C['paper-0'] : C.sun }}>
            {glyph}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

function Bubbles({ view }: { view: LessonView }) {
  if (!view.bubbles.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[1], alignItems: 'flex-start' }}>
      {view.bubbles.map((b, i) => (
        <div key={b.id} className={i === view.bubbles.length - 1 ? 'lcw-pop' : 'lcw-older'} style={{ ...card, padding: `${SP[2]}px ${SP[3]}px`, maxWidth: 560, opacity: i === view.bubbles.length - 1 ? 1 : 0.7, borderColor: b.possessed ? C.grape : C['ink-900'], borderWidth: b.possessed ? 3 : 2 }}>
          <div style={{ fontSize: T.scale.small.sizePx, fontWeight: 800, color: b.possessed ? C['grape-d'] : C['ink-700'] }}>
            {b.possessed ? <span className="lcw-sparkle" aria-hidden>✨ </span> : null}
            {b.npcNameKo}
            {b.possessed ? ` · ${S.possessed}` : ''}
          </div>
          <div style={{ fontFamily: T.fonts.target, fontSize: T.targetSentenceMinPx, lineHeight: '30px', color: C['ink-900'] }}>{b.text}</div>
        </div>
      ))}
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** A recognizer that neither ends nor answers within this long is stopped (iOS Safari sometimes never fires onend). */
export const MIC_WATCHDOG_MS = 10_000;

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof navigator !== 'undefined' && micUnreliable(navigator.userAgent)) return null;
  return (g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/** The lesson's own speaking panel, used until the dialog domain's DialogPanel is mounted (docs/19 §3 same submit). */
function SpeakPanel({
  npc,
  view,
  submit,
  onSaid,
  onResult
}: {
  npc: LessonNpcRef;
  view: LessonView;
  submit: (u: UtteranceSubmit) => Promise<DialogResult>;
  onSaid?: (text: string) => void;
  onResult?: (r: DialogResult) => void;
}) {
  const offers = view.offers;
  const free = view.mode === 'free';
  const [pick, setPick] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DialogResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [micNote, setMicNote] = useState<'not_heard' | 'blocked' | null>(null);
  const shownAt = useRef(Date.now());
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const offer = offers[Math.min(pick, Math.max(0, offers.length - 1))];
  useEffect(() => {
    alive.current = true;
    return () => {
      // Stage changed or the lesson ended mid-sentence: close the microphone and drop what it would have sent.
      alive.current = false;
      if (watchdog.current) clearTimeout(watchdog.current);
      const r = recRef.current;
      recRef.current = null;
      try {
        r?.abort();
      } catch {
        /* already closed */
      }
    };
  }, []);

  const send = async (transcript: string, source: UtteranceSubmit['stt_source'], startedAt: number, confidence: number) => {
    if (!transcript.trim() || !alive.current) return;
    onSaid?.(transcript.trim());
    setBusy(true);
    setFailed(false);
    try {
      const r = await submit({
        target_text: free ? '' : (offer?.text ?? ''),
        transcript: transcript.trim(),
        chosen_stars: offer?.stars ?? 1,
        hint_level: view.hint,
        latency_ms: Math.max(0, startedAt - shownAt.current),
        dur_ms: Math.max(0, Date.now() - startedAt),
        stt_source: source,
        confidence
      });
      if (!alive.current) return;
      onResult?.(r);
      setResult(r);
      if (r.pass) playLessonSfx('pass');
      shownAt.current = Date.now();
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const toggleMic = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return setTyping(true);
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        setListening(false);
      }
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;
    const startedAt = Date.now();
    let finals: HeardAlternative[] = [];
    let finalText = '';
    let interim = '';
    let error: string | null = null;
    rec.onresult = (e) => {
      interim = '';
      finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) {
          const alts = Array.from(r, (x) => ({ transcript: x.transcript ?? '', confidence: typeof x.confidence === 'number' ? x.confidence : 0 }));
          finals = alts;
          finalText += `${alts[0]?.transcript ?? ''} `;
        } else interim += r[0]?.transcript ?? '';
      }
      if (alive.current) setHeard((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      error = e?.error ?? 'unknown';
    };
    rec.onend = () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      watchdog.current = null;
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (!alive.current) return;
      setListening(false);
      if (error && MIC_BLOCKING_ERRORS.has(error)) {
        setMicNote('blocked');
        setTyping(true);
        return;
      }
      // Best final alternative; if the recognizer stopped before a final result, what the child saw as heard counts.
      const best = finals.length > 1 ? pickHeard(finals, free ? '' : (offer?.text ?? ''), free) : null;
      const text = (best?.transcript ?? (finalText.trim() || interim)).trim();
      if (!text) {
        setMicNote('not_heard');
        return;
      }
      void send(text, 'browser', startedAt, best?.confidence ?? finals[0]?.confidence ?? 0.5);
    };
    recRef.current = rec;
    setHeard('');
    setResult(null);
    setMicNote(null);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setMicNote('blocked');
      setTyping(true);
      return;
    }
    setListening(true);
    playLessonSfx('mic_on');
    watchdog.current = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* fall through to the forced end below */
      }
      // If even stop() brings no onend, end it here so the button never stays on '다 말했어요'.
      watchdog.current = setTimeout(() => rec.onend?.(), 1500);
    }, MIC_WATCHDOG_MS);
  };

  return (
    <div style={{ ...card, background: C['paper-50'], padding: SP[3] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: SP[2], marginBottom: SP[2] }}>
        <strong style={{ fontSize: T.scale['body-l'].sizePx, color: C['ink-900'] }}>
          {view.possessedNpcId === npc.id ? <span className="lcw-sparkle">✨ </span> : null}
          {S.speak.title(npc.nameKo)}
        </strong>
        {!free && offers.length > 1 ? <span className="lcw-hint-note" style={{ fontSize: T.scale.small.sizePx, color: C['ink-500'] }}>{S.speak.pickStars}</span> : null}
      </div>
      {free ? (
        <p style={{ ...bodyL, marginBottom: SP[2] }}>{S.speak.free}</p>
      ) : (
        <div className="lcw-offers" style={{ display: 'grid', gap: SP[1], marginBottom: SP[2] }}>
          {offers.map((o, i) => {
            const meta = TOKENS.semantic.stars[o.stars];
            const sel = i === pick;
            const shown = maskTarget(o.text, view.hint, o.hintTags);
            return (
              <button
                key={`${o.text}-${i}`}
                type="button"
                aria-pressed={sel}
                onClick={() => setPick(i)}
                style={{
                  display: 'flex',
                  gap: SP[2],
                  alignItems: 'center',
                  textAlign: 'left',
                  background: sel ? C[meta.color] : C['paper-0'],
                  border: `${meta.borderWidthPx + 1}px solid ${C['ink-900']}`,
                  borderRadius: TOKENS.shape.radiusButtonPx,
                  padding: `${SP[1]}px ${SP[2]}px`,
                  minHeight: TOKENS.shape.gameButtonMinPx,
                  cursor: 'pointer',
                  color: C['ink-900']
                }}
              >
                <span style={{ fontWeight: 800, minWidth: 48, fontSize: T.scale.body.sizePx }}>{'★'.repeat(o.stars)}</span>
                <span style={{ fontFamily: T.fonts.target, fontSize: T.targetSentenceMinPx, lineHeight: '30px', flex: 1 }}>{shown || '…'}</span>
              </button>
            );
          })}
        </div>
      )}
      {heard ? (
        <p style={{ ...bodyL, color: C['ink-700'], margin: `0 0 ${SP[2]}px` }}>
          {S.speak.heard}: <span style={{ fontFamily: T.fonts.target, color: C['ink-900'] }}>{heard}</span>
        </p>
      ) : null}
      {result ? (
        <div className="lcw-pop" role="status" style={{ ...card, boxShadow: 'none', background: result.pass ? C['paper-0'] : C['paper-100'], padding: `${SP[2]}px ${SP[3]}px`, marginBottom: SP[2], display: 'flex', gap: SP[2], alignItems: 'center' }}>
          {result.pass ? <span style={{ color: C['sun-d'], fontSize: 28, letterSpacing: 2 }}>{'★'.repeat(result.stars)}</span> : <span style={{ fontSize: 28 }}>💬</span>}
          <span style={{ ...bodyL, flex: 1 }}>{result.feedbackKo}</span>
          {result.coinsTotal !== undefined ? <span style={{ fontWeight: 800, color: C['sun-d'] }}>{S.result.coins(result.coinsTotal)}</span> : null}
        </div>
      ) : null}
      {failed ? <p role="alert" style={{ ...bodyL, color: C['danger-d'], marginBottom: SP[2] }}>{S.speak.failed}</p> : null}
      {micNote ? (
        <p role="status" style={{ ...bodyL, color: C['ink-700'], marginBottom: SP[2] }}>
          {micNote === 'blocked' ? S.speak.micBlocked : S.speak.notHeard}
        </p>
      ) : null}
      {typing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const t = typed;
            setTyped('');
            void send(t, 'keyboard', Date.now(), 1);
          }}
          style={{ display: 'flex', gap: SP[1] }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={S.speak.typePlaceholder} aria-label={S.speak.typePlaceholder} style={{ flex: 1, minHeight: TOKENS.shape.gameButtonMinPx, fontSize: 18, padding: `0 ${SP[2]}px`, border: `2px solid ${C['ink-900']}`, borderRadius: TOKENS.shape.radiusButtonPx, fontFamily: T.fonts.target }} />
          <button type="submit" disabled={busy || !typed.trim()} style={bigButton(C['sky-d'])}>{busy ? S.speak.sending : S.speak.send}</button>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: SP[2], alignItems: 'center' }}>
          <button type="button" onClick={toggleMic} disabled={busy} className={listening ? 'lcw-pulse' : ''} style={{ ...bigButton(listening ? C['danger-d'] : C['brand-d']), minHeight: TOKENS.shape.micButtonPx, flex: 1, fontSize: T.scale.h3.sizePx }}>
            {busy ? S.speak.sending : listening ? `🎙 ${S.speak.micStop}` : `🎙 ${S.speak.mic}`}
          </button>
          <button type="button" onClick={() => setTyping(true)} style={{ ...bigButton(C['paper-0']), color: C['ink-900'], fontSize: T.scale.body.sizePx }}>
            ⌨ {S.speak.typeInstead}
          </button>
        </div>
      )}
      {listening ? <p style={{ ...bodyL, color: C['ink-500'], marginTop: SP[1] }}>{S.speak.listening}</p> : null}
    </div>
  );
}

const LESSON_CSS = `
[data-lcw-lesson] button:focus-visible { outline: ${TOKENS.shape.focusOutlineWidthPx}px solid ${C.sky}; outline-offset: 2px; }
.lcw-pop { animation: lcwPop ${TOKENS.motion.popMs}ms ease-out; }
@keyframes lcwPop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.lcw-blink { animation: lcwBlink 1s ease-in-out infinite; }
@keyframes lcwBlink { 50% { opacity: 0.3; } }
.lcw-pulse { animation: lcwPulse 1.2s ease-in-out infinite; }
@keyframes lcwPulse { 50% { transform: scale(1.03); } }
.lcw-sparkle { display: inline-block; animation: lcwSpark 1.4s ease-in-out infinite; }
@keyframes lcwSpark { 50% { transform: scale(1.25) rotate(12deg); } }
.lcw-blackout { animation: lcwDark 3.2s ease-in-out forwards; pointer-events: none; }
@keyframes lcwDark { 0% { opacity: 0; } 8% { opacity: 0.82; } 70% { opacity: 0.82; } 100% { opacity: 0; } }
.lcw-fall { position: absolute; top: -40px; animation: lcwFall 3.6s linear 2 forwards; }
@keyframes lcwFall { to { transform: translateY(110vh) rotate(220deg); } }
@media (max-width: 600px), (max-height: 720px) {
  .lcw-older, .lcw-hint-note { display: none; }
  .lcw-offers { max-height: 30vh; overflow-y: auto; }
  .lcw-offers button { min-height: 48px !important; }
  .lcw-banner-text { font-size: 18px !important; line-height: 24px !important; }
}
@media (prefers-reduced-motion: reduce) { .lcw-pop, .lcw-blink, .lcw-pulse, .lcw-sparkle, .lcw-fall { animation: none; } .lcw-blackout { animation: lcwDark 3.2s step-end forwards; } }
`;
