/**
 * App shell (docs/19 1장, world domain): full-screen 3D world plus the two slots other domains fill —
 * the dialog panel (`dialog/DialogPanel.tsx`, docs/19 3장) and the lesson layer (`lesson/LessonLayer.tsx`, docs/19 4장).
 * A slot whose module is not in the build yet stays empty; when it lands, Vite picks it up with no edit here.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Level } from '@lcw/schemas';
import { canRunWorld, createWorld, SCENE_IDS, type NpcRef, type SceneId, type WorldHandle, type WorldTier } from './world/api.js';
import { WORLD_STRINGS as W } from './world/strings.js';
import { resolveIdentity, browserStore, storedStudentToken, type PlayerIdentity } from './world/identity.js';
import { onSeatInactive } from './world/seat.js';
import type { BuildAccess } from './world/api.js';
import { FrameFloorWatch, TIER_SETTINGS, gpuClassOf, readGpuRenderer, type GpuClass } from './world/tiers.js';
import { RoomClient } from './world/room-client.js';
import { SeatPausedCard, SeatPausedChip } from './world/SeatNotice.js';
import { FrameLayer } from './frame/FrameLayer.js';
import { savedTier } from './frame/settings.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { DEFAULT_WORLD_CHOICE, type WorldSetupChoice } from '@lcw/content';
import { codeFromSearch, loadStudentSession, saveStudentSession } from './lesson/api.js';
import { LessonAutoJoin, StartFlow } from './start/StartFlow.js';
import { GuestPassLayer } from './start/PassLayer.js';
import { passFromSearch } from './start/guestPass.js';
import type { DeviceLessonSession } from './start/api.js';
import { TeacherBar, teachFrom, teachTicketBody } from './world/TeacherBar.js';
import { LESSON_FREE_TALK_EVENT, LESSON_STAGE_EVENT, LESSON_TALK_EVENT, errandGoalNpc } from './world/events.js';

/** What a dialog needs besides the NPC (docs/19 3장 DialogPanelProps without npc/onClose). */
export interface DialogConfig {
  level?: Level;
  mode?: 'free' | 'guided' | 'read' | 'recall';
  offers?: Array<{ stars: 1 | 2 | 3; text: string; hintTags: string[] }>;
  hint?: 'full' | 'keyword' | 'initial' | 'picture' | 'none';
  submit?: (u: unknown) => Promise<DialogResultLike>;
  /** `info.followUpsDone`: the window asked all its `followUps` (dialog/types.ts DialogDoneInfo, R2625). */
  onDone?: (r: DialogResultLike, info?: { followUpsDone: boolean }) => void;
  onClose?: () => void;
  /** The NPC's opening line in the window (a lesson stage's script); absent = the NPC's own greeting. */
  npcLine?: string;
  /** What the NPC asks next in the same window after a pass (a lesson stage's follow-ups, a solo open question). */
  followUps?: readonly string[];
  followUpSubmit?: (u: unknown) => Promise<DialogResultLike>;
  /** Voice and face of another ctx (the errand giver pointing the way). */
  voiceCtx?: string;
}

export interface DialogResultLike {
  pass: boolean;
  stars: number;
  feedbackKo: string;
  /** Server ledger balance after this answer (one ledger; the HUD shows it). */
  coinsTotal?: number;
  /** What the server granted. Absent = nothing is given (docs/19 3장): the shell never invents an item. */
  itemKey?: string;
  /** Price-0 sentences: the guide's place ('cafe' | 'trade_shop') or the trade shop good the child asked for. */
  askedKey?: string;
  /** Guest practice on the device: nothing granted. */
  practice?: boolean;
  /** First-visit errand step this answer moved (server state, docs/03 D1). */
  errand?: { state: ErrandState; rewardCoins?: number };
  /** A lesson goal said again: it already has its stars, so nothing is celebrated (R2627). */
  repeat?: boolean;
}

type ErrandState = 'offered' | 'accepted' | 'carrying' | 'done';
/** The first-visit errand as the server reports it (dialog domain, `dialog/errand.ts`). */
interface ErrandLike {
  state: ErrandState;
  [k: string]: unknown;
}
interface ErrandDialogLike {
  npc: NpcRef;
  offers: NonNullable<DialogConfig['offers']>;
  npcLine: string;
  voiceCtx?: string;
}
interface FirstVisitModule {
  /** docs/08 G15 first-visit guide + the 1-minute errand's goal and way (dialog domain). */
  FirstVisitGuide?: React.ComponentType<{
    world: WorldHandle | null;
    player?: SoloPlayer;
    errand: ErrandLike | null;
    onErrand: (e: ErrandLike | null) => void;
    hidden?: boolean;
  }>;
  errandDialogFor?: (npc: NpcRef, errand: ErrandLike | null, level: Level) => ErrandDialogLike | null;
  /** The "Hello!" mic check for lesson students (once per lesson) and guests (once per device), audit G15. */
  MicCheckGate?: React.ComponentType<{ identityKind: string; lessonCode?: string; hidden?: boolean }>;
}

