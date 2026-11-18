/**
 * World domain -> other client domains (docs/19 2장). Dialog and lesson code depend only on this file.
 * The required members match docs/19 exactly; the optional ones are additions recorded there in the same PR.
 */
import type { NpcContext } from '@lcw/schemas';
import type { NpcLook } from './town.js';
import type { KeyHintLabels } from './strings.js';

export type SceneId = 'plaza' | 'honey_cafe' | 'trade_shop' | 'build_plot' | 'open_hill';

export interface NpcRef {
  id: string;
  ctx: NpcContext;
  nameKo: string;
  nameEn: string;
}

export type DirectorEventKind =
  | 'weather_shift'
  | 'blackout'
  | 'npc_prompt'
  | 'mentor_dungeon_gate'
  | 'review_chest'
  | 'star_celebration';

export type WorldTier = 'low' | 'mid' | 'high';

export interface WorldStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  chunksMeshed: number;
  chunksVisible: number;
  scene: SceneId;
  player: { x: number; y: number; z: number };
  /** While a dialog pauses the world: the NPC and where its face lands on screen (CSS px). */
  dialogShot?: { npc: string; face: [number, number] } | null;
  /** current dynamic-resolution scale (1 = tier scale x devicePixelRatio) */
  renderScale?: number;
  /** tier the world runs at (with quality 'auto', what the frame-time check settled on) */
  tier?: WorldTier;
  /** quality 'auto' only: the tier the frame-time check picked (null while it is still measuring) */
  autoTier?: WorldTier | null;
  /** graphics actually in use (G14 settings applied over the tier) */
  graphics?: { viewChunks: number; shadows: boolean; renderScale: number };
  /** other people drawn from the multi room */
  peers?: number;
  /** start-up phases in ms since createWorld (town, atlas, characters, mesh, firstFrame) */
  startup?: Record<string, number>;
  /**
   * Chunks (and region merges) still missing: `near` = around the player (FIRST_RING, what the first screen and every
   * scene arrival wait for), `view` = the whole view distance. 0 / 0 = the ground is complete.
   */
  ground?: { near: number; view: number };
  /** the last scene jump: how long the fade card waited for the ground at the new spot */
  arrival?: { scene: SceneId; groundMs: number };
  /** building on my plot (headless checks): mode, carried stacks, sync queue, current aim, last room check */
  build?: Record<string, unknown>;
  /**
   * Talking to NPCs (R2625 real-play check): the NPC E would talk to, the goal NPC (errand step), whether the talk prompt
   * shows, NPCs talked to in this visit, talks opened by E / the talk button and by a click or tap.
   */
  interact?: { near: string | null; goal: string | null; prompt: boolean; promptWhy: string; paused: boolean; walking: boolean; talked: string[]; byKey: number; byTap: number };
  /** Talkable NPCs drawn now: where their body centre lands on screen (CSS px) and how far they stand (m). */
  npcView?: Array<{ id: string; sx: number; sy: number; vis: boolean; dist: number }>;
  /** Jumps pressed, jumps nobody pressed, whole-block climbs without a jump, the eye height of body and camera. */
  motion?: { jumps: number; unpressedJumps: number; autoClimbs: number; autoJump: boolean; bodyY: number; camY: number };
}

export interface WorldHandle {
  goToScene(id: SceneId): Promise<void>; // 걸어가거나 문을 지나는 연출 포함
  /** Teacher in the world: stand two metres in front of the nearest person in the room (of a role); false = nobody placed. */
  goNearPeer?(role?: string): Promise<boolean>;
  onNpcInteract(cb: (npc: NpcRef) => void): () => void; // E 키·탭으로 NPC에게 말 걸기
  npcSay(npcId: string, text: string, opts?: { possessed?: boolean }): void; // 말풍선(빙의 중엔 반짝임)
  playerSay(text: string): void;
  giveItem(itemKey: string): void; // 주문한 음료·교환한 물건이 손/슬롯에
  /**
   * The item left the child (handed to an NPC, e.g. the errand water): its slot empties and, if it was in hand, the
   * hand too. False when no slot held it. Shells call it after the server already moved the item.
   */
  takeItem?(itemKey: string): boolean;
  /**
   * The bag as the server keeps it (frame domain reads GET /v1/items): slot i shows keys[i], quietly (no toast, no
   * sparkle). A thing in hand that left the bag leaves the hand too.
   */
  setBag?(keys: ReadonlyArray<string | null>): void;
  /** The player's look (skin, hair, clothes) for the mirror screen (G04), which draws its own small copy. */
  getPlayerLook?(): NpcLook;
  /** The child picked a hotbar slot that holds a thing (key, 1~5, tap). Returns an unsubscribe. */
  onHold?(cb: (itemKey: string) => void): () => void;
  /** 별 연출·효과음. `add` = how many stars the HUD chip gains (default `stars`; a retry that beats 1 star with 2 adds 1). */
  celebrate(stars: 0 | 1 | 2 | 3, opts?: { add?: number }): void;
  setGoal(goalKo: string, targetEn?: string): void; // 화면 맨 위 목표 한 줄
  setPaused(paused: boolean): void; // 대화창이 열리면 이동 멈춤
  dispose(): void;

