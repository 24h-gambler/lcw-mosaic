/**
 * Other people in the same multi room (docs/03 D11), drawn as voxel figures with a name plate.
 *
 * A sender sends a pose only when the receivers' prediction would be off (room-client.ts, at most ~1.2 a second on
 * average); between poses each figure walks on along the velocity that came with the pose and eases out corrections
 * (peer-motion.ts), so the motion stays smooth at 60 fps, and its walk animation follows how fast it actually moves. Figures beyond the view
 * distance are hidden and skip their animation. Nothing here is authoritative: a peer's pose is only where to draw it.
 */
import * as THREE from 'three';
import { CHAR_HEIGHT, VoxelCharacter } from './character.js';
import type { NpcLook } from './town.js';
import { PeerMotion, peerMotionOf } from './peer-motion.js';

export interface PeerInfo {
  id: string;
  name: string;
  role: string;
}

interface PeerRt {
  info: PeerInfo;
  char: VoxelCharacter;
  pos: THREE.Vector3;
  motion: PeerMotion;
  yaw: number;
  speed: number;
  plate: HTMLDivElement;
  plateKey: string;
  seen: boolean;
}

type Project = (x: number, y: number, z: number) => { sx: number; sy: number; vis: boolean };

/** Same look for the same id on every screen: the shirt comes from the town's own palette. */
export function peerLook(id: string, base: NpcLook, shirts: readonly number[]): NpcLook {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return { ...base, shirt: shirts.length ? shirts[h % shirts.length]! : base.shirt, hairStyle: (['short', 'bun', 'long', 'cap'] as const)[h % 4]! };
}