/** Props the shell passes to the lesson layer (docs/19 5장). */
export interface LessonLayerProps {
  world: WorldHandle | null;
  renderDialog: (npc: NpcRef, cfg: DialogConfig) => React.ReactNode;
  onLessonActive?: (active: boolean) => void;
  /** Who is playing: `lesson` when the address has ?code=, `child` for a linked device, else `guest` (docs/19 5장). */
  identity?: PlayerIdentity;
  /** false when this device cannot carry the 3D world (no WebGL, start failure, or unusably slow at the lowest
   *  resolution): the lesson moves to the /join word cards in the same session. */
  canRender3d?: boolean;
  /** A free talk with a passer-by is open over the lesson (Dan 11-19): the lesson window stays off until it closes. */
  freeTalkOpen?: boolean;
}

/** What solo play knows about the player: a linked child device sends its token, a guest sends nothing. */
export interface SoloPlayer {
  deviceToken?: string;
  nickname?: string;
  level?: Level;
}

/** docs/19 6장: a linked child whose seat stopped (play_allowed=false) may look around but not play solo. */
export function soloPlayBlocked(id: PlayerIdentity | null): boolean {
  return id?.kind === 'child' && !id.playAllowed;
}

/**
 * Record spoken turns for the guardian's replay (edge voice.ts)? In a lesson: the /v1/join answer kept in this tab;
 * otherwise the linked child device's voice_store from /v1/device/me. A guest never records. The server checks again.
 */
export function recordClipFor(id: PlayerIdentity | null, store: Pick<Storage, 'getItem'> | null = sessionStoreOrNull()): boolean {
  try {
    if (store?.getItem('lcw.studentToken')) return store.getItem('lcw.studentVoice') === '1';
  } catch {
    /* storage blocked: fall through to the device identity */
  }
  return id?.kind === 'child' && id.voiceStore === true;
}

function sessionStoreOrNull(): Pick<Storage, 'getItem'> | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Who builds on my plot and where it is saved (docs/03 D13, WP-207): a linked child saves on the server, a paused
 * seat looks only, a lesson saves with the student's own lesson token (the server picks that child's plot from the
 * token, never seat-gated) once the join gave one, a guest builds on the device only. A lesson never uses the device
 * token: a borrowed or shared tablet is linked to another child, whose plot must not get this student's building.
 */
export function buildAccessOf(id: PlayerIdentity | null, studentToken: string | null, lessonLive = false, passToken: string | null = null): BuildAccess {
  // A lesson joined without a code in the address (/join hand-off, or the code typed in the world) is live with this
  // tab's student token: building saves to the student, never to a linked child's plot on the same tablet.
  if ((id?.kind === 'lesson' || lessonLive) && studentToken && studentToken.length >= 32) return { kind: 'saved', token: studentToken, lesson: true };
  // On a guest pass the plot is the friend's (docs/19 §8), whoever this device is: never the device's own plot.
  if (passToken && passToken.length >= 32) return { kind: 'saved', token: passToken, pass: true };
  if (id?.kind === 'child') return id.playAllowed ? { kind: 'saved', token: id.token } : { kind: 'paused' };
  return { kind: 'local' };
}

/** A solo write came back 403 seat_inactive: the same identity as play_allowed=false (lessons are never gated). */
export function withSeatStopped(id: PlayerIdentity | null): PlayerIdentity | null {
  return id?.kind === 'child' ? { ...id, playAllowed: false } : id;
}

export function soloPlayerOf(id: PlayerIdentity | null): SoloPlayer | undefined {
  if (!id || id.kind !== 'child') return undefined;
  return { deviceToken: id.token, nickname: id.nickname || undefined, level: id.level };
}

type AnyComponent = React.ComponentType<Record<string, unknown>>;
interface DialogModule {
  DialogPanel?: AnyComponent;
  /** Second argument: the linked child's device token and level, when there is one (guest otherwise). */
  createSoloSubmit?: (npc: NpcRef, player?: SoloPlayer) => (u: unknown) => Promise<DialogResultLike>;
  /** A plain solo window's line (visit by visit) and its open question, taken once per opened window (R2625). */
  soloTalkPlan?: (
    npc: NpcRef,
    level: Level
  ) => { npcLine: string; offers?: NonNullable<DialogConfig['offers']>; followUps?: string[]; followUpSubmit?: (u: unknown) => Promise<DialogResultLike> };
  /** A solo window finished: moves the town goal chain and the talk count (dialog/npc-lines.ts). */
  noteSoloDone?: (npcCtx: string, r: DialogResultLike) => void;
}
interface ReviewModule {
  /** Review signs of the child's memory cards (dialog domain, docs/03 D8). */
  ReviewDock?: React.ComponentType<{ world: WorldHandle | null; player?: SoloPlayer; hidden?: boolean }>;
}
interface ReadAloudModule {
  /** Read-aloud furniture discount line under the room check (dialog domain, docs/03 D13). */
  ReadAloudPrompt?: React.ComponentType<{
    kind: 'light' | 'rest' | 'flat';
    sentence: string;
    player?: SoloPlayer;
    onResult?: (r: { pass: boolean; discount_pct: number; already_claimed: boolean }) => void;
  }>;
  /** Toby's lines for that kind of furniture; the solo trade shop offers them while the room lacks it. */
  furnitureOffersFor?: (kind: 'light' | 'rest' | 'flat', level: Level) => NonNullable<DialogConfig['offers']>;
}
interface LessonModule {
  LessonLayer?: React.ComponentType<LessonLayerProps>;
}