  // Optional additions (docs/19 2장 "선택"):
  /** Mark the NPC the teacher is speaking through (sparkle + bubble border); null clears. */
  setPossessed?(npcId: string | null): void;
  /** Teacher console events (docs/10 2장): weather, blackout, prompt, gate, chest, stars. */
  playDirectorEvent?(kind: DirectorEventKind, detail: string): void;
  /** Current scene. */
  getScene?(): SceneId;
  /** All talkable NPCs. */
  listNpcs?(): NpcRef[];
  /**
   * Small "수업 중" tag on the HUD (docs/08 8.1). It also marks the lesson as live: solo-only NPCs (the errand giver)
   * step out, so E and taps reach only the lesson's NPCs.
   */
  setLessonBadge?(on: boolean): void;
  /**
   * The teacher's name tag next to the lesson tag: present → "<name> 함께", absent → "혼자 놀기" (the teacher console
   * stopped beating). null = no lesson (the plain lesson tag rules). While present, the teacher's avatar with a name
   * plate also stands near the child in their world (world/visitor.ts, Dan 11-16 12:10; NPC id 'teacher' for npcSay
   * and dialogs).
   */
  setTeacher?(t: { present: boolean; name: string | null } | null): void;
  /**
   * Walk up to an NPC and face it, about 1.5 m in front (inside the talk range): the NPC's scene first when it is
   * far. Resolves on arrival (a dialog pausing the world ends the walk where it is). Unknown or hidden NPCs: no-op.
   */
  walkToNpc?(npcId: string): Promise<void>;
  /** Coin balance from the server ledger (dialog `coinsTotal`, lesson sync); null hides it. */
  setCoins?(total: number | null): void;
  /** Server reachable? false shows the HUD band "혼자 모드로 계속 중" (docs/08 G01); the world keeps running. */
  setOnline?(on: boolean): void;
  /** Player settings G14 (frame/settings.ts): drag-to-look speed for mouse and touch (1 = default), up/down inverted. */
  setLookSettings?(o: { mouse: number; touch: number; invertY: boolean; autoJump?: boolean }): void;
  /**
   * The NPC the child should talk to next (the errand step, docs/03 D1), or null. It gets a marker over its head and
   * keeps its talk prompt; an NPC already talked to in this visit stops showing the prompt (E and taps still work).
   */
  setGoalNpc?(npcId: string | null): void;
  /** G14 움직임 줄이기 (docs/08 5장): burst and star effects off. Starts from the device's prefers-reduced-motion. */
  setReduceMotion?(on: boolean): void;
  /** G14: the frame counter in the HUD corner (also on with ?fps). */
  setShowFps?(on: boolean): void;
  /** key names in the HUD help lines and the talk prompt (the player's remapped keys) */
  setKeyHints?(k: KeyHintLabels): void;
  /** the child picked the slot already in hand again: use that thing (G01 eat / drink) */
  onUse?(cb: (itemKey: string) => void): () => void;
  /** G01 gauges on the status chip; null hides them */
  setGauges?(g: { hunger: number; thirst: number; lowHunger: boolean; lowThirst: boolean; slow: boolean } | null): void;
  /** walking speed multiplier (0.3..1) and whether running is allowed (G01 low gauges, docs/03 D1) */
  setMove?(mult: number, canRun: boolean): void;
  /** a one-off line over the hotbar (same place as the slot caption) */
  notice?(text: string): void;
  /**
   * Map read-out for the map screen (docs/08 G06): sectors (one town sector until world generation lands, then the
   * 3 x 3 sectors), the walkable places, and where the player stands. World coordinates in metres.
   */
  getMap?(): WorldMapInfo;
  /**
   * Star chip from an outside count (a lesson's stars, server-summed): the chip shows this number and celebrate()
   * no longer adds to it, so a star is never counted twice. null hands the chip back to celebrate().
   */
  setStars?(total: number | null): void;
  /** Linked child's nickname shown over the player (null = guest, no plate). The guide greets them by name once. */
  setPlayerName?(name: string | null): void;
  /**
   * Pixels at the bottom of the canvas covered by a panel (the dialog window, ~70% of a phone screen). While a
   * dialog frames the NPC the shot is centred in the strip above it; 0 = nothing covers the world.
   */
  setViewInset?(bottomPx: number, rightPx?: number): void;
  /** Start flow title screen: the camera circles the town, the HUD hides, the world takes no input (false = play). */
  setAttract?(on: boolean): void;
  /** The child's world details (G07, packages/content world-setup.ts): season weather, sky time, animal friend; null = none. */
  setWorldLook?(look: import('@lcw/content').WorldSetupChoice | null): void;
  /**
   * Talk lane G02: a transparent square PNG (data URL) of a thing the sentence gets (the mesh `giveItem` puts in hand)
   * or of an NPC's head and shoulders, drawn with the world's own meshes and cached per (req, size); null when the
   * key is unknown or drawing fails (the dialog keeps its emoji).
   */
  renderPreview?(req: { kind: 'item'; itemKey: string; modifier?: string } | { kind: 'npc'; npcId: string }, sizePx: number): Promise<string | null>;
  /**
   * Who may build on my plot and where it is saved (docs/03 D13, WP-207). Default `local`: a guest builds on this
   * device only. `saved`: the linked child's device token; the server re-judges and keeps every edit. `paused`: the
   * seat stopped solo play (look, don't build).
   */
  setBuildAccess?(access: BuildAccess): void;
  /**
   * Build screen room check (docs/03 D13, docs/08 8.3): on placing a nameplate and 1 s after the room changes. What
   * the room still misses as furniture kinds, and the English sentence shown for it; the dialog domain puts its
   * read-aloud discount line under it. Returns an unsubscribe.
   */
  onRoomCheck?(cb: (r: RoomCheckInfo) => void): () => void;
  /** Performance and position read-out (headless checks, tier auto-detect). */
  getStats?(): WorldStats;
  /**
   * G14 화면 설정 (frame/settings.ts owns the screen and the saved record; the world applies it at once, no restart).
   * null fields follow the tier. quality 'auto' measures frame time for the first seconds and settles on a tier,
   * then steps down one tier when frames stay slow at the lowest resolution.
   */
  setGraphics?(g: GraphicsSettings): void;
  /** Multi room (world/room-client.ts): the local player's pose to send (x, y, z, yaw, anim) */
  multiPose?(): readonly [number, number, number, number, number] | null;
  /** Multi room: the other people to draw */
  multi?: import('./room-client.js').RoomSink;
}

