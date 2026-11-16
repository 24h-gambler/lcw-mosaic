/**
 * The running world: renderer, town, characters, camera, input, HUD and the WorldHandle methods (docs/19 2장).
 * Rendering is Three.js (AGENTS 2); every block change goes through VoxelWorld.setBlock (AGENTS 4.1).
 */
import * as THREE from 'three';
import { VoxelWorld, parseRef } from '@lcw/sim-core';
import type { BuildAccess, CreateWorldOptions, DirectorEventKind, NpcRef, RoomCheckInfo, SceneId, WorldHandle, WorldStats } from './api.js';
import { atlasSteps, TILE_PX } from './atlas.js';
import { TILE_NAMES, blockLook } from './blocks.js';
import { BlobShadows, CHAR_HEIGHT, VoxelCharacter } from './character.js';
import { ChunkRenderer } from './chunks.js';
import { makeBlockMaterials } from './materials.js';
import { ResolutionGovernor, TIER_SETTINGS } from './tiers.js';
import { Effects } from './effects.js';
import { WorldHud } from './hud.js';
import { makeBody, pickVoxel, raycastDistance, stepBody, type Body, type MoveIntent } from './physics.js';
import { Butterflies, Windmill, makeItemModel } from './props.js';
import { Sfx } from './sfx.js';
import { Sky } from './sky.js';
import { NPC_GREETINGS_EN, SCENE_TITLES_KO, WORLD_STRINGS as W, welcomeBackEn } from './strings.js';
import { PlotBuilder, type Aim, type BuildReason } from './build.js';
import { BuildHud, BuildIcons, refNameKo } from './build-hud.js';
import { BuildView } from './build-view.js';
import { PlotSync } from './plot-sync.js';
import { buildMapInfo } from './map-info.js';
import { DEFAULT_CAM_MODE, EYE_Y, NPC_FACE_Y, cycleCamMode, dialogShot, toggleMirror, toggleThirdPerson, type CamMode } from './dialog-shot.js';
import { FirstPersonHands } from './viewmodel.js';
import { browserStore } from './identity.js';
import { blockTokenMap, plotSnapshot, publishShowroom } from './showroom.js';
import { NPCS, SCENES, WANDERERS, buildTownSteps, npcTalkable, sceneRoute, standHeight, talkSpotFor, terrainHeight, type NpcDef, type NpcLook, type Spot } from './town.js';

export { TIER_SETTINGS };

const PLAYER_LOOK: NpcLook = { skin: 0xf2c7a5, hair: 0x2a2320, shirt: 0x3fa9f5, pants: 0x2f3b52, shoes: 0xff6b4a, hairStyle: 'short' };
export const TALK_RANGE = 3.6;
const CAM_DIST_DEFAULT = 6.2;


interface NpcRt {
  def: NpcDef;
  ref: NpcRef;
  char: VoxelCharacter;
  pos: THREE.Vector3;
  yaw: number;
  homeYaw: number;
  path: Array<[number, number]>;
  speed: number;
  greeted: boolean;
}

interface WalkerRt {
  char: VoxelCharacter;
  route: Array<[number, number]>;
  i: number;
  pos: THREE.Vector3;
  yaw: number;
  pause: number;
}


/** A text box: every key is its own (review M1). */
export function keyIsTyping(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.tagName === 'INPUT') return !PRESS_INPUT_TYPES.has(((t as HTMLInputElement).type || 'text').toLowerCase());
  return t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true;
}

/** Something a key presses (a button, a link, a checkbox): only Space, Enter and Tab stay with it. */
export function keyIsPressable(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.tagName === 'INPUT') return PRESS_INPUT_TYPES.has(((t as HTMLInputElement).type || 'text').toLowerCase());
  return t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY' || t.getAttribute?.('role') === 'button';
}

const PRESS_INPUT_TYPES: ReadonlySet<string> = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'color', 'file']);
/** Keys a focused button keeps (press it, or move to the next one); every other key plays. */
export const PAGE_KEYS_ON_BUTTONS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter', 'Tab']);

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

/** Chunk rings meshed before the first frame (Chebyshev distance in chunks; 2 = an 80 m square). */
export const FIRST_RING = 2;
/** Longest the first-ring meshing may hold the loading card (the rest of the 3 s budget is town + first frame). */
export const FIRST_SCREEN_CAP_MS = 2000;

/**
 * Longest the start-up waits for the ground around the player before showing the world anyway (a child must never
 * sit on the loading card forever; under normal load the ground is ready in well under a second).
 */
export const GROUND_CAP_MS = 30_000;
/** Main-thread slice for start-up work between handing the frame back (well under the 50 ms long-task line). */
export const START_SLICE_MS = 12;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Hand the main thread back for a moment (input, paint) between start-up slices. */
function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });
}

/** Run a step generator in slices of about START_SLICE_MS, yielding to the main thread in between. */
async function runSliced<T>(steps: Generator<void, T>): Promise<T> {
  let t0 = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - t0 >= START_SLICE_MS) {
      await yieldToMain();
      t0 = performance.now();
    }
  }
}