// Optional slots: an empty record when the other domain has not merged its file yet.
const dialogLoaders = import.meta.glob<DialogModule>('./dialog/DialogPanel.tsx');
const lessonLoaders = import.meta.glob<LessonModule>('./lesson/LessonLayer.tsx');
const reviewLoaders = import.meta.glob<ReviewModule>('./dialog/ReviewDock.tsx');
const readAloudLoaders = import.meta.glob<ReadAloudModule>('./dialog/ReadAloudPrompt.tsx');
const firstVisitLoaders = import.meta.glob<FirstVisitModule>('./dialog/FirstVisitGuide.tsx');

/** Guide answers name a place (`askedKey`); the solo world walks the child there after the window closes. */
const PLACE_SCENES: Readonly<Record<string, SceneId>> = { cafe: 'honey_cafe', honey_cafe: 'honey_cafe', trade_shop: 'trade_shop', plaza: 'plaza', build_plot: 'build_plot', open_hill: 'open_hill' };

export function guideDestination(npc: NpcRef, r: DialogResultLike): SceneId | null {
  if (npc.ctx !== 'guide' || !r.pass || !r.askedKey) return null;
  return PLACE_SCENES[r.askedKey] ?? null;
}

/**
 * What the world plays for one dialog window's results. A window may report more than once (a retry, or closing
 * with ✕/Esc after a pass reports the window's best): stars celebrate only when they beat what this window already
 * showed, a fail shows "try again" only before any pass, and the server-named item lands in hand once.
 */
/**
 * What the dialog window covers, for the world's NPC shot: a side panel (full height, part of the width — landscape
 * phones) covers the right edge; a bottom sheet or a centred window covers the bottom. Rect is the `.lcw-dlg__win`.
 */
export function dialogViewInset(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number): { bottom: number; right: number } {
  // The side panel starts under the HUD star/coin chip (dialog styles: 52-56px down), so it is not full height: it
  // reaches the bottom edge, covers most of the height and only part of the width.
  const side = r.top + r.height >= vh - 2 && r.height >= vh * 0.75 && r.width < vw * 0.8;
  if (side) return { bottom: 0, right: Math.max(0, Math.round(vw - r.left)) };
  return { bottom: Math.max(0, Math.round(vh - r.top)), right: 0 };
}

export function createResultPlayer(world: Pick<WorldHandle, 'celebrate' | 'giveItem'> & { setCoins?: WorldHandle['setCoins'] }): (r: DialogResultLike) => void {
  let best = -1;
  const given = new Set<string>();
  return (r) => {
    if (typeof r.coinsTotal === 'number') world.setCoins?.(r.coinsTotal);
    // R2627: saying a lesson goal again earns nothing, so no star flies to the chip (Oreo got ★ after ★ for one line)
    if (r.pass && r.repeat) return;
    if (r.pass) {
      const stars = Math.max(1, Math.min(3, Math.round(r.stars))) as 1 | 2 | 3;
      if (stars > best) {
        // the chip gains only what beats this window's last pass (1 star, then 2 on a retry → +1)
        world.celebrate(stars, { add: stars - Math.max(0, best) });
        best = stars;
      }
      if (r.itemKey && !r.practice && !given.has(r.itemKey)) {
        given.add(r.itemKey);
        world.giveItem(r.itemKey);
      }
    } else if (best < 0) {
      world.celebrate(0);
    }
  };
}

/**
 * Start tier: `?tier=` wins, then the quality the player picked in settings (`saved`, G14 화질, frame/settings.ts
 * savedTier), then the device guess (GPU class, memory, cores, touch).
 */
export function pickTier(
  search: string,
  nav: { deviceMemory?: number; hardwareConcurrency?: number },
  coarse: boolean,
  saved: WorldTier | null = null,
  gpu: GpuClass = 'unknown'
): WorldTier {
  const q = new URLSearchParams(search).get('tier');
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  if (saved) return saved;
  // Software GL draws every pixel on the CPU; an integrated GPU does not carry sun shadows + MSAA (docs/02 §11).
  if (gpu === 'software') return 'low';
  const mem = nav.deviceMemory ?? null;
  const cores = nav.hardwareConcurrency ?? 4;
  if (coarse) return mem !== null && mem < 4 ? 'low' : 'mid';
  if (mem !== null && mem < 4) return 'low';
  const byCpu: WorldTier = cores >= 8 && (mem === null || mem >= 8) ? 'high' : 'mid';
  return byCpu === 'high' && gpu === 'integrated' ? 'mid' : byCpu;
}

function startSceneFrom(search: string): SceneId | undefined {
  const s = new URLSearchParams(search).get('scene');
  return s && (SCENE_IDS as readonly string[]).includes(s) ? (s as SceneId) : undefined;
}

