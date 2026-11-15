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
}

export interface WorldHandle {
  goToScene(id: SceneId): Promise<void>; // 걸어가거나 문을 지나는 연출 포함
  onNpcInteract(cb: (npc: NpcRef) => void): () => void; // E 키·탭으로 NPC에게 말 걸기
  npcSay(npcId: string, text: string, opts?: { possessed?: boolean }): void; // 말풍선(빙의 중엔 반짝임)
  playerSay(text: string): void;
  giveItem(itemKey: string): void; // 주문한 음료·교환한 물건이 손/슬롯에
  celebrate(stars: 0 | 1 | 2 | 3): void; // 별 연출·효과음
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
  /** Small "수업 중" tag on the HUD (docs/08 8.1). */
  setLessonBadge?(on: boolean): void;
  /** Coin balance from the server ledger (dialog `coinsTotal`, lesson sync); null hides it. */
  setCoins?(total: number | null): void;
  /**
   * Star chip from an outside count (a lesson's stars, server-summed): the chip shows this number and celebrate()
   * no longer adds to it, so a star is never counted twice. null hands the chip back to celebrate().
   */
  setStars?(total: number | null): void;
  /** Linked child's nickname shown over the player (null = guest, no plate). The guide greets them by name once. */
  setPlayerName?(name: string | null): void;
  /**
   * Build screen room check (docs/03 D13, docs/08 8.3): what the room still misses, as furniture kinds, and the English
   * sentence shown for it. The dialog domain puts its read-aloud discount line under it. Returns an unsubscribe.
   */
  onRoomCheck?(cb: (r: { missing: Array<'light' | 'rest' | 'flat'>; sentence: string }) => void): () => void;
  /** Performance and position read-out (headless checks, tier auto-detect). */
  getStats?(): WorldStats;
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
