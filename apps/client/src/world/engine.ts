/**
 * The running world: renderer, town, characters, camera, input, HUD and the WorldHandle methods (docs/19 2장).
 * Rendering is Three.js (AGENTS 2); every block change goes through VoxelWorld.setBlock (AGENTS 4.1).
 */
import * as THREE from 'three';
import { VoxelWorld } from '@lcw/sim-core';
import type { CreateWorldOptions, DirectorEventKind, NpcRef, SceneId, WorldHandle, WorldStats, WorldTier } from './api.js';
import { buildAtlasPixels, TILE_PX } from './atlas.js';
import { TILE_NAMES, blockLook } from './blocks.js';
import { CHAR_HEIGHT, VoxelCharacter } from './character.js';
import { ChunkRenderer } from './chunks.js';
import { Effects } from './effects.js';
import { WorldHud } from './hud.js';
import { makeBody, pickVoxel, raycastDistance, stepBody, type Body, type MoveIntent } from './physics.js';
import { Butterflies, Windmill, makeItemModel } from './props.js';
import { Sfx } from './sfx.js';
import { Sky } from './sky.js';
import { NPC_GREETINGS_EN, SCENE_TITLES_KO } from './strings.js';
import { NPCS, SCENES, WANDERERS, buildTown, standHeight, terrainHeight, type NpcDef, type NpcLook, type Spot } from './town.js';

export const TIER_SETTINGS: Readonly<Record<WorldTier, { viewChunks: number; pixelScale: number; shadows: boolean; particles: number; antialias: boolean }>> = {
  // docs/08 6.6
  low: { viewChunks: 4, pixelScale: 0.75, shadows: false, particles: 200, antialias: false },
  mid: { viewChunks: 6, pixelScale: 1.0, shadows: false, particles: 400, antialias: true },
  high: { viewChunks: 8, pixelScale: 1.0, shadows: true, particles: 600, antialias: true }
};

const PLAYER_LOOK: NpcLook = { skin: 0xf2c7a5, hair: 0x2a2320, shirt: 0x3fa9f5, pants: 0x2f3b52, shoes: 0xff6b4a, hairStyle: 'short' };
const TALK_RANGE = 3.6;
const CAM_DIST_DEFAULT = 6.2;

type CamMode = 'third' | 'first' | 'mirror';

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