function NoWorld(): React.ReactElement {
  const code = new URLSearchParams(location.search).get('code');
  // lite=1: /join keeps this device on the word cards (it sends 3D-capable devices to /world/ otherwise).
  const href = `/join?${code ? `code=${encodeURIComponent(code)}&` : ''}lite=1`;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C['paper-50'], padding: 16, fontFamily: T.fonts.ui }}>
      <div style={{ maxWidth: 420, background: C['paper-0'], border: `2px solid ${C['ink-900']}`, borderRadius: S.radiusCardPx, boxShadow: S.shadowDefault, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: T.scale.h3.sizePx }}>{W.noWebglTitle}</h1>
        <p style={{ margin: 0, color: C['ink-700'] }}>{W.noWebglBody}</p>
        <a href={href} style={{ alignSelf: 'flex-start', background: C['brand-d'], color: C['paper-0'], padding: '12px 16px', borderRadius: S.radiusButtonPx, border: `2px solid ${C['ink-900']}`, boxShadow: S.shadowDefault, fontWeight: 800, textDecoration: 'none' }}>
          {W.noWebglCta}
        </a>
      </div>
    </div>
  );
}

/** Wraps the dialog panel so opening pauses the world and the result plays the world's reward. */
function DialogHost(props: {
  Panel: AnyComponent;
  world: WorldHandle;
  npc: NpcRef;
  cfg: DialogConfig;
  submit: NonNullable<DialogConfig['submit']>;
  onClose: (lastResult: DialogResultLike | null) => void;
  recordClip?: boolean;
}): React.ReactElement {
  const { Panel, world, npc, cfg, submit, onClose } = props;
  useEffect(() => {
    world.setPaused(true);
    return () => world.setPaused(false);
  }, [world]);
  const play = useMemo(() => createResultPlayer(world), [world]);
  const last = useRef<DialogResultLike | null>(null);
  // The panel reports the window's best result once it is finished (완료, or ✕/Esc after a pass, docs/19 3장), and
  // then never calls onClose; the window ends here so a passed solo dialog can close (lesson hosts ignore onClose).
  const onDone = useCallback(
    (r: DialogResultLike, info?: { followUpsDone: boolean }) => {
      last.current = r;
      play(r);
      cfg.onDone?.(r, info);
      onClose(r);
    },
    [play, cfg, onClose]
  );
  const close = useCallback(() => {
    cfg.onClose?.();
    onClose(last.current);
  }, [cfg, onClose]);
  // The world frames the NPC in the part of the screen the dialog window leaves free: the strip above it (a bottom
  // sheet, ~60-70% of a portrait phone) or the strip left of it (the side panel on a landscape phone).
  useEffect(() => {
    if (!world.setViewInset) return;
    let obs: ResizeObserver | null = null;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector('.lcw-dlg__win');
      if (!el) return false;
      // offset* (layout box, not the slide-in transform): the overlay .lcw-dlg is fixed at 0,0, so these are viewport px
      const w = el as HTMLElement;
      const box = { left: w.offsetLeft, top: w.offsetTop, width: w.offsetWidth, height: w.offsetHeight };
      const inset = dialogViewInset(box, window.innerWidth, window.innerHeight);
      // rightPx: world api setViewInset(bottomPx, rightPx?) — engines that read only bottomPx ignore it.
      (world.setViewInset as ((bottomPx: number, rightPx?: number) => void) | undefined)?.call(world, inset.bottom, inset.right);
      return true;
    };
    const attach = () => {
      const el = document.querySelector('.lcw-dlg__win');
      if (!el) {
        raf = requestAnimationFrame(attach);
        return;
      }
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        obs = new ResizeObserver(() => measure());
        obs.observe(el);
      }
    };
    attach();
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      obs?.disconnect();
      window.removeEventListener('resize', measure);
      world.setViewInset?.(0);
    };
  }, [world]);
  // world api renderPreview (world lane): 3D thumbnails of the item and the NPC for the dialog preview (audit G02)
  const renderPreview = useMemo(() => {
    const r = (world as { renderPreview?: (req: unknown, size: number) => Promise<string | null> }).renderPreview;
    return r ? (req: unknown, size: number) => r.call(world, req, size) : undefined;
  }, [world]);
  return (
    <Panel
      npc={npc}
      {...(renderPreview ? { renderPreview } : {})}
      level={cfg.level ?? 'L1'}
      mode={cfg.mode ?? 'guided'}
      offers={cfg.offers ?? []}
      hint={cfg.hint ?? 'full'}
      {...(cfg.npcLine ? { npcLine: cfg.npcLine } : {})}
      {...(cfg.followUps ? { followUps: cfg.followUps } : {})}
      {...(cfg.followUpSubmit ? { followUpSubmit: cfg.followUpSubmit } : {})}
      {...(cfg.voiceCtx ? { voiceCtx: cfg.voiceCtx } : {})}
      submit={submit}
      onDone={onDone}
      onResult={play}
      onClose={close}
      recordClip={props.recordClip === true}
    />
  );
}

/**
 * The start flow (title → make my world → reveal, docs/08 §8.4 G07, Dan 11-16 R2555) opens unless the address is a
 * lesson (?code=, never blocked), this tab already holds a lesson session, or a test link names a scene (?scene=).
 */
export function startFlowFor(search: string, hasLessonSession: boolean): boolean {
  // a guest pass link (/world/?pass=) goes straight into the friend's world (docs/19 §8)
  // the teacher walking in from the console (?teach=) goes straight into the world too
  if (codeFromSearch(search) || hasLessonSession || passFromSearch(search) !== null || /[?&]teach=/.test(search)) return false;
  return !/[?&]scene=/.test(search);
}

