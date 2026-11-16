/**
 * App shell (docs/19 1장, world domain): full-screen 3D world plus the two slots other domains fill —
 * the dialog panel (`dialog/DialogPanel.tsx`, docs/19 3장) and the lesson layer (`lesson/LessonLayer.tsx`, docs/19 4장).
 * A slot whose module is not in the build yet stays empty; when it lands, Vite picks it up with no edit here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Level } from '@lcw/schemas';
import { canRunWorld, createWorld, SCENE_IDS, type NpcRef, type SceneId, type WorldHandle, type WorldTier } from './world/api.js';
import { WORLD_STRINGS as W } from './world/strings.js';
import { resolveIdentity, browserStore, storedStudentToken, type PlayerIdentity } from './world/identity.js';
import { onSeatInactive } from './world/seat.js';
import type { BuildAccess } from './world/api.js';
import { FrameFloorWatch, TIER_SETTINGS } from './world/tiers.js';
import { SeatPausedCard, SeatPausedChip } from './world/SeatNotice.js';
import { FrameLayer } from './frame/FrameLayer.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';

/** What a dialog needs besides the NPC (docs/19 3장 DialogPanelProps without npc/onClose). */
export interface DialogConfig {
  level?: Level;
  mode?: 'free' | 'guided' | 'read' | 'recall';
  offers?: Array<{ stars: 1 | 2 | 3; text: string; hintTags: string[] }>;
  hint?: 'full' | 'keyword' | 'initial' | 'picture' | 'none';
  submit?: (u: unknown) => Promise<DialogResultLike>;
  onDone?: (r: DialogResultLike) => void;
  onClose?: () => void;
  /** The NPC's opening line in the window (a lesson stage's script); absent = the NPC's own greeting. */
  npcLine?: string;
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
export function buildAccessOf(id: PlayerIdentity | null, studentToken: string | null, lessonLive = false): BuildAccess {
  // A lesson joined without a code in the address (/join hand-off, or the code typed in the world) is live with this
  // tab's student token: building saves to the student, never to a linked child's plot on the same tablet.
  if ((id?.kind === 'lesson' || lessonLive) && studentToken && studentToken.length >= 32) return { kind: 'saved', token: studentToken, lesson: true };
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
  const side = r.height >= vh * 0.9 && r.width < vw * 0.8;
  if (side) return { bottom: 0, right: Math.max(0, Math.round(vw - r.left)) };
  return { bottom: Math.max(0, Math.round(vh - r.top)), right: 0 };
}

export function createResultPlayer(world: Pick<WorldHandle, 'celebrate' | 'giveItem'> & { setCoins?: WorldHandle['setCoins'] }): (r: DialogResultLike) => void {
  let best = -1;
  const given = new Set<string>();
  return (r) => {
    if (typeof r.coinsTotal === 'number') world.setCoins?.(r.coinsTotal);
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

export function pickTier(search: string, nav: { deviceMemory?: number; hardwareConcurrency?: number }, coarse: boolean): WorldTier {
  const q = new URLSearchParams(search).get('tier');
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  const mem = nav.deviceMemory ?? null;
  const cores = nav.hardwareConcurrency ?? 4;
  if (coarse) return mem !== null && mem < 4 ? 'low' : 'mid';
  if (mem !== null && mem < 4) return 'low';
  return cores >= 8 && (mem === null || mem >= 8) ? 'high' : 'mid';
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
    (r: DialogResultLike) => {
      last.current = r;
      play(r);
      cfg.onDone?.(r);
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
      submit={submit}
      onDone={onDone}
      onResult={play}
      onClose={close}
      recordClip={props.recordClip === true}
    />
  );
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
  const [failed, setFailed] = useState(false);
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [tooSlow, setTooSlow] = useState(false);
  const [seatCard, setSeatCard] = useState(false);
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

  // Building on my plot: saved for a linked child, look-only while the seat is paused, device-only for a guest; in a
  // lesson, saved with the student token once the join gave one (lessonOn flips when it is live). Same access twice
  // does not restart the save queue.
  const lastAccess = useRef<{ world: WorldHandle | null; key: string }>({ world: null, key: '' });
  useEffect(() => {
    if (!world?.setBuildAccess || !identity) return;
    const access = buildAccessOf(identity, identity.kind === 'lesson' || lessonOn ? storedStudentToken() : null, lessonOn);
    const key = JSON.stringify(access);
    if (lastAccess.current.world === world && lastAccess.current.key === key) return;
    lastAccess.current = { world, key };
    world.setBuildAccess(access);
  }, [world, identity, lessonOn]);

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
    const tier = pickTier(location.search, nav, matchMedia('(pointer: coarse)').matches);
    createWorld({ canvas: canvasRef.current, tier, startScene: startSceneFrom(location.search), hudRoot: hudRef.current ?? undefined })
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
      if (lessonActive.current) return;
      if (soloBlocked) {
        setSeatCard(true);
        return;
      }
      if (dialogMod?.DialogPanel && dialogMod.createSoloSubmit) setSoloNpc(npc);
    });
  }, [world, dialogMod, soloBlocked]);

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
      ed: soloNpc && firstVisitMod?.errandDialogFor ? firstVisitMod.errandDialogFor(soloNpc, errand, soloLevel ?? 'L1') : null
    };
  }
  const ed = errandDialog.current.ed;
  const dialogNpc = ed?.npc ?? soloNpc;
  const soloSubmit = dialogNpc && dialogMod?.createSoloSubmit ? dialogMod.createSoloSubmit(dialogNpc, soloPlayerOf(identity)) : null;
  // docs/03 D13: while the room lacks a kind of furniture (or the child just read it aloud), Toby sells that kind.
  const shopKind = room?.missing[0] ?? readKind;
  const shopOffers =
    soloNpc?.ctx === 'trade_shop' && shopKind && readAloudMod?.furnitureOffersFor ? readAloudMod.furnitureOffersFor(shopKind, soloLevel ?? 'L1') : [];
  const soloCfg: DialogConfig = {
    ...(soloLevel ? { level: soloLevel } : {}),
    ...(shopOffers.length > 0 ? { offers: shopOffers } : {}),
    ...(ed ? { offers: ed.offers, npcLine: ed.npcLine } : {}),
    onDone: (r) => {
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
          <FrameLayer world={world} identity={identity} />
          {Lesson ? (
            <Lesson
              world={world}
              identity={identity ?? undefined}
              canRender3d={!tooSlow}
              renderDialog={renderDialog}
              onLessonActive={(a: boolean) => {
                lessonActive.current = a;
                setLessonOn(a);
                world?.setLessonBadge?.(a);
              }}
            />
          ) : null}
          {Review && identity && identity.kind !== 'guest' && !soloBlocked ? (
            <Review world={world} player={soloPlayerOf(identity)} hidden={lessonOn || soloNpc !== null} />
          ) : null}
          {soloBlocked && world && !lessonOn ? <SeatPausedChip onOpen={() => setSeatCard(true)} /> : null}
          {soloBlocked && world && !lessonOn && seatCard ? <SeatPausedCard onClose={() => setSeatCard(false)} /> : null}
          {ReadAloud && room && !lessonOn && !soloBlocked && soloNpc === null ? (
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
          {MicGate && world && identity ? (
            <MicGate identityKind={identity.kind} lessonCode={identity.kind === 'lesson' ? identity.code : undefined} hidden={soloNpc !== null} />
          ) : null}
          {FirstVisit && identity?.kind === 'child' && !soloBlocked ? (
            <FirstVisit world={world} player={soloPlayerOf(identity)} errand={errand} onErrand={setErrand} hidden={lessonOn || soloNpc !== null} />
          ) : null}
          {world && !soloBlocked && SoloPanel && soloNpc && dialogNpc && soloSubmit ? (
            <DialogHost
              Panel={SoloPanel}
              world={world}
              npc={dialogNpc}
              cfg={soloCfg}
              submit={soloSubmit}
              onClose={(last) => closeSolo(soloNpc, last)}
              recordClip={recordClipFor(identity)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
