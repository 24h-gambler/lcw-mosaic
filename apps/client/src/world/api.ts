/**
 * World domain -> other client domains (docs/19 2장). Dialog and lesson code depend only on this file.
 * The required members match docs/19 exactly; the optional ones are additions recorded there in the same PR.
 */
import type { NpcContext } from '@lcw/schemas';

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
  /** tier the world runs at */
  tier?: WorldTier;
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
}

export interface WorldHandle {
  goToScene(id: SceneId): Promise<void>; // 걸어가거나 문을 지나는 연출 포함
  onNpcInteract(cb: (npc: NpcRef) => void): () => void; // E 키·탭으로 NPC에게 말 걸기
  npcSay(npcId: string, text: string, opts?: { possessed?: boolean }): void; // 말풍선(빙의 중엔 반짝임)
  playerSay(text: string): void;
  giveItem(itemKey: string): void; // 주문한 음료·교환한 물건이 손/슬롯에
  /**
   * The item left the child (handed to an NPC, e.g. the errand water): its slot empties and, if it was in hand, the
   * hand too. False when no slot held it. Shells call it after the server already moved the item.
   */
  takeItem?(itemKey: string): boolean;
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
  | { kind: 'saved'; token: string; base?: string; lesson?: true };

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