export function App(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<WorldHandle | null>(null);
  const [dialogMod, setDialogMod] = useState<DialogModule | null>(null);
  const [lessonMod, setLessonMod] = useState<LessonModule | null>(null);
  const [reviewMod, setReviewMod] = useState<ReviewModule | null>(null);
  const [lessonOn, setLessonOn] = useState(false);
  const [readAloudMod, setReadAloudMod] = useState<ReadAloudModule | null>(null);
  const [room, setRoom] = useState<{ missing: Array<'light' | 'rest' | 'flat'>; sentence: string } | null>(null);
  // The kind the child last read aloud for (kept after the build screen closes, until the next room check).
  const [readKind, setReadKind] = useState<'light' | 'rest' | 'flat' | null>(null);
  const [soloNpc, setSoloNpc] = useState<NpcRef | null>(null);
  const [firstVisitMod, setFirstVisitMod] = useState<FirstVisitModule | null>(null);
  const [errand, setErrand] = useState<ErrandLike | null>(null);
  // The errand shape of a solo dialog is fixed when its window opens (a step it moves must not swap its sentences).
  const errandDialog = useRef<{ npc: NpcRef | null; ed: ErrandDialogLike | null }>({ npc: null, ed: null });
  const soloPlan = useRef<{ npc: NpcRef | null; plan: ReturnType<NonNullable<DialogModule['soloTalkPlan']>> | null }>({ npc: null, plan: null });
  const [failed, setFailed] = useState(false);
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [tooSlow, setTooSlow] = useState(false);
  const [seatCard, setSeatCard] = useState(false);
  const [startOpen, setStartOpen] = useState(() => startFlowFor(location.search, loadStudentSession() !== null));
  // The child's world details once they enter it (season, sky, animal friend); null until then and in a lesson.
  const [myLook, setMyLook] = useState<WorldSetupChoice | null>(null);
  // '수업 들어가기' saved a student session: a new key mounts the lesson layer again, which reads it at mount.
  const [lessonKey, setLessonKey] = useState(0);
  // A guest pass link (docs/19 §8): the friend's world for 30 minutes on the server clock.
  const passCode = useMemo(() => passFromSearch(location.search), []);
  // The teacher in the world (?teach=<lesson id> from the console, TeacherBar.tsx): lesson room as role 'teacher'.
  const teach = useMemo(() => teachFrom(location.search, browserStore()), []);
  /** The running pass session's token: the plot shown and built on is the host's while it is set. */
  const [passToken, setPassToken] = useState<string | null>(null);
  /** The host's world look while the pass runs; my own look comes back when it ends. */
  const [passLook, setPassLook] = useState<WorldSetupChoice | null>(null);
  const soloBlocked = soloPlayBlocked(identity);
  const lessonActive = useRef(false);
  const ok = useMemo(() => canRunWorld(), []);

  // Lesson code first, then a linked child device (guardian /link), else guest.
  useEffect(() => {
    let live = true;
    void resolveIdentity(location.search, browserStore(), (i, init) => globalThis.fetch(i, init)).then((id) => {
      if (live) setIdentity(id);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (world && identity?.kind === 'child' && identity.nickname) world.setPlayerName?.(identity.nickname);
  }, [world, identity]);

  // A lesson keeps the town's own look (daytime, no weather, no animal friend); my world shows its details.
  const lastLook = useRef<{ world: WorldHandle | null; key: string }>({ world: null, key: '' });
  useEffect(() => {
    if (!world || startOpen) return;
    const look = lessonOn ? null : (passLook ?? myLook);
    const key = JSON.stringify(look);
    if (lastLook.current.world === world && lastLook.current.key === key) return;
    lastLook.current = { world, key };
    world.setWorldLook?.(look);
  }, [world, startOpen, lessonOn, myLook, passLook]);

  const onLessonSession = useCallback((s: DeviceLessonSession) => {
    // the title closes either way; already in this lesson (a poll answered twice): keep the running layer
    setStartOpen(false);
    if (loadStudentSession()?.lessonId === s.lessonId) return;
    saveStudentSession(s);
    setLessonKey((k) => k + 1);
  }, []);

  // Building on my plot: saved for a linked child, look-only while the seat is paused, device-only for a guest; in a
  // lesson, saved with the student token once the join gave one (lessonOn flips when it is live). Same access twice
  // does not restart the save queue.
  const lastAccess = useRef<{ world: WorldHandle | null; key: string }>({ world: null, key: '' });
  useEffect(() => {
    if (!world?.setBuildAccess || !identity) return;
    const access = buildAccessOf(identity, identity.kind === 'lesson' || lessonOn ? storedStudentToken() : null, lessonOn, passToken);
    const key = JSON.stringify(access);
    if (lastAccess.current.world === world && lastAccess.current.key === key) return;
    lastAccess.current = { world, key };
    world.setBuildAccess(access);
  }, [world, identity, lessonOn, passToken]);

  // A solo write answered 403 seat_inactive (seat stopped mid-play): same card as play_allowed=false, not an error.
  useEffect(
    () =>
      onSeatInactive(() => {
        setIdentity((id) => withSeatStopped(id));
        setSoloNpc(null);
        setSeatCard(true);
      }),
    []
  );

  useEffect(() => {
    for (const load of Object.values(dialogLoaders)) void load().then(setDialogMod);
    for (const load of Object.values(lessonLoaders)) void load().then(setLessonMod);
    for (const load of Object.values(reviewLoaders)) void load().then(setReviewMod);
    for (const load of Object.values(readAloudLoaders)) void load().then(setReadAloudMod);
    for (const load of Object.values(firstVisitLoaders)) void load().then(setFirstVisitMod);
  }, []);

  useEffect(() => {
    if (!ok || !canvasRef.current) return;
    let handle: WorldHandle | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const saved = savedTier();
    const tier = pickTier(location.search, nav, matchMedia('(pointer: coarse)').matches, saved, gpuClassOf(readGpuRenderer()));
    // ?tier= (headless checks) or a quality picked in settings pins the tier; otherwise the world measures itself
    // (G14 'auto'; the settings screen changes it live through setGraphics).
    const pinned = new URLSearchParams(location.search).has('tier') || saved !== null;
    const graphics = { quality: pinned ? tier : ('auto' as const), viewChunks: null, shadows: null, renderScale: null };
    createWorld({ canvas: canvasRef.current, tier, startScene: startSceneFrom(location.search), hudRoot: hudRef.current ?? undefined, graphics })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        setWorld(h);
        (window as unknown as { __lcwWorld?: WorldHandle }).__lcwWorld = h;
      })
      .catch((err: unknown) => {
        console.error('world failed to start', err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [ok]);

  // Multi room (docs/03 D11): lesson students meet in their lesson's room, linked children in their family's. The
  // token is read on every (re)connect, so a lesson joined after the world opened is picked up by the next retry.
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const passTokenRef = useRef(passToken);
  passTokenRef.current = passToken;
  // a live lesson seats the child in the teacher's room: the pass (host's room) never goes first then (review R325)
  const lessonOnRef = useRef(lessonOn);
  lessonOnRef.current = lessonOn;
  const [roomClient, setRoomClient] = useState<RoomClient | null>(null);
  useEffect(() => {
    if (!world?.multi || !world.multiPose) return;
    const sink = world.multi;
    const room = new RoomClient({
      // Lesson student token first, then the child's device token: an expired lesson token left in this tab answers
      // {room:null} and the device token still finds the family room in the same attempt.
      token: () => {
        if (teach) return teach.token;
        const st = storedStudentToken();
        const id = identityRef.current;
        return [st && st.length >= 32 ? st : null, id?.kind === 'child' ? id.token : null];
      },
      ...(teach ? { ticketBody: () => teachTicketBody(teach) } : {}),
      // a friend on a guest pass sits in the host's room (R325)
      passToken: () => (teach || lessonOnRef.current ? null : passTokenRef.current),
      source: { pose: () => world.multiPose?.() ?? null },
      sink
    });
    room.start();
    // R326: blocks changed here reach the others in this world (a friend on a pass and the host)
    const offRelay = world.onBlockRelay?.((tag, c) => room.sendBlocks(tag, c.cells, c.furniture));
    (window as unknown as { __lcwRoom?: RoomClient }).__lcwRoom = room;
    setRoomClient(room);
    // The same person in two tabs holds one seat (the newer tab wins, close 4009): coming back to this tab takes
    // the seat back here, so the tab being looked at is the one in the room.
    const back = (): void => {
      if (document.visibilityState === 'visible') room.takeOver();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
      offRelay?.();
      setRoomClient(null);
      room.stop();
    };
    // a pass starting or ending moves this page to (or out of) the host's room at once
  }, [world, identity?.kind, teach, passToken, lessonOn]);

  // A device that cannot carry 3D even at the lowest resolution hands the lesson to the word cards (same session).
  useEffect(() => {
    if (!world) return;
    const watch = new FrameFloorWatch();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const s = world.getStats?.();
      if (!s) return;
      const floor = TIER_SETTINGS[s.tier ?? 'mid'].minScale;
      if (watch.sample(s.fps, (s.renderScale ?? floor) <= floor + 0.001)) {
        setTooSlow(true);
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [world]);

  // Solo play: after a guide names a place, walk there once the window is closed.
  const closeSolo = useCallback(
    (npc: NpcRef, last: DialogResultLike | null) => {
      setSoloNpc(null);
      const dest = last ? guideDestination(npc, last) : null;
      if (dest && world && !lessonActive.current) void world.goToScene(dest);
    },
    [world]
  );

  // Seat stopped: say so once when the world opens (and again on every NPC tap), while the world stays walkable.
  useEffect(() => {
    if (soloBlocked && world) setSeatCard(true);
  }, [soloBlocked, world]);
  useEffect(() => {
    if (!world || !seatCard) return;
    world.setPaused(true);
    return () => world.setPaused(false);
  }, [world, seatCard]);
  // Build screen room check → read-aloud discount line (when the world reports one).
  useEffect(() => {
    if (!world?.onRoomCheck) return;
    return world.onRoomCheck((r) => setRoom(r.missing.length > 0 ? r : null));
  }, [world]);

  // Solo play: tapping an NPC opens the dialog panel when no lesson is running.
  useEffect(() => {
    if (!world) return;
    return world.onNpcInteract((npc) => {
      // In a lesson the talk is the lesson's dialog window: a click, tap or E on an NPC opens it again (it was a dead
      // tap, Dan 11-16 R2625).
      if (lessonActive.current) {
        // the lesson layer answers a passer-by with LESSON_FREE_TALK_EVENT (Dan 11-19): this NPC's free talk opens then.
        // `free` says whether this app can open one at all (a paused seat or a dialog module not loaded yet cannot):
        // without it the layer leaves its window alone instead of folding it for nothing.
        lessonTapNpc.current = npc;
        const free = !soloBlocked && Boolean(dialogMod?.DialogPanel && dialogMod.createSoloSubmit);
        window.dispatchEvent(new CustomEvent(LESSON_TALK_EVENT, { detail: { npcId: npc.id, free } }));
        return;
      }
      if (soloBlocked) {
        setSeatCard(true);
        return;
      }
      if (dialogMod?.DialogPanel && dialogMod.createSoloSubmit) setSoloNpc(npc);
    });
  }, [world, dialogMod, soloBlocked]);

  // A free talk with a passer-by during a lesson (Dan 11-19 "자유도도 없앴다"): the lesson layer folded its window and
  // asks for this NPC's own window. A stage move closes it again, so the next stage's lesson window is not hidden
  // behind it; the lesson ending closes it too.
  const lessonTapNpc = useRef<NpcRef | null>(null);
  useEffect(() => {
    const free = (e: Event): void => {
      const id = (e as CustomEvent<{ npcId?: string }>).detail?.npcId;
      const npc = lessonTapNpc.current;
      if (!npc || npc.id !== id || soloBlocked) return;
      if (dialogMod?.DialogPanel && dialogMod.createSoloSubmit) setSoloNpc(npc);
    };
    const stage = (): void => {
      if (lessonActive.current) setSoloNpc(null);
    };
    window.addEventListener(LESSON_FREE_TALK_EVENT, free);
    window.addEventListener(LESSON_STAGE_EVENT, stage);
    return () => {
      window.removeEventListener(LESSON_FREE_TALK_EVENT, free);
      window.removeEventListener(LESSON_STAGE_EVENT, stage);
    };
  }, [dialogMod, soloBlocked]);

  // R2625 ⑤: the world marks the NPC the errand needs next (the giver to start and to hand over, the cafe to order); the
  // lesson layer marks its own NPC while a lesson runs. After the errand the town goal chain (dialog lane, goals.ts)
  // owns the mark: this lets go once, when the errand turns done, in a layout effect so the chain's own (passive)
  // effect of the same render lands after it.
  const errandGoalWas = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!world?.setGoalNpc || lessonOn) return;
    const want = errandGoalNpc(errand?.state ?? null);
    if (want === null && errandGoalWas.current === null) return;
    errandGoalWas.current = want;
    world.setGoalNpc(want);
  }, [world, errand?.state, lessonOn]);

  const renderDialog = useCallback(
    (npc: NpcRef, cfg: DialogConfig): React.ReactNode => {
      const Panel = dialogMod?.DialogPanel;
      if (!Panel || !world) return null;
      const submit = cfg.submit ?? dialogMod?.createSoloSubmit?.(npc, soloPlayerOf(identity));
      if (!submit) return null;
      return (
        <DialogHost key={npc.id} Panel={Panel} world={world} npc={npc} cfg={cfg} submit={submit} onClose={() => undefined} recordClip={recordClipFor(identity)} />
      );
    },
    [dialogMod, world, identity]
  );

  if (!ok || failed) return <NoWorld />;
  const Lesson = lessonMod?.LessonLayer;
  const SoloPanel = dialogMod?.DialogPanel;
  const soloLevel = identity?.kind === 'child' ? identity.level : undefined;
  // docs/03 D1 first-visit errand: the giver (the neighbour at the cafe door) and the cafe speak the errand's sentences while it runs.
  if (errandDialog.current.npc !== soloNpc) {
    errandDialog.current = {
      npc: soloNpc,
      // a free talk inside a lesson is plain talk: the errand does not move during a lesson (Dan 11-19 review)
      ed: soloNpc && !lessonOn && firstVisitMod?.errandDialogFor ? firstVisitMod.errandDialogFor(soloNpc, errand, soloLevel ?? 'L1') : null
    };
  }
  const ed = errandDialog.current.ed;
  const dialogNpc = ed?.npc ?? soloNpc;
  // R2625: a plain solo window opens with this visit's line (not the same greeting every time) and, every fifth talk,
  // asks one open question after the pass (docs/04 4.10). Taken once per opened window.
  if (soloPlan.current.npc !== soloNpc) {
    soloPlan.current = {
      npc: soloNpc,
      plan: soloNpc && !ed && dialogMod?.soloTalkPlan ? dialogMod.soloTalkPlan(soloNpc, soloLevel ?? 'L1') : null
    };
  }
  const plan = soloPlan.current.plan;
  const soloSubmit = dialogNpc && dialogMod?.createSoloSubmit ? dialogMod.createSoloSubmit(dialogNpc, soloPlayerOf(identity)) : null;
  // docs/03 D13: while the room lacks a kind of furniture (or the child just read it aloud), Toby sells that kind.
  const shopKind = room?.missing[0] ?? readKind;
  const shopOffers =
    soloNpc?.ctx === 'trade_shop' && shopKind && readAloudMod?.furnitureOffersFor ? readAloudMod.furnitureOffersFor(shopKind, soloLevel ?? 'L1') : [];
  const soloCfg: DialogConfig = {
    ...(soloLevel ? { level: soloLevel } : {}),
    ...(shopOffers.length > 0 ? { offers: shopOffers } : {}),
    ...(plan ? { npcLine: plan.npcLine, ...(plan.offers ? { offers: plan.offers } : {}), ...(plan.followUps ? { followUps: plan.followUps } : {}), ...(plan.followUpSubmit ? { followUpSubmit: plan.followUpSubmit } : {}) } : {}),
    ...(ed ? { offers: ed.offers, npcLine: ed.npcLine, ...(ed.voiceCtx ? { voiceCtx: ed.voiceCtx } : {}) } : {}),
    onDone: (r) => {
      if (dialogNpc) dialogMod?.noteSoloDone?.(dialogNpc.ctx, r);
      const step = r.errand;
      if (step) setErrand((prev) => (prev && prev.state !== step.state ? { ...prev, state: step.state } : prev));
      // handed over: the server already moved the drink out of the bag (given); the hand and slot follow
      if (step?.state === 'done' && errand && typeof errand.item_key === 'string') world?.takeItem?.(errand.item_key);
    }
  };
  const FirstVisit = firstVisitMod?.FirstVisitGuide;
  const MicGate = firstVisitMod?.MicCheckGate;
  const Review = reviewMod?.ReviewDock;
  const ReadAloud = readAloudMod?.ReadAloudPrompt;
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: C['paper-50'], touchAction: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>
          {/* the title screen holds the whole screen: the menu button and keys step aside like for a dialog */}
          <FrameLayer world={world} identity={identity} lessonOn={lessonOn} teacher={!!teach} dialogOpen={dialogNpc !== null || startOpen} />
          {/* The title is the whole screen: no lesson-layer button over it (a ?code= address never opens the title). */}
          {world && teach ? <TeacherBar world={world} session={teach} room={roomClient} /> : null}
          {Lesson && !startOpen && !teach ? (
            <Lesson
              key={lessonKey}
              world={world}
              identity={identity ?? undefined}
              canRender3d={!tooSlow}
              renderDialog={renderDialog}
              freeTalkOpen={lessonOn && soloNpc !== null}
              onLessonActive={(a: boolean) => {
                // a free talk opened in the lesson closes with it (only on live → over, never on the first report)
                if (!a && lessonActive.current) setSoloNpc(null);
                lessonActive.current = a;
                setLessonOn(a);
                world?.setLessonBadge?.(a);
              }}
            />
          ) : null}
          {passCode !== null && !codeFromSearch(location.search) ? <GuestPassLayer
              code={passCode}
              world={world}
              canWalk={() => !lessonActive.current}
              onActive={(token, look) => {
                setPassToken(token);
                if (!token) setPassLook(null);
                else if (look) setPassLook(look);
              }}
            /> : null}
          {startOpen ? (
            <StartFlow
              world={world}
              identity={identity}
              onPlay={(w) => {
                setMyLook(w ?? DEFAULT_WORLD_CHOICE);
                setStartOpen(false);
              }}
              onLessonSession={onLessonSession}
            />
          ) : null}
          {!startOpen && identity?.kind === 'child' ? (
            <LessonAutoJoin identity={identity} onLessonSession={onLessonSession} />
          ) : null}
          {Review && identity && identity.kind !== 'guest' && !soloBlocked && !startOpen ? (
            <Review world={world} player={soloPlayerOf(identity)} hidden={lessonOn || soloNpc !== null} />
          ) : null}
          {soloBlocked && world && !lessonOn && !startOpen ? <SeatPausedChip onOpen={() => setSeatCard(true)} /> : null}
          {soloBlocked && world && !lessonOn && seatCard ? <SeatPausedCard onClose={() => setSeatCard(false)} /> : null}
          {ReadAloud && room && !lessonOn && !soloBlocked && soloNpc === null && !startOpen ? (
            <div style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)' }}>
              <ReadAloud
                key={`${room.missing[0]}|${room.sentence}`}
                kind={room.missing[0]!}
                sentence={room.sentence}
                player={soloPlayerOf(identity)}
                onResult={(r) => {
                  if (r.pass) setReadKind(room.missing[0]!);
                }}
              />
            </div>
          ) : null}
          {MicGate && world && identity && !teach ? (
            <MicGate identityKind={identity.kind} lessonCode={identity.kind === 'lesson' ? identity.code : undefined} hidden={soloNpc !== null || startOpen} />
          ) : null}
          {/* children run the errand, then the town goals; guests (no errand) start on the town goals (dialog/goals.ts) */}
          {FirstVisit && (identity?.kind === 'child' || (identity?.kind === 'guest' && !passToken)) && !soloBlocked ? (
            <FirstVisit world={world} player={soloPlayerOf(identity)} errand={errand} onErrand={setErrand} hidden={lessonOn || soloNpc !== null || startOpen} />
          ) : null}
          {world && !soloBlocked && SoloPanel && soloNpc && dialogNpc && soloSubmit ? (
            <DialogHost
              Panel={SoloPanel}
              world={world}
              npc={dialogNpc}
              cfg={soloCfg}
              submit={soloSubmit}
              onClose={(last) => closeSolo(dialogNpc, last)}
              recordClip={recordClipFor(identity)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