export class PeerAvatars {
  private readonly peers = new Map<string, PeerRt>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly plateParent: HTMLElement,
    private readonly look: (info: PeerInfo) => NpcLook,
    private readonly plateOf: (info: PeerInfo) => string = (info) => info.name,
    /** Fades a plate that runs under a HUD part (hud.fadePlate): checked every frame, the HUD can change under a still plate. */
    private readonly fadePlate: ((plate: HTMLElement, sx: number, sy: number) => void) | null = null
  ) {}

  get count(): number {
    return this.peers.size;
  }

  /** How many people with this role are in the room (a teacher in the world replaces the visiting-teacher figure). */
  countRole(role: string): number {
    let n = 0;
    for (const rt of this.peers.values()) if (rt.info.role === role) n++;
    return n;
  }

  /** Everyone placed in the room, where they are drawn now (the minimap pins, R325). */
  placed(): Array<{ id: string; name: string; role: string; x: number; z: number }> {
    const out: Array<{ id: string; name: string; role: string; x: number; z: number }> = [];
    for (const rt of this.peers.values()) if (rt.seen) out.push({ id: rt.info.id, name: rt.info.name, role: rt.info.role, x: rt.pos.x, z: rt.pos.z });
    return out;
  }

  /** Someone placed within `r` m whose room id sorts below `idAbove` (R325 spawn step-aside; no allocation per frame). */
  anyWithin(x: number, z: number, r: number, idAbove: string): boolean {
    for (const rt of this.peers.values()) {
      if (rt.seen && idAbove > rt.info.id && Math.hypot(rt.pos.x - x, rt.pos.z - z) < r) return true;
    }
    return false;
  }

  /**
   * People of this role are drawn by someone else (R325: the teacher in the child's world is the one teacher figure the
   * world owns, an NPC you can talk and trade with, placed where the real teacher walks): no second figure or plate.
   */
  hiddenRole: string | null = null;

  /** Where the first placed person of a role stands now (predicted between poses), or null. */
  roleAt(role: string): { x: number; y: number; z: number; yaw: number; name: string } | null {
    for (const rt of this.peers.values()) {
      if (rt.seen && rt.info.role === role) return { x: rt.pos.x, y: rt.pos.y, z: rt.pos.z, yaw: rt.yaw, name: rt.info.name };
    }
    return null;
  }

  /** Where the nearest placed person (of a role, if given) stands: for "학생 옆으로". */
  nearest(me: THREE.Vector3, role?: string): { x: number; y: number; z: number; yaw: number } | null {
    let best: PeerRt | null = null;
    let bd = Infinity;
    const now = performance.now();
    let at: { x: number; y: number; z: number; yaw: number } | null = null;
    for (const rt of this.peers.values()) {
      if (!rt.seen || (role !== undefined && rt.info.role !== role)) continue;
      const p = rt.motion.predicted(now);
      const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
      if (d < bd) {
        bd = d;
        best = rt;
        at = p;
      }
    }
    return best && at ? at : null;
  }

  add(info: PeerInfo, pose?: readonly number[]): void {
    this.remove(info.id);
    const char = new VoxelCharacter(this.look(info));
    this.scene.add(char.root);
    const plate = document.createElement('div');
    plate.className = 'lw-plate on';
    plate.textContent = this.plateOf(info);
    plate.style.visibility = 'hidden';
    this.plateParent.appendChild(plate);
    const p = new THREE.Vector3(pose?.[0] ?? 0, pose?.[1] ?? 0, pose?.[2] ?? 0);
    const motion = new PeerMotion();
    // a hello entry carries velocity, turn rate and age: keep drawing them moving from where they are by now
    const m = pose ? peerMotionOf(pose) : null;
    if (pose && m) {
      const now = performance.now();
      motion.set(p.x, p.y, p.z, pose[3] ?? 0, m.vx, m.vz, now - m.ageMs, m.w);
      motion.settle(now);
      p.set(motion.x, motion.y, motion.z);
    }
    const rt: PeerRt = { info, char, pos: p, motion, yaw: pose ? motion.yaw : 0, speed: 0, plate, plateKey: '', seen: !!pose };
    // Not placed yet (joined, no pose so far): stay hidden instead of standing at the world origin.
    char.root.visible = rt.seen;
    this.peers.set(info.id, rt);
  }

  remove(id: string): void {
    const rt = this.peers.get(id);
    if (!rt) return;
    this.scene.remove(rt.char.root);
    rt.char.dispose();
    rt.plate.remove();
    this.peers.delete(id);
  }

  pose(id: string, x: number, y: number, z: number, yaw: number, vx = 0, vz = 0, w = 0): void {
    const rt = this.peers.get(id);
    if (!rt) return;
    rt.motion.set(x, y, z, yaw, vx, vz, performance.now(), w);
    if (!rt.seen) {
      rt.seen = true;
      rt.pos.set(x, y, z);
      rt.yaw = yaw;
    }
  }

  emote(id: string, e: string): void {
    const rt = this.peers.get(id);
    if (!rt) return;
    if (e === 'wave') rt.char.wave();
    else rt.char.cheer();
  }

  update(dt: number, project: Project, viewDistance: number, me: THREE.Vector3, showPlates: boolean): void {
    const now = performance.now();
    for (const rt of this.peers.values()) {
      if (!rt.seen) continue;
      this.tmp.copy(rt.pos);
      rt.motion.step(dt, now);
      rt.pos.set(rt.motion.x, rt.motion.y, rt.motion.z);
      rt.yaw = rt.motion.yaw;
      const moved = dt > 0 ? Math.hypot(rt.pos.x - this.tmp.x, rt.pos.z - this.tmp.z) / dt : 0;
      rt.speed += (moved - rt.speed) * Math.min(1, dt * 8);
      const visible = rt.pos.distanceTo(me) < viewDistance && rt.info.role !== this.hiddenRole;
      rt.char.root.visible = visible;
      if (visible) {
        rt.char.root.position.copy(rt.pos);
        rt.char.root.rotation.y = rt.yaw;
        rt.char.update(dt, { speed: rt.speed, talking: false, lookYaw: 0 });
      }
      const p = visible && showPlates ? project(rt.pos.x, rt.pos.y + CHAR_HEIGHT + 0.25, rt.pos.z) : null;
      const key = p && p.vis ? `${Math.round(p.sx)}:${Math.round(p.sy)}` : 'off';
      if (p && p.vis) this.fadePlate?.(rt.plate, Math.round(p.sx), Math.round(p.sy));
      if (key === rt.plateKey) continue;
      rt.plateKey = key;
      if (!p || !p.vis) rt.plate.style.visibility = 'hidden';
      else {
        rt.plate.style.visibility = 'visible';
        rt.plate.style.transform = `translate(${Math.round(p.sx)}px, ${Math.round(p.sy)}px) translate(-50%, -100%)`;
      }
    }
  }

  clear(): void {
    for (const id of [...this.peers.keys()]) this.remove(id);
  }
}