/** G14 graphics (docs/08 6.6 tiers). Ranges: viewChunks 3..8, renderScale 0.5..1 (times devicePixelRatio). */
export interface GraphicsSettings {
  quality: 'auto' | WorldTier;
  viewChunks: number | null;
  shadows: boolean | null;
  renderScale: number | null;
}

export interface WorldMapInfo {
  /** side of the square world in metres */
  size_m: number;
  sectors: Array<{
    id: string;
    nameKo: string;
    /** zone kind for the legend (docs/08 2.3 구역): town, biome, ruin, plot, or a later kind */
    kind: 'town' | 'biome' | 'ruin' | 'plot' | (string & {});
    /** not yet visited: the map draws a silhouette (docs/08 G06) */
    explored: boolean;
    /** [x0, z0, x1, z1] */
    rect: [number, number, number, number];
  }>;
  scenes: Array<{ id: SceneId; nameKo: string; x: number; z: number }>;
  player: { x: number; z: number; yaw: number };
}

export type BuildAccess =
  | { kind: 'local' }
  | { kind: 'paused' }
  /**
   * `lesson`: the token is the lesson student's own (saved to that child's plot, never seat-gated, no showroom: the
   * showroom belongs to a linked device). A lesson never saves with the device token of whoever this tablet is linked to.
   */
  | { kind: 'saved'; token: string; base?: string; lesson?: true }
  /**
   * A friend on a guest pass (docs/19 §8): the token is the pass session, the plot is the host child's. The server lets
   * the friend place with the host's carried blocks and break only what the friend placed ('not_yours' otherwise).
   */
  | { kind: 'saved'; token: string; base?: string; pass: true };

export interface RoomCheckInfo {
  /** furniture kinds the room still needs (empty when only the shape is wrong, or the room is complete) */
  missing: Array<'light' | 'rest' | 'flat'>;
  /** target-language sentence for the first need, or the "ready" line */
  sentence: string;
  ok: boolean;
  /** resident who may move in (English name), when the room is complete with job furniture */
  resident: string | null;
}

export interface CreateWorldOptions {
  canvas: HTMLCanvasElement;
  tier: WorldTier;
  /** Scene to start in (default plaza). */
  startScene?: SceneId;
  /** Element that hosts the world HUD; defaults to the canvas parent. */
  hudRoot?: HTMLElement;
  /** G14 graphics at start (default: fixed at `tier`); 'auto' measures and may step the tier down. */
  graphics?: GraphicsSettings;
}

export async function createWorld(opts: CreateWorldOptions): Promise<WorldHandle> {
  const { createWorldEngine } = await import('./engine.js');
  return createWorldEngine(opts);
}

export const SCENE_IDS: readonly SceneId[] = ['plaza', 'honey_cafe', 'trade_shop', 'build_plot', 'open_hill'];

/**
 * True when the browser has WebGL2 (docs/19 4장; otherwise the student goes to /join). No probe context is made: one
 * cost 50–200 ms of main thread on a tablet and stayed alive next to the world's own context. A device that has the
 * API but cannot make the context fails in createWorld, which every shell already treats as "no 3D".
 */
export function canRunWorld(): boolean {
  return typeof document !== 'undefined' && typeof WebGL2RenderingContext !== 'undefined';
}