function blockMaterial(atlas: THREE.DataArrayTexture, translucent: boolean): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: translucent, depthWrite: !translucent });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTile;\nvarying vec3 vTile;\nvarying float vGlow;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = aTile.xyz;\nvGlow = aTile.w;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uAtlas;\nvarying vec3 vTile;\nvarying float vGlow;')
      .replace(
        '#include <map_fragment>',
        `vec2 tuv = vTile.xy;
vec4 texel = textureGrad(uAtlas, vec3(clamp(fract(tuv), 0.002, 0.998), vTile.z), dFdx(tuv), dFdy(tuv));
${translucent ? 'if (texel.a < 0.02) discard;' : 'if (texel.a < 0.5) discard;'}
diffuseColor *= texel;`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 0.85;');
  };
  mat.customProgramCacheKey = () => (translucent ? 'lcw-block-t' : 'lcw-block-o');
  return mat;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function createWorldEngine(opts: CreateWorldOptions): Promise<WorldHandle> {
  const { canvas } = opts;
  const tier = TIER_SETTINGS[opts.tier];
  const hudParent = opts.hudRoot ?? canvas.parentElement ?? document.body;
  const touch = isTouchDevice();
  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- HUD first so the loading card shows while the town is built.
  const input = { fwd: 0, side: 0, run: false, jump: false, stickX: 0, stickZ: 0, stick: false, keys: new Set<string>() };
  let camMode: CamMode = 'third';
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
    }
  });
  hud.setTouch(touch);
  hud.setLoading(0.05, false);
  await wait(16);

  // ---- Town (deterministic, system actor through setBlock).
  const world = new VoxelWorld();
  buildTown(world);
  hud.setLoading(0.45, false);
  await wait(0);

  // ---- Renderer.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * tier.pixelScale);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
  const viewDistance = tier.viewChunks * 16;
  const sky = new Sky(scene, viewDistance);
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

  const atlasPixels = buildAtlasPixels();
  const atlas = new THREE.DataArrayTexture(atlasPixels, TILE_PX, TILE_PX, TILE_NAMES.length);
  atlas.format = THREE.RGBAFormat;
  atlas.type = THREE.UnsignedByteType;
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestMipmapLinearFilter;
  atlas.generateMipmaps = true;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  const chunkMats = { opaque: blockMaterial(atlas, false), translucent: blockMaterial(atlas, true) };
  const workerCount = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  const chunks = new ChunkRenderer(world, chunkMats, workerCount, () =>
    new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' })
  );
  chunks.setShadows(tier.shadows);
  scene.add(chunks.group);
  const effects = new Effects(tier.particles);
  scene.add(effects.group);

  const blockAt = (x: number, y: number, z: number): number => world.getBlock(x, y, z);

  // ---- Characters.
  const startScene = SCENES[opts.startScene ?? 'plaza'];
  const spotY = (s: Spot): number => standHeight(world, s.x, s.z, Math.ceil(s.y) + 1);
  const body: Body = makeBody(startScene.player.x, spotY(startScene.player), startScene.player.z);
  let playerYaw = startScene.player.yaw;
  camYaw = playerYaw + startScene.cameraYaw;
  camPitch = startScene.camPitch ?? camPitch;
  camDist = startScene.camDist ?? camDist;
  const player = new VoxelCharacter(PLAYER_LOOK);
  scene.add(player.root);
  let heldItem: THREE.Group | null = null;

  const npcs = new Map<string, NpcRt>();
  for (const def of NPCS) {
    const char = new VoxelCharacter(def.look);
    scene.add(char.root);
    const homeScene = SCENES[def.home];
    let spot: Spot = homeScene.npc?.id === def.id ? homeScene.npc.spot : homeScene.player;
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
  }
  const walkers: WalkerRt[] = WANDERERS.map((w, k) => {
    const char = new VoxelCharacter(w.look);
    scene.add(char.root);
    const [x, z] = w.route[0]!;
    return { char, route: w.route, i: 1, pos: new THREE.Vector3(x + 0.5, standHeight(world, x, z, terrainHeight(x, z) + 2), z + 0.5), yaw: 0, pause: k * 1.5 };
  });
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
  let nearNpc: NpcRt | null = null;
  let autopilot: Array<[number, number]> = [];
  let autoStuck = 0;
  let autoTime = 0;
  let lastAutoPos = new THREE.Vector3();
  const interactCbs = new Set<(npc: NpcRef) => void>();
  const hotbar: Array<string | null> = [null, null, null, null, null];
  let possessedId: string | null = null;
  let stepTimer = 0;
  let fps = 60;
  let frameMs = 16.7;
  let lastStats = { draw: 0, tris: 0 };
  const showFps = new URLSearchParams(location.search).has('fps');
  hud.setScene(SCENE_TITLES_KO[currentScene]);

  // ---- Initial meshing around the player before revealing.
  const meshUntilReady = async (): Promise<void> => {
    const t0 = performance.now();
    let total = -1;
    while (performance.now() - t0 < 12000) {
      chunks.update(body.x, body.z, tier.viewChunks, 24);
      const left = chunks.outstanding(body.x, body.z, Math.min(tier.viewChunks, 4));
      if (total < 0) total = Math.max(1, left);
      hud.setLoading(0.45 + 0.55 * (1 - left / total), false);
      if (left === 0) break;
      await wait(30);
    }
  };
  await meshUntilReady();

  // ---- Input.
  const keyDown = (e: KeyboardEvent): void => {
    sfx.unlock();
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    input.keys.add(e.code);
    if (e.code === 'KeyE') tryTalk();
    if (e.code === 'F5') {
      e.preventDefault();
      camMode = camMode === 'first' ? 'third' : 'first';
    }
    if (e.code === 'Tab' && !paused) {
      e.preventDefault();
      camMode = camMode === 'mirror' ? 'third' : 'mirror';
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5)) - 1;
      if (n >= 0 && n < 5) hud.selectSlot(n);
    }
    if (e.code === 'Space') e.preventDefault();
  };
  const keyUp = (e: KeyboardEvent): void => {
    input.keys.delete(e.code);
  };
  const cycleView = (): void => {
    camMode = camMode === 'third' ? 'first' : camMode === 'first' ? 'mirror' : 'third';
    sfx.play('ui.click');
  };
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  const pointerDown = (e: PointerEvent): void => {
    sfx.unlock();
    sfx.startAmbient();
    if (e.pointerType !== 'mouse') {
      // touch taps on NPCs (the HUD touch layer handles sticks; taps reach here only when it is off)
      tapPick(e.clientX, e.clientY);
      return;
    }
    dragging = true;
    dragMoved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const pointerMove = (e: PointerEvent): void => {
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
    if (dragging && dragMoved < 6) tapPick(e.clientX, e.clientY);
    dragging = false;
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    camDist = Math.max(3, Math.min(11, camDist + e.deltaY * 0.004));
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  // Touch layer taps (short touches without moving) also pick NPCs.
  hud.root.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') tapPick(e.clientX, e.clientY);
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
    const dst = SCENES[target];
    const from = SCENES[currentScene];
    let pts: Array<[number, number]>;
    if (target === 'plaza') pts = [...from.path].reverse().slice(1).concat([[dst.player.x, dst.player.z]]);
    else if (currentScene === 'plaza') pts = [...dst.path];
    else pts = [...from.path].reverse().slice(1).concat(dst.path);
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
        while (autopilot.length > 0 && !disposed) {
          await wait(50);
          if (autoStuck > 0.9 || autoTime > 9) break;
        }
        if (autopilot.length > 0) {
          autopilot = [];
          sfx.play('wld.door');
          await hud.fadeTo(SCENE_TITLES_KO[target], () => {
            snapToScene(target);
            placeNpcForScene(target, false);
          });
        } else {
          // settle on the exact spot and facing
          playerYaw = SCENES[target].player.yaw;
          camYaw = playerYaw + SCENES[target].cameraYaw;
          camPitch = SCENES[target].camPitch ?? camPitch;
          camDist = SCENES[target].camDist ?? camDist;
        }
      } else {
        sfx.play('wld.door');
        await hud.fadeTo(SCENE_TITLES_KO[target], () => {
          snapToScene(target);
          placeNpcForScene(target, false);
          chunks.update(body.x, body.z, tier.viewChunks, 32);
        });
      }
      currentScene = target;
    })();
    try {
      await travel;
    } finally {
      travel = null;
    }
  }

  // ---- Camera.
  const camTarget = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let camInit = false;
  const updateCamera = (dt: number): void => {
    const headY = body.y + body.stepOffset + 1.45;
    camTarget.set(body.x, headY, body.z);
    let wantPos: THREE.Vector3;
    let wantLook: THREE.Vector3;
    if (paused && focusNpc) {
      // Dialog framing (docs/08 5장 slow 320 ms): side-on two-shot of player and NPC.
      const mx = (body.x + focusNpc.pos.x) / 2;
      const mz = (body.z + focusNpc.pos.z) / 2;
      const dx = focusNpc.pos.x - body.x;
      const dz = focusNpc.pos.z - body.z;
      const len = Math.hypot(dx, dz) || 1;
      const sideX = -dz / len;
      const sideZ = dx / len;
      const behindX = -dx / len;
      const behindZ = -dz / len;
      const dist = Math.max(3.2, len * 1.2);
      wantPos = new THREE.Vector3(mx + sideX * dist + behindX * 1.6, body.y + 2.1, mz + sideZ * dist + behindZ * 1.6);
      wantLook = new THREE.Vector3(mx, body.y + 1.35, mz);
      // keep the camera out of walls
      const ddx = wantPos.x - wantLook.x;
      const ddy = wantPos.y - wantLook.y;
      const ddz = wantPos.z - wantLook.z;
      const dl = Math.hypot(ddx, ddy, ddz);
      const free = raycastDistance(blockAt, wantLook.x, wantLook.y, wantLook.z, ddx / dl, ddy / dl, ddz / dl, dl);
      if (free < dl) wantPos.set(wantLook.x + (ddx / dl) * (free - 0.3), wantLook.y + (ddy / dl) * (free - 0.3), wantLook.z + (ddz / dl) * (free - 0.3));
    } else if (camMode === 'first') {
      const f = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
      wantPos = new THREE.Vector3(body.x, body.y + body.stepOffset + 1.55, body.z);
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
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    camInit = true;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    player.setHeadVisible(!(camMode === 'first' && !paused));
    if (camMode !== 'third' || paused) player.setFade(1);
  };
  camPos.set(body.x - Math.sin(camYaw) * camDist, body.y + 3, body.z - Math.cos(camYaw) * camDist);

  // ---- Resize.
  const resize = (): void => {
    const w = canvas.clientWidth || hudParent.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || hudParent.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.fov = camera.aspect < 0.8 ? 80 : 70;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // ---- Frame loop.
  const tmp = new THREE.Vector3();
  const project = (x: number, y: number, z: number): { sx: number; sy: number; vis: boolean } => {
    tmp.set(x, y, z).project(camera);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    return { sx: (tmp.x * 0.5 + 0.5) * w, sy: (-tmp.y * 0.5 + 0.5) * h, vis: tmp.z < 1 && tmp.z > -1 };
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
    chunks.update(body.x, body.z, tier.viewChunks);
    updateCamera(dt);

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
    hud.flushBubbles();
    if (nearNpc && !paused && autopilot.length === 0 && !hud.hasBubble(nearNpc.def.id, nowMs)) {
      const p = project(nearNpc.pos.x, nearNpc.pos.y + CHAR_HEIGHT + 0.35, nearNpc.pos.z);
      hud.showPrompt(p.vis, p.sx, p.sy, touch);
    } else hud.showPrompt(false, 0, 0, touch);

    renderer.render(scene, camera);
    lastStats = { draw: renderer.info.render.calls, tris: renderer.info.render.triangles };
    forward.set(0, 0, 0);
  };
  hud.setLoading(1, true);
  raf = requestAnimationFrame(frame);

  // ---- Handle.
  const handle: WorldHandle = {
    goToScene,
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
      player.hand.add(heldItem);
      const hp = new THREE.Vector3();
      player.hand.getWorldPosition(hp);
      effects.sparkle(hp.x, hp.y, hp.z);
      sfx.play('item.get');
    },
    celebrate(stars) {
      hud.celebrate(stars, reduceMotion);
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
    setPaused(p) {
      paused = p;
      if (p) {
        autopilot = [];
        body.vx = 0;
        body.vz = 0;
        if (!focusNpc && nearNpc) focusNpc = nearNpc;
        if (!focusNpc) {
          // A lesson can pause the world without a tap on an NPC: frame whoever stands closest (counters are ~4 m wide).
          let best = 6;
          for (const n of npcs.values()) {
            const d = Math.hypot(n.pos.x - body.x, n.pos.z - body.z);
            if (d < best) {
              best = d;
              focusNpc = n;
            }
          }
        }
      } else {
        focusNpc = null;
        camYaw = playerYaw;
      }
      hud.setTouchPaused(p);
      hud.showPrompt(false);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('wheel', wheel);
      chunks.dispose();
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
    getScene: () => currentScene,
    listNpcs: () => [...npcs.values()].map((n) => n.ref),
    setLessonBadge: (on) => hud.setLessonBadge(on),
    getStats(): WorldStats {
      return {
        fps,
        frameMs,
        drawCalls: lastStats.draw,
        triangles: lastStats.tris,
        chunksMeshed: chunks.meshed,
        chunksVisible: chunks.visible,
        scene: currentScene,
        player: { x: body.x, y: body.y, z: body.z }
      };
    }
  };
  void pickVoxel;
  return handle;
}