export async function createWorldEngine(opts: CreateWorldOptions): Promise<WorldHandle> {
  const { canvas } = opts;
  // Start-up phases (ms since createWorld), read back through getStats().startup for the 3 s first-screen budget.
  const tStart = performance.now();
  const startup: Record<string, number> = {};
  const mark = (k: string): void => {
    startup[k] = Math.round(performance.now() - tStart);
    // also on the page timeline, so a trace (Lighthouse, DevTools) shows where each start-up phase ends
    try {
      performance.mark(`lcw:${k}`);
    } catch {
      /* marks unsupported */
    }
  };
  const tier = TIER_SETTINGS[opts.tier];
  const hudParent = opts.hudRoot ?? canvas.parentElement ?? document.body;
  const touch = isTouchDevice();
  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- HUD first so the loading card shows while the town is built.
  const input = { fwd: 0, side: 0, run: false, jump: false, stickX: 0, stickZ: 0, stick: false, keys: new Set<string>() };
  // docs/08 7.1 (Dan 11-16 09:20): first person by default, F5 third person, Tab the mirror
  let camMode: CamMode = DEFAULT_CAM_MODE;
  let camBeforeMirror: Exclude<CamMode, 'mirror'> = DEFAULT_CAM_MODE;
  let camYaw = 0;
  let camPitch = 0.32;
  let camDist = CAM_DIST_DEFAULT;
  const sfx = new Sfx();
  let tryTalk = (): void => undefined;
  const hud = new WorldHud(hudParent, {
    onTalk: () => tryTalk(),
    onJump: (down) => {
      input.jump = down;
    },
    onView: () => cycleView(),
    onStick: (dx, dz, active) => {
      input.stickX = dx;
      input.stickZ = dz;
      input.stick = active;
    },
    onLook: (dx, dy) => {
      camYaw -= dx * 0.008;
      camPitch = Math.max(-0.35, Math.min(1.25, camPitch + dy * 0.006));
    },
    onSlot: (i) => {
      hud.selectSlot(i);
      sfx.play('ui.click');
      slotPicked(i);
    }
  });
  hud.setTouch(touch);
  hud.setLoading(0.05, false);
  await wait(16);

  // ---- Town (deterministic, system actor through setBlock).
  // Built in slices between frames (~12 ms each): one 300–900 ms task froze the page and the loading bar on tablets.
  const world = new VoxelWorld();
  await runSliced(buildTownSteps(world));
  mark('town');
  hud.setLoading(0.45, false);
  await wait(0);

  // ---- Renderer.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, powerPreference: 'high-performance', alpha: false });
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const governor = new ResolutionGovernor(tier);
  renderer.setPixelRatio(basePixelRatio * governor.scale);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
  const viewDistance = tier.viewChunks * 16;
  const sky = new Sky(scene, viewDistance);
  sky.clouds.visible = tier.clouds;
  if (tier.shadows) {
    sky.sun.castShadow = true;
    sky.sun.shadow.mapSize.set(2048, 2048);
    const c = sky.sun.shadow.camera;
    c.left = -45;
    c.right = 45;
    c.top = 45;
    c.bottom = -45;
    c.near = 1;
    c.far = 220;
    sky.sun.shadow.bias = -0.0006;
    sky.sun.shadow.normalBias = 0.04;
  }

  const atlasPixels = await runSliced(atlasSteps());
  const atlas = new THREE.DataArrayTexture(atlasPixels, TILE_PX, TILE_PX, TILE_NAMES.length);
  atlas.format = THREE.RGBAFormat;
  atlas.type = THREE.UnsignedByteType;
  // Soft painted toy look: linear filtering on 32 px tiles (array layers never bleed into each other).
  atlas.magFilter = THREE.LinearFilter;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  // anisotropic filtering only where the GPU has room (it is expensive on tablets and software GL)
  if (opts.tier === 'high') atlas.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  atlas.generateMipmaps = true;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  mark('atlas');
  const chunkMats = makeBlockMaterials(atlas, tier.material);
  const workerCount = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  const chunks = new ChunkRenderer(world, chunkMats, workerCount, () =>
    new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' })
  );
  chunks.setShadows(tier.shadows);
  scene.add(chunks.group);
  const effects = new Effects(tier.particles);
  scene.add(effects.group);

  // ---- Building on my plot (docs/03 D13, WP-201/207): shared rules, optimistic, saved by the server.
  await yieldToMain(); // the plot copy below is its own task
  const buildView = new BuildView();
  scene.add(buildView.group);
  const roomCbs = new Set<(r: RoomCheckInfo) => void>();
  let lastRoom: RoomCheckInfo | null = null;
  let buildHud: BuildHud | null = null;
  const builder = new PlotBuilder(
    world,
    {
      blockChanged: (x, y, z) => chunks.markDirtyAt(x, y, z),
      furnitureChanged: () => buildView.setFurniture(builder.state.furniture),
      inventoryChanged: () => refreshBuildSlots(),
      roomChecked: (r) => {
        lastRoom = { missing: r.missing, sentence: r.sentence, ok: r.ok, resident: r.resident };
        buildHud?.showRoom(r);
        for (const cb of roomCbs) cb(lastRoom);
      }
    },
    performance.now()
  );
  let plotSync: PlotSync | null = null;
  let buildToken: { token: string; base?: string } | null = null;
  let tokenOf: ((id: number) => import('@lcw/ui').ColorTokenName) | null = null;
  let buildAccess: BuildAccess['kind'] | 'loading' = 'local';

  const blockAt = (x: number, y: number, z: number): number => world.getBlock(x, y, z);

  // ---- Characters.
  const startScene = SCENES[opts.startScene ?? 'plaza'];
  const spotY = (s: Spot): number => standHeight(world, s.x, s.z, Math.ceil(s.y) + 1);
  const body: Body = makeBody(startScene.player.x, spotY(startScene.player), startScene.player.z);
  let playerYaw = startScene.player.yaw;
  camYaw = playerYaw + startScene.cameraYaw;
  camPitch = startScene.camPitch ?? camPitch;
  camDist = startScene.camDist ?? camDist;
  VoxelCharacter.shadows = new BlobShadows(24);
  scene.add(VoxelCharacter.shadows.mesh);
  const player = new VoxelCharacter(PLAYER_LOOK);
  scene.add(player.root);
  const hands = new FirstPersonHands(PLAYER_LOOK);
  // one character per task (each is a few dozen boxes; all of them at once was a 150 ms task on a throttled tablet)
  await yieldToMain();
  let heldItem: THREE.Group | null = null;
  let heldKey: string | null = null;

  const npcs = new Map<string, NpcRt>();
  for (const def of NPCS) {
    const char = new VoxelCharacter(def.look);
    scene.add(char.root);
    const homeScene = SCENES[def.home];
    let spot: Spot = def.spot ?? (homeScene.npc?.id === def.id ? homeScene.npc.spot : homeScene.player);
    if (def.roams && opts.startScene && SCENES[opts.startScene].npc?.id === def.id) spot = SCENES[opts.startScene].npc!.spot;
    const pos = new THREE.Vector3(spot.x, spotY(spot), spot.z);
    npcs.set(def.id, {
      def,
      ref: { id: def.id, ctx: def.ctx, nameKo: def.nameKo, nameEn: def.nameEn },
      char,
      pos,
      yaw: spot.yaw,
      homeYaw: spot.yaw,
      path: [],
      speed: 0,
      greeted: false
    });
    await yieldToMain();
  }
  const walkers: WalkerRt[] = [];
  for (const [k, w] of WANDERERS.entries()) {
    const char = new VoxelCharacter(w.look);
    scene.add(char.root);
    const [x, z] = w.route[0]!;
    walkers.push({ char, route: w.route, i: 1, pos: new THREE.Vector3(x + 0.5, standHeight(world, x, z, terrainHeight(x, z) + 2), z + 0.5), yaw: 0, pause: k * 1.5 });
    await yieldToMain();
  }
  const windmill = new Windmill(137.5, standHeight(world, 137, 98) + 6.4, 99.9);
  scene.add(windmill.root);
  const butterflies = new Butterflies([
    [131, 1, 131],
    [156, 1, 156],
    [128, 1, 182],
    [150, 7, 112],
    [136, 7, 96],
    [163, 1, 129]
  ]);
  scene.add(butterflies.root);

  // ---- State.
  let currentScene: SceneId = startScene.id;
  let paused = false;
  let disposed = false;
  let focusNpc: NpcRt | null = null;
  let playerName: string | null = null;
  let greetedByName = false;
  let nearNpc: NpcRt | null = null;
  let autopilot: Array<[number, number]> = [];
  let autoStuck = 0;
  let autoTime = 0;
  let lastAutoPos = new THREE.Vector3();
  const interactCbs = new Set<(npc: NpcRef) => void>();
  const hotbar: Array<string | null> = [null, null, null, null, null];
  // the child picked a slot holding a thing: a use of that thing (frame domain records it on the server, docs/09 P4)
  const holdListeners = new Set<(itemKey: string) => void>();
  const slotPicked = (i: number): void => {
    const k = hotbar[i];
    if (k) for (const cb of holdListeners) cb(k);
  };
  let possessedId: string | null = null;
  /** a lesson is live (setLessonBadge): solo-only NPCs (the errand giver) step out of it */
  let lessonMode = false;
  let stepTimer = 0;
  let fps = 60;
  let frameMs = 16.7;
  let lastStats = { draw: 0, tris: 0 };
  const showFps = new URLSearchParams(location.search).has('fps');
  hud.setScene(SCENE_TITLES_KO[currentScene]);

  // ---- Initial meshing: the chunks right around the start spot (FIRST_RING) are meshed and merged before the world
  // shows, nearest first; the rest of the view streams in behind the first frame (the frame loop keeps calling
  // chunks.update). The loading card stays until that ground is there — never a child standing in the air over an
  // empty town (live check 11-16: a busy tablet showed the plaza empty 10 s after entering). FIRST_SCREEN_CAP_MS only
  // marks a slow start in the stats; GROUND_CAP_MS is the last-resort cap.
  const meshUntilReady = async (onProgress: (done: number) => void): Promise<void> => {
    const t0 = performance.now();
    let total = -1;
    while (performance.now() - t0 < GROUND_CAP_MS) {
      chunks.update(body.x, body.z, FIRST_RING, 24);
      const left = chunks.outstanding(body.x, body.z, FIRST_RING);
      if (total < 0) total = Math.max(1, left);
      onProgress(1 - left / total);
      if (left === 0) return;
      await wait(30);
    }
    startup.groundCapped = 1;
  };
  mark('characters');
  await meshUntilReady((done) => hud.setLoading(0.45 + 0.55 * done, false));
  mark('mesh');
  if (startup.mesh! - startup.characters! > FIRST_SCREEN_CAP_MS) startup.slowGround = 1;

  // ---- Building controls.
  let buildActive = false;
  let tool: 'place' | 'break' = 'place';
  let aim: Aim | null = null;
  let mouseAt: { x: number; y: number } | null = null;
  /** a press that may become a place / break (mouse button or a still finger) */
  let hold: { kind: 'place' | 'break'; id: number; sx: number; sy: number; x: number; y: number; t0: number; moved: boolean; cell: string; progress: number; lastPlace: number } | null = null;
  const icons = new BuildIcons(atlasPixels);
  const selectedRef = (): string | null => builder.inv.slots[hud.selectedSlot]?.ref ?? null;
  const refreshBuildSlots = (): void => {
    if (!buildHud) return;
    if (buildActive) {
      hud.setBuildSlots(builder.inv.slots.map((s) => (s ? { icon: icons.icon(s.ref), count: s.n, name: refNameKo(s.ref) } : null)));
    }
    const ref = selectedRef();
    buildHud.setRotateVisible(!!ref && parseRef(ref)?.kind === 'furniture');
    buildHud.renderChest(builder.inv, hud.selectedSlot);
  };
  const sayReason = (reason: BuildReason | string | undefined): void => {
    if (!reason || !buildHud) return;
    buildHud.say(reason);
    if (reason !== 'rate') sfx.play('ui.click', { pitch: -6 });
  };
  const doPlace = (): boolean => {
    if (!aim) return false;
    if (aim.placeReason) {
      sayReason(aim.placeReason);
      return false;
    }
    const r = builder.place(aim.place, hud.selectedSlot, performance.now());
    if (!r.ok) {
      sayReason(r.reason);
      return false;
    }
    sfx.play('blk.place', { pitch: (Math.random() - 0.5) * 2 });
    return true;
  };
  const doBreak = (cell: { x: number; y: number; z: number }): boolean => {
    const before = world.getBlock(cell.x, cell.y, cell.z);
    const r = builder.breakAt(cell, performance.now());
    if (!r.ok) {
      sayReason(r.reason);
      return false;
    }
    sfx.play('blk.break', { pitch: (Math.random() - 0.5) * 2 });
    const look = blockLook(before);
    const col = before ? new THREE.Color(look.sound === 'wood' ? 0xc98a4a : look.sound === 'glass' ? 0xbfe6ff : look.sound === 'cloth' ? 0xfff3d6 : look.sound === 'dirt' || look.sound === 'plant' ? 0x7a5a3a : 0x9aa3b2) : new THREE.Color(0xc98a4a);
    if (!reduceMotion) effects.burst(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5, col, 14, 2.5, 0.1, 0.7);
    return true;
  };
  const openChest = (): void => {
    if (!buildHud) return;
    sfx.play('ui.open');
    buildHud.openChest(builder.inv, hud.selectedSlot);
  };
  buildHud = new BuildHud(
    hud.root,
    icons,
    {
      onTool: (t) => {
        tool = t;
        buildHud?.setTool(t);
        sfx.play('ui.click');
      },
      onChest: () => openChest(),
      onUndo: () => {
        const r = builder.undoLast(performance.now());
        if (!r.ok) sayReason(r.reason === 'no_block' ? undefined : r.reason);
        else sfx.play('blk.place', { pitch: -4 });
      },
      onRotate: () => {
        builder.rot = (builder.rot + 1) % 4;
        sfx.play('ui.click');
        buildHud?.say(`${W.rotate} ${builder.rot * 90}°`, false);
      },
      onTake: (ref) => {
        const what = parseRef(ref);
        const r = builder.take(ref, what?.kind === 'furniture' ? 1 : 16, hud.selectedSlot, performance.now());
        if (!r.ok) sayReason(r.reason);
        else sfx.play('item.get');
      },
      onStore: (slot) => {
        const r = builder.store(slot, performance.now());
        if (!r.ok) sayReason(r.reason);
        else sfx.play('ui.click');
      },
      onCloseChest: () => buildHud?.closeChest(),
      onShowroom: async (title) => {
        if (!buildToken) return { ok: false, reason: 'unlinked' };
        tokenOf ??= blockTokenMap(atlasPixels);
        const snap = plotSnapshot(world, builder.state.furniture, tokenOf, title, { shirt: PLAYER_LOOK.shirt, pants: PLAYER_LOOK.pants, hair: PLAYER_LOOK.hair });
        return publishShowroom(buildToken.token, snap, undefined, buildToken.base ?? '');
      }
    },
    touch
  );

  /** Point the build aim at a screen position: the block under it within reach, judged for both tools. */
  const aimAt = (cx: number, cy: number): Aim | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    const reach = o.distanceTo(new THREE.Vector3(body.x, body.y + 1.5, body.z)) + 6;
    const hit = pickVoxel(builder.pickAt, o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (!hit) return null;
    return builder.aim(hit, body, hud.selectedSlot);
  };

  // ---- Input.
  const keyDown = (e: KeyboardEvent): void => {
    sfx.unlock();
    const t = e.target as HTMLElement | null;
    // A text box takes every key (typing "wasd" must not walk). A focused button or link keeps only the keys that
    // press or leave it (Space, Enter, Tab); walking, E, digits and the build keys still play (review M1).
    if (keyIsTyping(t)) return;
    if (keyIsPressable(t) && PAGE_KEYS_ON_BUTTONS.has(e.code)) return;
    input.keys.add(e.code);
    if (buildActive && !paused && !buildHud?.chestOpen) {
      if (e.code === 'KeyZ' && !e.repeat) {
        const r = builder.undoLast(performance.now());
        if (r.ok) sfx.play('blk.place', { pitch: -4 });
      }
      if (e.code === 'KeyR' && !e.repeat) {
        builder.rot = (builder.rot + 1) % 4;
        buildHud?.say(`${W.rotate} ${builder.rot * 90}°`, false);
      }
      if (e.code === 'KeyC' && !e.repeat) openChest();
    }
    if (e.code === 'Escape' && buildHud?.chestOpen) buildHud.closeChest();
    if (e.code === 'KeyE') tryTalk();
    if (e.code === 'F5') {
      e.preventDefault();
      camMode = toggleThirdPerson(camMode);
    }
    if (e.code === 'Tab' && !paused) {
      e.preventDefault();
      if (camMode !== 'mirror') camBeforeMirror = camMode;
      camMode = toggleMirror(camMode, camBeforeMirror);
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5)) - 1;
      if (n >= 0 && n < 5) {
        hud.selectSlot(n);
        refreshBuildSlots();
        slotPicked(n);
      }
    }
    // Space jumps; keep the page from scrolling only when nothing on the page has focus (or the canvas has).
    if (e.code === 'Space' && (!t || t === document.body || t === document.documentElement || t === canvas)) e.preventDefault();
  };
  const keyUp = (e: KeyboardEvent): void => {
    input.keys.delete(e.code);
  };
  const cycleView = (): void => {
    camMode = cycleCamMode(camMode);
    if (camMode !== 'mirror') camBeforeMirror = camMode;
    sfx.play('ui.click');
  };
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  /** Start a build press (mouse button or finger) when standing on my plot. */
  const buildPress = (e: PointerEvent, kind: 'place' | 'break'): void => {
    if (!buildActive || paused || buildHud?.chestOpen) return;
    const now = performance.now();
    hold = { kind, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: now, moved: false, cell: '', progress: 0, lastPlace: 0 };
    aim = aimAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse' && kind === 'place') {
      hold.lastPlace = now;
      doPlace();
    }
  };
  const buildMove = (e: PointerEvent): void => {
    if (!hold || hold.id !== e.pointerId) return;
    hold.x = e.clientX;
    hold.y = e.clientY;
    if (Math.hypot(e.clientX - hold.sx, e.clientY - hold.sy) > (e.pointerType === 'mouse' ? 6 : 12)) {
      // it became a camera drag or a stick: not an edit
      hold.moved = true;
      hold.progress = 0;
      buildView.showBreak(null, 0);
    }
  };
  const buildRelease = (e: PointerEvent): void => {
    if (!hold || hold.id !== e.pointerId) return;
    const h = hold;
    hold = null;
    buildView.showBreak(null, 0);
    if (h.moved || !buildActive) return;
    if (e.pointerType === 'mouse') {
      if (h.kind === 'break' && performance.now() - h.t0 < 250) {
        // a click: open the chest when it is the chest, otherwise nothing (breaking needs a hold)
        const a = aimAt(e.clientX, e.clientY);
        if (a && builder.isChest(a.hit.x, a.hit.y, a.hit.z)) openChest();
      }
      return;
    }
    const a = aimAt(e.clientX, e.clientY);
    if (a && builder.isChest(a.hit.x, a.hit.y, a.hit.z) && performance.now() - h.t0 < 450) {
      openChest();
      return;
    }
    if (h.kind === 'place' && performance.now() - h.t0 < 450) {
      aim = a;
      doPlace();
    }
  };
  const pointerDown = (e: PointerEvent): void => {
    sfx.unlock();
    sfx.startAmbient();
    if (e.pointerType !== 'mouse') {
      // touch taps on NPCs (the HUD touch layer handles sticks; taps reach here only when it is off)
      buildPress(e, tool);
      tapPick(e.clientX, e.clientY);
      return;
    }
    if (e.button === 2) {
      buildPress(e, 'place');
      return;
    }
    if (e.button === 0) buildPress(e, 'break');
    dragging = true;
    dragMoved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const pointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') mouseAt = { x: e.clientX, y: e.clientY };
    buildMove(e);
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    camYaw -= dx * 0.006;
    camPitch = Math.max(-0.35, Math.min(1.25, camPitch + dy * 0.005));
  };
  const pointerUp = (e: PointerEvent): void => {
    buildRelease(e);
    if (dragging && dragMoved < 6 && e.button === 0) tapPick(e.clientX, e.clientY);
    dragging = false;
  };
  const contextMenu = (e: Event): void => e.preventDefault();
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    camDist = Math.max(3, Math.min(11, camDist + e.deltaY * 0.004));
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  // Focus comes back to the world (review M1): the canvas takes focus when it is pressed, and a pointer click on a
  // world HUD button hands focus back, so the next Space jumps instead of pressing that button again.
  canvas.tabIndex = -1;
  canvas.style.outline = 'none';
  const focusWorld = (): void => {
    if (disposed || document.activeElement === canvas || keyIsTyping(document.activeElement as HTMLElement | null)) return;
    canvas.focus({ preventScroll: true });
  };
  canvas.addEventListener('pointerdown', focusWorld);
  hud.root.addEventListener('click', (e) => {
    if (e.detail > 0 && keyIsPressable(e.target as HTMLElement | null)) setTimeout(focusWorld, 0);
  });
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', contextMenu);
  // Touch layer: a still finger is a build tap or hold on my plot; short touches without moving also pick NPCs.
  hud.root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') buildPress(e, tool);
  });
  hud.root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') buildMove(e);
  });
  hud.root.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    buildRelease(e);
    tapPick(e.clientX, e.clientY);
  });
  hud.root.addEventListener('pointercancel', (e) => {
    if (hold && hold.id === e.pointerId) hold = null;
  });
  const unlockOnce = (): void => {
    sfx.unlock();
    sfx.startAmbient();
  };
  hud.root.addEventListener('pointerdown', unlockOnce);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function tapPick(cx: number, cy: number): void {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let best: NpcRt | null = null;
    let bestD = Infinity;
    for (const n of npcs.values()) {
      if (!npcTalkable(n.def, lessonMode)) continue;
      const hit = raycaster.ray.distanceSqToPoint(new THREE.Vector3(n.pos.x, n.pos.y + 1, n.pos.z));
      const along = raycaster.ray.origin.distanceTo(n.pos);
      if (hit < 0.6 && along < bestD) {
        best = n;
        bestD = along;
      }
    }
    if (best) {
      const d = Math.hypot(best.pos.x - body.x, best.pos.z - body.z);
      if (d <= TALK_RANGE + 2.5) interact(best);
    }
  }

  function interact(n: NpcRt): void {
    if (paused) return;
    sfx.play('ui.open');
    focusNpc = n;
    // NPC turns to the player and waves once.
    n.yaw = Math.atan2(body.x - n.pos.x, body.z - n.pos.z);
    playerYaw = Math.atan2(n.pos.x - body.x, n.pos.z - body.z);
    n.char.wave();
    if (interactCbs.size === 0) {
      say(n.def.id, NPC_GREETINGS_EN[n.def.id] ?? 'Hello!', possessedId === n.def.id);
      return;
    }
    for (const cb of interactCbs) cb(n.ref);
  }
  tryTalk = () => {
    if (nearNpc) interact(nearNpc);
  };

  function say(npcId: string, text: string, possessed: boolean): void {
    const n = npcs.get(npcId);
    if (!n) return;
    hud.bubble(npcId, n.def.nameKo, text, { possessed }, performance.now());
    n.char.speak(Math.min(6, 0.6 + text.length * 0.05));
    sfx.play('mp.bubble');
  }

  // ---- Scene travel.
  function pathTo(target: SceneId): Array<[number, number]> | null {
    const pts = sceneRoute(currentScene, target, body.x, body.z);
    let len = 0;
    let px = body.x;
    let pz = body.z;
    for (const [x, z] of pts) {
      len += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
    }
    return len <= 46 ? pts : null;
  }

  function placeNpcForScene(target: SceneId, walk: boolean): void {
    const s = SCENES[target];
    if (!s.npc) return;
    const n = npcs.get(s.npc.id);
    if (!n) return;
    const spot = s.npc.spot;
    if (walk && Math.hypot(n.pos.x - spot.x, n.pos.z - spot.z) < 50) {
      n.path = [[spot.x, spot.z]];
    } else {
      n.pos.set(spot.x, spotY(spot), spot.z);
      n.path = [];
    }
    n.homeYaw = spot.yaw;
    n.yaw = spot.yaw;
  }

  function snapToScene(target: SceneId): void {
    const s = SCENES[target];
    hud.clearBubbles();
    body.x = s.player.x;
    body.z = s.player.z;
    body.y = spotY(s.player);
    body.vx = body.vy = body.vz = 0;
    playerYaw = s.player.yaw;
    camYaw = s.player.yaw + s.cameraYaw;
    camPitch = s.camPitch ?? 0.3;
    camDist = s.camDist ?? CAM_DIST_DEFAULT;
  }

  /** A lesson can pause the world without a tap on an NPC: frame whoever stands closest (counters are ~4 m wide). */
  function focusNearest(): void {
    if (focusNpc) return;
    let best = 6;
    for (const n of npcs.values()) {
      if (!npcTalkable(n.def, lessonMode)) continue;
      const d = Math.hypot(n.pos.x - body.x, n.pos.z - body.z);
      if (d < best) {
        best = d;
        focusNpc = n;
      }
    }
  }

  let lastArrival: { scene: SceneId; groundMs: number } | null = null;
  /**
   * The jump to a scene while the fade card is up: the card lifts only once the ground around the new spot is meshed
   * (a scene change must not show an empty town either; the frame loop streams it, nearest first).
   */
  const arriveBehindFade =
    (target: SceneId) =>
    async (): Promise<void> => {
      snapToScene(target);
      placeNpcForScene(target, false);
      chunks.update(body.x, body.z, FIRST_RING, 24);
      if (paused) {
        focusNpc = null;
        focusNearest();
      }
      const t0 = performance.now();
      while (!disposed && chunks.outstanding(body.x, body.z, FIRST_RING) > 0 && performance.now() - t0 < GROUND_CAP_MS) {
        chunks.update(body.x, body.z, FIRST_RING, 24);
        await wait(30);
      }
      lastArrival = { scene: target, groundMs: Math.round(performance.now() - t0) };
    };

  let travel: Promise<void> | null = null;
  async function goToScene(target: SceneId): Promise<void> {
    if (disposed) return;
    if (travel) await travel;
    if (target === currentScene && Math.hypot(body.x - SCENES[target].player.x, body.z - SCENES[target].player.z) < 2) {
      placeNpcForScene(target, true);
      return;
    }
    travel = (async () => {
      const pts = pathTo(target);
      hud.setScene(SCENE_TITLES_KO[target]);
      if (pts && !reduceMotion) {
        placeNpcForScene(target, true);
        autopilot = pts;
        autoStuck = 0;
        autoTime = 0;
        lastAutoPos.set(body.x, body.y, body.z);
        while (autopilot.length > 0 && !disposed && !paused) {
          await wait(50);
          if (autoStuck > 0.9 || autoTime > 9) break;
        }
        autopilot = [];
        // Arrival is judged by position, not by the path running out: a pause (a dialog opening in the same tick as
        // a lesson step, setPaused clears the walk) or a stuck walk must still end in the target scene.
        const spot = SCENES[target].player;
        if (Math.hypot(body.x - spot.x, body.z - spot.z) > 1.5) {
          sfx.play('wld.door');
          await hud.fadeTo(SCENE_TITLES_KO[target], arriveBehindFade(target));
        } else {
          // settle on the exact spot and facing
          playerYaw = SCENES[target].player.yaw;
          camYaw = playerYaw + SCENES[target].cameraYaw;
          camPitch = SCENES[target].camPitch ?? camPitch;
          camDist = SCENES[target].camDist ?? camDist;
        }
      } else {
        sfx.play('wld.door');
        await hud.fadeTo(SCENE_TITLES_KO[target], arriveBehindFade(target));
      }
      currentScene = target;
    })();
    try {
      await travel;
    } finally {
      travel = null;
    }
  }

  /**
   * Walk up to an NPC and face it (the talk lane's "미아에게 가기"). A scene's NPC on its own spot (a counter) is the
   * scene walk itself; anyone else: its scene first when it is far, then about 1.5 m in front of it (talkSpotFor),
   * well inside the talk range. Reduced motion, or a walk that got stuck, steps there.
   */
  async function walkToNpc(npcId: string): Promise<void> {
    if (disposed) return;
    const n = npcs.get(npcId);
    if (!n || !npcTalkable(n.def, lessonMode)) return;
    if (travel) await travel;
    const counter = (Object.keys(SCENES) as SceneId[]).find((id) => {
      const sn = SCENES[id].npc;
      return sn?.id === npcId && Math.hypot(sn.spot.x - n.pos.x, sn.spot.z - n.pos.z) < 1.5;
    });
    if (counter) {
      await goToScene(counter);
      return;
    }
    if (Math.hypot(n.pos.x - body.x, n.pos.z - body.z) > 12) {
      // the scene whose standing spot is nearest to where the NPC is now (a roaming guide follows the lesson)
      let scene: SceneId = n.def.home;
      let best = Infinity;
      for (const id of Object.keys(SCENES) as SceneId[]) {
        const d = Math.hypot(SCENES[id].player.x - n.pos.x, SCENES[id].player.z - n.pos.z);
        if (d < best) {
          best = d;
          scene = id;
        }
      }
      await goToScene(scene);
    }
    if (disposed || paused) return;
    const spot = talkSpotFor(world, { x: n.pos.x, y: n.pos.y, z: n.pos.z, yaw: n.homeYaw });
    if (spot && Math.hypot(spot.x - body.x, spot.z - body.z) > 0.6) {
      travel = (async () => {
        if (!reduceMotion) {
          autopilot = [[spot.x, spot.z]];
          autoStuck = 0;
          autoTime = 0;
          lastAutoPos.set(body.x, body.y, body.z);
          while (autopilot.length > 0 && !disposed && !paused) {
            await wait(50);
            if (autoStuck > 0.9 || autoTime > 6) break;
          }
          autopilot = [];
        }
        if (!disposed && Math.hypot(n.pos.x - body.x, n.pos.z - body.z) > TALK_RANGE - 0.4) {
          body.x = spot.x;
          body.z = spot.z;
          body.y = standHeight(world, spot.x, spot.z, Math.ceil(n.pos.y) + 2);
          body.vx = body.vy = body.vz = 0;
        }
      })();
      try {
        await travel;
      } finally {
        travel = null;
      }
    }
    if (disposed) return;
    playerYaw = Math.atan2(n.pos.x - body.x, n.pos.z - body.z);
    camYaw = playerYaw;
    n.yaw = Math.atan2(body.x - n.pos.x, body.z - n.pos.z);
  }

  // ---- Camera.
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camInit = false;
  /** Where the dialog NPC's face lands on screen (CSS px), for the headless framing check. */
  const dialogShotStats = (): { npc: string; face: [number, number] } | null => {
    if (!paused || !focusNpc) return null;
    const v = new THREE.Vector3(focusNpc.pos.x, focusNpc.pos.y + NPC_FACE_Y, focusNpc.pos.z).project(camera);
    return { npc: focusNpc.def.id, face: [Math.round(((v.x + 1) / 2) * viewW), Math.round(((1 - v.y) / 2) * viewH)] };
  };
  const updateCamera = (dt: number): void => {
    const headY = body.y + body.stepOffset + 1.45;
    camTarget.set(body.x, headY, body.z);
    let wantPos: THREE.Vector3;
    let wantLook: THREE.Vector3;
    if (paused && focusNpc) {
      // Dialog (dialog-shot.ts): face to face from the player's own eyes, whatever the walking view; the view offset
      // (setViewInset) puts the face in the middle of the strip the dialog window leaves free.
      const shot = dialogShot(body, focusNpc.pos, body.stepOffset, (ox, oy, oz, dx, dy, dz, max) => raycastDistance(blockAt, ox, oy, oz, dx, dy, dz, max));
      wantLook = new THREE.Vector3(shot.look.x, shot.look.y, shot.look.z);
      wantPos = new THREE.Vector3(shot.pos.x, shot.pos.y, shot.pos.z);
    } else if (camMode === 'first') {
      const f = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
      wantPos = new THREE.Vector3(body.x, body.y + body.stepOffset + EYE_Y, body.z);
      wantLook = wantPos.clone().add(new THREE.Vector3(f.x * Math.cos(camPitch), -Math.sin(camPitch - 0.3), f.z * Math.cos(camPitch)));
    } else {
      const sign = camMode === 'mirror' ? -1 : 1;
      const yaw = camMode === 'mirror' ? playerYaw : camYaw;
      const dirX = -Math.sin(yaw) * Math.cos(camPitch) * sign;
      const dirZ = -Math.cos(yaw) * Math.cos(camPitch) * sign;
      const dirY = Math.sin(camPitch);
      const want = camMode === 'mirror' ? 3.4 : camDist;
      const free = raycastDistance(blockAt, camTarget.x, camTarget.y, camTarget.z, dirX, dirY, dirZ, want);
      const d = Math.max(0.8, free - 0.25);
      wantPos = new THREE.Vector3(camTarget.x + dirX * d, camTarget.y + dirY * d, camTarget.z + dirZ * d);
      wantLook = camTarget.clone();
      // Squeezed against a wall: let the camera see through the player instead of a wall of hair.
      player.setFade(d < 2.2 ? 0.25 + (d - 0.8) * 0.4 : 1);
    }
    const k = camInit ? 1 - Math.exp(-(paused ? 4.5 : 14) * dt) : 1;
    // first person (and a dialog, which looks from the eyes): the eye moves with the body, only the gaze eases
    const eyes = camMode === 'first' || (paused && !!focusNpc);
    camPos.lerp(wantPos, eyes ? 1 : k);
    camLook.lerp(wantLook, k);
    camInit = true;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    player.setHeadVisible(!(camMode === 'first' && !paused));
    if (camMode !== 'third' || paused) player.setFade(1);
    // looking out of the player's eyes: the body is not drawn (the first-person hands stand in for it)
    player.root.visible = !eyes;
  };
  camPos.set(body.x - Math.sin(camYaw) * camDist, body.y + 3, body.z - Math.cos(camYaw) * camDist);

  // ---- Resize.
  // CSS size of the canvas, cached here: reading clientWidth every frame after the HUD wrote to the DOM forced a
  // layout per frame (the largest main-thread cost in a profile on a fast GPU).
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  // Pixels a panel covers at the bottom and on the right (setViewInset; landscape phones put the dialog on the
  // right): the projection's centre moves into the part of the screen the panel leaves free.
  let viewInset = 0;
  let viewInsetRight = 0;
  const applyViewInset = (): void => {
    const bottom = Math.min(viewH * 0.78, Math.max(0, viewInset));
    const right = Math.min(viewW * 0.78, Math.max(0, viewInsetRight));
    if (bottom > 0 || right > 0) camera.setViewOffset(viewW, viewH, right / 2, bottom / 2, viewW, viewH);
    else camera.clearViewOffset();
  };
  const resize = (): void => {
    const w = canvas.clientWidth || hudParent.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || hudParent.clientHeight || window.innerHeight;
    viewW = w;
    viewH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.fov = camera.aspect < 0.8 ? 80 : 70;
    applyViewInset();
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  // the canvas can also change size without a window resize (panels, rotation on some tablets)
  const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  resizeObs?.observe(canvas);

  // ---- Building, per frame: plot entry/exit, aim outline, held break / place.
  function updateBuild(dt: number, now: number): void {
    const want = builder.inPlot(body.x, body.z) && !paused && autopilot.length === 0;
    if (want !== buildActive) {
      buildActive = want;
      buildHud?.setActive(want, touch ? W.buildHelpTouch : W.buildHelpDesktop);
      buildHud?.setSync(buildAccess === 'saved' ? (plotSync?.status === 'offline' ? 'offline' : plotSync && plotSync.pending > 0 ? 'saving' : 'saved') : buildAccess === 'loading' ? 'loading' : buildAccess === 'local' ? 'local' : 'idle');
      if (want) refreshBuildSlots();
      else {
        hud.setBuildSlots(null);
        buildHud?.closeChest();
        hold = null;
        aim = null;
        buildView.showAim(null, false);
        buildView.showBreak(null, 0);
      }
    }
    if (!buildActive) return;
    // aim: the held press first, else the mouse hover (desktop shows the outline before any click)
    const at = hold ? { x: hold.x, y: hold.y } : !touch ? mouseAt : null;
    aim = at ? aimAt(at.x, at.y) : null;
    const mode: 'place' | 'break' = hold ? hold.kind : touch ? tool : 'place';
    if (!aim) buildView.showAim(null, false);
    else if (mode === 'place') buildView.showAim(aim.place, !!aim.placeReason);
    else buildView.showAim(aim.hit, !!aim.breakReason);
    if (!hold || hold.moved || !aim) {
      buildView.showBreak(null, 0);
      return;
    }
    if (hold.kind === 'break') {
      const key = `${aim.hit.x},${aim.hit.y},${aim.hit.z}`;
      if (key !== hold.cell) {
        hold.cell = key;
        hold.progress = 0;
        if (aim.breakReason) sayReason(aim.breakReason);
      }
      if (aim.breakReason) {
        buildView.showBreak(null, 0);
        return;
      }
      hold.progress += dt / Math.max(0.001, aim.breakS);
      if (hold.progress >= 1) {
        doBreak(aim.hit);
        hold.progress = 0;
        hold.cell = '';
        buildView.showBreak(null, 0);
      } else buildView.showBreak(aim.hit, hold.progress);
    } else {
      // holding place repeats at D13 4 a second (a finger waits a moment first, so a tap stays one block)
      const first = touch ? 450 : 300;
      if (now - hold.t0 >= first && now - hold.lastPlace >= 250) {
        hold.lastPlace = now;
        doPlace();
      }
    }
  }

  const startBuildAccess = (a: BuildAccess): void => {
    plotSync?.stop();
    plotSync = null;
    buildToken = a.kind === 'saved' && !a.lesson ? { token: a.token, base: a.base } : null;
    buildHud?.setShowroomVisible(a.kind === 'saved' && !a.lesson);
    if (a.kind === 'paused') {
      buildAccess = 'paused';
      builder.access = 'paused';
      buildHud?.setSync('idle');
      return;
    }
    if (a.kind === 'local') {
      buildAccess = 'local';
      builder.access = 'local';
      builder.onOp = null;
      if (buildActive) buildHud?.setSync('local');
      return;
    }
    buildAccess = 'loading';
    builder.access = 'paused';
    if (buildActive) buildHud?.setSync('loading');
    const sync = new PlotSync({
      token: a.token,
      base: a.base,
      store: browserStore(),
      onResync: (snap) => builder.applySnapshot(snap),
      onStatus: (st) => {
        if (buildActive && buildAccess === 'saved') buildHud?.setSync(st);
      },
      onDenied: (kind) => {
        if (plotSync !== sync) return;
        if (kind === 'paused' && !a.lesson) {
          // the seat stopped while playing: look, don't build (plot-sync already told the shell, world/seat.ts)
          buildAccess = 'paused';
          builder.access = 'paused';
          buildHud?.setShowroomVisible(false);
        } else {
          // not linked any more (or the lesson token ran out): keep building on this device only
          buildAccess = 'local';
          builder.access = 'local';
          builder.onOp = null;
        }
        if (buildActive) buildHud?.setSync(buildAccess === 'local' ? 'local' : 'idle');
      }
    });
    plotSync = sync;
    void sync.start().then((snap) => {
      if (plotSync !== sync || disposed) return;
      if (!snap) {
        if (buildAccess === 'loading') {
          // offline at start: build on what is here; the queue (and later ops) still go up when the line is back
          buildAccess = 'saved';
          builder.access = 'local';
          builder.onOp = (op) => sync.push(op);
          if (buildActive) buildHud?.setSync('offline');
        }
        return;
      }
      builder.applySnapshot(snap);
      buildAccess = 'saved';
      builder.access = 'saved';
      builder.onOp = (op) => sync.push(op);
      if (buildActive) buildHud?.setSync('saved');
    });
  };

  // ---- Frame loop.
  const tmp = new THREE.Vector3();
  const project = (x: number, y: number, z: number): { sx: number; sy: number; vis: boolean } => {
    tmp.set(x, y, z).project(camera);
    return { sx: (tmp.x * 0.5 + 0.5) * viewW, sy: (-tmp.y * 0.5 + 0.5) * viewH, vis: tmp.z < 1 && tmp.z > -1 };
  };
  const forward = new THREE.Vector3();
  let last = performance.now();
  let fpsAcc = 0;
  let fpsFrames = 0;
  let raf = 0;
  const fountain = new THREE.Vector3(144, 5.2, 144);

  const frame = (): void => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      frameMs = (fpsAcc / fpsFrames) * 1000;
      fpsAcc = 0;
      fpsFrames = 0;
      if (showFps) hud.setFps(`${fps.toFixed(0)} fps · ${lastStats.draw} dc · ${(lastStats.tris / 1000).toFixed(0)}k`);
    }

    // Movement intent.
    const intent: MoveIntent = { dx: 0, dz: 0, run: false, jump: false };
    if (autopilot.length > 0) {
      const [tx, tz] = autopilot[0]!;
      const dx = tx - body.x;
      const dz = tz - body.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) autopilot.shift();
      else {
        intent.dx = dx / d;
        intent.dz = dz / d;
        intent.run = true;
      }
      autoTime += dt;
      const moved = Math.hypot(body.x - lastAutoPos.x, body.z - lastAutoPos.z);
      autoStuck = moved < dt * 1.0 ? autoStuck + dt : Math.max(0, autoStuck - dt);
      lastAutoPos.set(body.x, body.y, body.z);
      camYaw += wrapAngle(Math.atan2(intent.dx, intent.dz) - camYaw) * (1 - Math.exp(-3 * dt));
    } else if (!paused) {
      const k = input.keys;
      let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (input.stick) {
        f = -input.stickZ;
        s = input.stickX;
      }
      const yaw = camMode === 'mirror' ? playerYaw + Math.PI : camYaw;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      // right vector = (-cos, 0, sin) for this yaw convention
      intent.dx = fx * f - fz * s;
      intent.dz = fz * f + fx * s;
      intent.run = k.has('ShiftLeft') || k.has('ShiftRight') || (input.stick && Math.hypot(input.stickX, input.stickZ) > 0.92);
      intent.jump = k.has('Space') || input.jump;
    }
    const wasGround = body.onGround;
    const pushers = [...npcs.values()].map((n) => ({ x: n.pos.x, z: n.pos.z, r: 0.35 }));
    const preVy = body.vy;
    stepBody(body, intent, dt, blockAt, pushers);
    if (intent.jump && wasGround && !body.onGround) sfx.play('body.jump');
    if (!wasGround && body.onGround && preVy < -6) sfx.play('body.land');
    const speed = Math.hypot(body.vx, body.vz);
    if (speed > 0.4) {
      const want = Math.atan2(body.vx, body.vz);
      playerYaw += wrapAngle(want - playerYaw) * (1 - Math.exp(-12 * dt));
      if (body.onGround) {
        stepTimer -= dt * speed;
        if (stepTimer <= 0) {
          stepTimer = 1.6;
          const under = blockLook(world.getBlock(Math.floor(body.x), Math.floor(body.y - 0.05), Math.floor(body.z)));
          sfx.play(`step.${under.sound}`, { pitch: (Math.random() - 0.5) * 3 });
        }
      }
    }
    player.root.position.set(body.x, body.y + body.stepOffset, body.z);
    player.root.rotation.y = playerYaw;
    player.update(dt, { speed: body.onGround ? speed : 0, talking: hud.bubbleTyping('player'), lookYaw: 0 });
    if (heldItem) heldItem.rotation.y = Math.sin(now / 400) * 0.1;

    // NPCs: walk if they have a path, otherwise idle and look at the player when near.
    nearNpc = null;
    let nearD = TALK_RANGE;
    for (const n of npcs.values()) {
      const inPlay = npcTalkable(n.def, lessonMode);
      n.char.root.visible = inPlay;
      if (!inPlay) continue;
      let sp = 0;
      if (n.path.length > 0) {
        const [tx, tz] = n.path[0]!;
        const dx = tx - n.pos.x;
        const dz = tz - n.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          n.path.shift();
          if (n.path.length === 0) n.yaw = n.homeYaw;
        } else {
          sp = Math.min(5.5, d * 3 + 1);
          const step = Math.min(d, sp * dt);
          n.pos.x += (dx / d) * step;
          n.pos.z += (dz / d) * step;
          n.pos.y += (standHeight(world, n.pos.x, n.pos.z, Math.ceil(n.pos.y) + 2) - n.pos.y) * Math.min(1, dt * 12);
          n.yaw += wrapAngle(Math.atan2(dx, dz) - n.yaw) * Math.min(1, dt * 10);
        }
      }
      const pd = Math.hypot(body.x - n.pos.x, body.z - n.pos.z);
      let look = 0;
      if (pd < 7 && sp === 0) {
        look = wrapAngle(Math.atan2(body.x - n.pos.x, body.z - n.pos.z) - n.yaw);
        if (!n.greeted && pd < 5) {
          n.greeted = true;
          n.char.wave();
        }
      }
      if (pd > 12) n.greeted = false;
      n.char.root.position.copy(n.pos);
      n.char.root.rotation.y = n.yaw;
      n.char.possessed = possessedId === n.def.id;
      n.char.update(dt, { speed: sp, talking: hud.bubbleTyping(n.def.id), lookYaw: look });
      if (pd < nearD && Math.abs(body.y - n.pos.y) < 2.5) {
        nearD = pd;
        nearNpc = n;
      }
    }
    // Townsfolk stroll.
    for (const w of walkers) {
      let sp = 0;
      if (w.pause > 0) w.pause -= dt;
      else {
        const [tx, tz] = w.route[w.i]!;
        const dx = tx + 0.5 - w.pos.x;
        const dz = tz + 0.5 - w.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) {
          w.i = (w.i + 1) % w.route.length;
          w.pause = 1 + ((w.i * 7) % 5) * 0.6;
        } else {
          sp = 1.5;
          w.pos.x += (dx / d) * sp * dt;
          w.pos.z += (dz / d) * sp * dt;
          w.pos.y += (standHeight(world, w.pos.x, w.pos.z, Math.ceil(w.pos.y) + 2) - w.pos.y) * Math.min(1, dt * 10);
          w.yaw += wrapAngle(Math.atan2(dx, dz) - w.yaw) * Math.min(1, dt * 6);
        }
      }
      w.char.root.position.copy(w.pos);
      w.char.root.rotation.y = w.yaw;
      const dist = w.pos.distanceTo(player.root.position);
      w.char.root.visible = dist < viewDistance;
      if (w.char.root.visible) w.char.update(dt, { speed: sp, talking: false, lookYaw: 0 });
    }

    windmill.update(dt);
    butterflies.update(dt);
    if (player.root.position.distanceTo(fountain) < viewDistance) effects.spray(fountain.x, fountain.y, fountain.z, dt);
    effects.update(dt);
    sky.update(dt, player.root.position);
    hud.tickStatus(sky.hour, body.y);
    chunkMats.sync(sky);
    chunks.update(body.x, body.z, tier.viewChunks);
    updateCamera(dt);
    updateBuild(dt, now);

    // HUD projections.
    const nowMs = now;
    for (const n of npcs.values()) {
      if (!hud.hasBubble(n.def.id, nowMs)) continue;
      const p = project(n.pos.x, n.pos.y + CHAR_HEIGHT + 0.45, n.pos.z);
      hud.updateBubble(n.def.id, p.sx, p.sy, p.vis, nowMs, dt);
    }
    if (hud.hasBubble('player', nowMs)) {
      const p = project(body.x, body.y + CHAR_HEIGHT + 0.45, body.z);
      hud.updateBubble('player', p.sx, p.sy, p.vis, nowMs, dt);
    }
    if (playerName) {
      const p = project(body.x, body.y + CHAR_HEIGHT + 0.25, body.z);
      hud.placePlate(p.sx, p.sy, p.vis && camMode !== 'first');
    }
    hud.flushBubbles();
    if (nearNpc && !paused && autopilot.length === 0 && !hud.hasBubble(nearNpc.def.id, nowMs)) {
      const p = project(nearNpc.pos.x, nearNpc.pos.y + CHAR_HEIGHT + 0.35, nearNpc.pos.z);
      hud.showPrompt(p.vis, p.sx, p.sy, touch);
    } else hud.showPrompt(false, 0, 0, touch);

    renderer.render(scene, camera);
    lastStats = { draw: renderer.info.render.calls, tris: renderer.info.render.triangles };
    if (camMode === 'first' && !(paused && focusNpc)) {
      hands.update(dt, body.onGround ? Math.hypot(body.vx, body.vz) : 0, camera.aspect, camera.fov);
      hands.render(renderer);
    }
    // Dynamic resolution (docs/08 6.6 목표 프레임): slow frames lower the render scale, fast ones restore it.
    if (governor.frame(dt * 1000)) {
      renderer.setPixelRatio(basePixelRatio * governor.scale);
      resize();
    }
    forward.set(0, 0, 0);
  };
  // The atlas upload and the shader programs go to the GPU before the first frame, each in its own task: done inside
  // the first render they were one 400–500 ms task on a throttled tablet (the loading bar froze at the end). A program
  // links on its first draw (compileAsync alone does not link without the parallel-compile extension), so each
  // material is drawn once on its own behind the loading card, one task per material.
  const warmPrograms = async (): Promise<void> => {
    const drawables: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const d = o as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      if (d.isMesh || d.isPoints || d.isLine || d.isSprite) drawables.push(o);
    });
    const saved = drawables.map((o) => ({ o, visible: o.visible, culled: o.frustumCulled }));
    const firstByMaterial = new Map<THREE.Material, THREE.Object3D>();
    for (const { o, visible } of saved) {
      if (!visible) continue;
      const m = (o as THREE.Mesh).material;
      for (const mm of Array.isArray(m) ? m : [m]) if (mm && !firstByMaterial.has(mm)) firstByMaterial.set(mm, o);
    }
    try {
      for (const o of new Set(firstByMaterial.values())) {
        for (const d of drawables) d.visible = false;
        o.visible = true;
        o.frustumCulled = false;
        renderer.render(scene, camera);
        o.frustumCulled = saved.find((x) => x.o === o)!.culled;
        await yieldToMain();
        if (disposed) return;
      }
    } finally {
      for (const { o, visible, culled } of saved) {
        o.visible = visible;
        o.frustumCulled = culled;
      }
    }
  };
  try {
    renderer.initTexture(atlas);
  } catch {
    /* uploaded by the first render instead */
  }
  await yieldToMain();
  await warmPrograms();
  mark('gpu');
  hud.setLoading(1, true);
  raf = requestAnimationFrame(() => {
    frame();
    mark('firstFrame');
  });

  // ---- Handle.
  const handle: WorldHandle = {
    goToScene,
    walkToNpc,
    onNpcInteract(cb) {
      interactCbs.add(cb);
      return () => {
        interactCbs.delete(cb);
      };
    },
    npcSay(npcId, text, o) {
      say(npcId, text, !!o?.possessed || possessedId === npcId);
    },
    playerSay(text) {
      hud.bubble('player', '', text, { me: true }, performance.now());
      player.speak(Math.min(6, 0.6 + text.length * 0.05));
      sfx.play('mp.bubble');
    },
    giveItem(itemKey) {
      let slot = hotbar.indexOf(null);
      if (slot < 0) slot = hud.selectedSlot;
      hotbar[slot] = itemKey;
      hud.putItem(slot, itemKey);
      if (heldItem) player.hand.remove(heldItem);
      heldItem = makeItemModel(itemKey);
      heldKey = itemKey;
      player.hand.add(heldItem);
      hands.setItem(itemKey);
      const hp = new THREE.Vector3();
      player.hand.getWorldPosition(hp);
      effects.sparkle(hp.x, hp.y, hp.z);
      sfx.play('item.get');
    },
    setBag(keys) {
      for (let i = 0; i < hotbar.length; i++) {
        const k = keys[i] ?? null;
        if (hotbar[i] === k) continue;
        hotbar[i] = k;
        hud.setItem(i, k);
      }
      if (heldItem && heldKey && !hotbar.includes(heldKey)) {
        player.hand.remove(heldItem);
        heldItem = null;
        heldKey = null;
        hands.setItem(null);
      }
    },
    takeItem(itemKey) {
      const slot = hotbar.lastIndexOf(itemKey);
      if (slot < 0) return false;
      hotbar[slot] = null;
      hud.clearItem(slot);
      if (heldItem && heldKey === itemKey && !hotbar.includes(itemKey)) {
        player.hand.remove(heldItem);
        heldItem = null;
        heldKey = null;
        hands.setItem(null);
      }
      return true;
    },
    celebrate(stars, opts) {
      hud.celebrate(stars, reduceMotion, Math.max(0, Math.round(opts?.add ?? stars)));
      if (stars === 0) {
        sfx.play('dlg.again');
        return;
      }
      sfx.play(`dlg.pass.${stars}`);
      player.cheer();
      if (focusNpc) focusNpc.char.cheer();
      const color = new THREE.Color(stars === 3 ? 0xffc53d : stars === 2 ? 0x3fa9f5 : 0xc9ced9);
      // Stars fly toward the HUD star counter (top-right of the screen).
      const home = new THREE.Vector3(0.85, 0.85, 0.5).unproject(camera);
      home.sub(camera.position).normalize().multiplyScalar(3).add(camera.position);
      if (!reduceMotion) effects.starBurst(body.x, body.y + CHAR_HEIGHT + 0.3, body.z, stars, color, home);
      window.setTimeout(() => sfx.play('eco.coin_gain'), 1300);
    },
    setGoal(goalKo, targetEn) {
      hud.setGoal(goalKo, targetEn);
    },
    setViewInset(bottomPx, rightPx = 0) {
      viewInset = Number.isFinite(bottomPx) ? bottomPx : 0;
      viewInsetRight = Number.isFinite(rightPx) ? rightPx : 0;
      applyViewInset();
      hud.setDialogOpen(viewInset > 0 || viewInsetRight > 0);
    },
    setPaused(p) {
      paused = p;
      if (p) {
        autopilot = [];
        body.vx = 0;
        body.vz = 0;
        if (!focusNpc && nearNpc) focusNpc = nearNpc;
        focusNearest();
      } else {
        focusNpc = null;
        camYaw = playerYaw;
        // a dialog window closed: its buttons are gone or stay behind, the keys belong to the world again
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body || keyIsPressable(a)) focusWorld();
      }
      hud.setTouchPaused(p);
      hud.showPrompt(false);
    },
    dispose() {
      disposed = true;
      hands.dispose();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('resize', resize);
      resizeObs?.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', contextMenu);
      plotSync?.stop();
      builder.dispose();
      buildHud?.dispose();
      buildView.dispose();
      chunks.dispose();
      VoxelCharacter.shadows = null;
      sfx.dispose();
      hud.dispose();
      renderer.dispose();
    },
    setPossessed(npcId) {
      possessedId = npcId;
    },
    playDirectorEvent(kind: DirectorEventKind, detail: string) {
      switch (kind) {
        case 'weather_shift':
          hud.director('snow');
          sfx.play('dir.wind');
          window.setTimeout(() => hud.director(null), 20000);
          break;
        case 'blackout':
          hud.director('blackout');
          sfx.play('dir.blackout');
          window.setTimeout(() => hud.director(null), 10000);
          break;
        case 'npc_prompt': {
          const id = possessedId ?? SCENES[currentScene].npc?.id ?? 'guide';
          if (detail) say(id, detail, true);
          break;
        }
        case 'mentor_dungeon_gate':
        case 'review_chest': {
          sfx.play('dir.chime');
          const n = npcs.get(SCENES[currentScene].npc?.id ?? 'guide');
          const at = n ? n.pos : new THREE.Vector3(body.x, body.y, body.z);
          effects.burst(at.x, at.y + 1, at.z, new THREE.Color(kind === 'review_chest' ? 0xffc53d : 0x8e5be8), 40, 4);
          if (detail && n) say(n.def.id, detail, possessedId === n.def.id);
          break;
        }
        case 'star_celebration':
          sfx.play('dlg.pass.3');
          player.cheer();
          effects.starBurst(body.x, body.y + CHAR_HEIGHT + 0.3, body.z, 3, new THREE.Color(0xffc53d), new THREE.Vector3(body.x, body.y + 6, body.z));
          break;
      }
    },
    setBuildAccess: (a) => startBuildAccess(a),
    getPlayerLook: () => ({ ...PLAYER_LOOK }),
    onHold(cb) {
      holdListeners.add(cb);
      return () => holdListeners.delete(cb);
    },
    onRoomCheck(cb) {
      roomCbs.add(cb);
      return () => {
        roomCbs.delete(cb);
      };
    },
    getScene: () => currentScene,
    listNpcs: () => [...npcs.values()].map((n) => n.ref),
    setLessonBadge: (on) => {
      hud.setLessonBadge(on);
      lessonMode = on;
      if (on && nearNpc && !npcTalkable(nearNpc.def, true)) nearNpc = null;
    },
    setTeacher: (t) => hud.setTeacher(t),
    setCoins: (total) => hud.setCoins(total),
    // Map screen (docs/08 G06): read once when the menu opens (the menu pauses the world). The arrow follows the view;
    // in the mirror view the camera faces the child, so the body's facing is the one that means "where I look".
    getMap: () => buildMapInfo({ player: { x: body.x, z: body.z, yaw: camMode === 'mirror' ? playerYaw : camYaw }, plot: world.plot }),
    setOnline: (on) => hud.setOnline(on),
    setStars: (total) => hud.setStars(total),
    setPlayerName(name) {
      const clean = name ? name.trim().slice(0, 16) : '';
      playerName = clean || null;
      hud.setPlate(playerName);
      if (playerName && !greetedByName) {
        greetedByName = true;
        const guide = npcs.get('guide');
        if (guide && Math.hypot(guide.pos.x - body.x, guide.pos.z - body.z) < 14) {
          hud.bubble('guide', guide.def.nameKo, welcomeBackEn(playerName), {}, performance.now());
          guide.char.wave();
          sfx.play('mp.bubble');
        }
      }
    },
    getStats(): WorldStats {
      return {
        fps,
        frameMs,
        renderScale: governor.scale,
        tier: opts.tier,
        drawCalls: lastStats.draw,
        triangles: lastStats.tris,
        chunksMeshed: chunks.meshed,
        chunksVisible: chunks.visible,
        arrival: lastArrival ?? undefined,
        ground: { near: chunks.outstanding(body.x, body.z, FIRST_RING), view: chunks.outstanding(body.x, body.z, tier.viewChunks) },
        scene: currentScene,
        player: { x: body.x, y: body.y, z: body.z },
        dialogShot: dialogShotStats(),
        startup: { ...startup },
        build: {
          active: buildActive,
          access: buildAccess,
          tool,
          slots: builder.inv.slots.map((x) => (x ? `${x.ref}x${x.n}` : null)),
          chestKinds: Object.keys(builder.inv.chest).length,
          furniture: builder.state.furniture.size,
          edits: builder.edits,
          undo: builder.undoDepth,
          pending: plotSync?.pending ?? 0,
          sent: plotSync?.sent ?? 0,
          refused: plotSync?.refused ?? 0,
          sync: plotSync?.status ?? 'idle',
          aim: aim ? { hit: aim.hit, place: aim.place, placeReason: aim.placeReason, breakReason: aim.breakReason } : null,
          tip: buildHud?.tipText ?? '',
          room: lastRoom,
          chestOpen: buildHud?.chestOpen ?? false
        }
      };
    }
  };
  return handle;
}
