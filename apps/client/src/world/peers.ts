/**
 * Other people in the same multi room (docs/03 D11), drawn as voxel figures with a name plate.
 *
 * The room sends poses at most 10 times a second (TUNING.multi); each figure eases toward its latest pose so the
 * motion stays smooth at 60 fps, and its walk animation follows how fast it actually moves. Figures beyond the view
 * distance are hidden and skip their animation. Nothing here is authoritative: a peer's pose is only where to draw it.
 */
import * as THREE from 'three';
import { CHAR_HEIGHT, VoxelCharacter } from './character.js';
import type { NpcLook } from './town.js';

export interface PeerInfo {
  id: string;
  name: string;
  role: string;
}

interface PeerRt {
  info: PeerInfo;
  char: VoxelCharacter;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  speed: number;
  plate: HTMLDivElement;
  plateKey: string;
  seen: boolean;
}

type Project = (x: number, y: number, z: number) => { sx: number; sy: number; vis: boolean };

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

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
    private readonly look: (id: string) => NpcLook
  ) {}

  get count(): number {
    return this.peers.size;
  }

  add(info: PeerInfo, pose?: readonly number[]): void {
    this.remove(info.id);
    const char = new VoxelCharacter(this.look(info.id));
    this.scene.add(char.root);
    const plate = document.createElement('div');
    plate.className = 'lw-plate on';
    plate.textContent = info.name;
    plate.style.visibility = 'hidden';
    this.plateParent.appendChild(plate);
    const p = new THREE.Vector3(pose?.[0] ?? 0, pose?.[1] ?? 0, pose?.[2] ?? 0);
    const rt: PeerRt = { info, char, pos: p.clone(), target: p, yaw: pose?.[3] ?? 0, targetYaw: pose?.[3] ?? 0, speed: 0, plate, plateKey: '', seen: !!pose };
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

  pose(id: string, x: number, y: number, z: number, yaw: number): void {
    const rt = this.peers.get(id);
    if (!rt) return;
    rt.target.set(x, y, z);
    rt.targetYaw = yaw;
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
    // ~150 ms to close the gap (poses come every 200 ms while walking): smooth, and never more than one pose behind.
    const k = 1 - Math.exp(-dt / 0.15);
    for (const rt of this.peers.values()) {
      if (!rt.seen) continue;
      this.tmp.copy(rt.pos);
      const far = rt.target.distanceTo(rt.pos);
      // A jump of several metres (teleport, scene change) snaps instead of sliding through walls.
      if (far > 8) rt.pos.copy(rt.target);
      else rt.pos.lerp(rt.target, k);
      rt.yaw += wrap(rt.targetYaw - rt.yaw) * k;
      const moved = dt > 0 ? Math.hypot(rt.pos.x - this.tmp.x, rt.pos.z - this.tmp.z) / dt : 0;
      rt.speed += (moved - rt.speed) * Math.min(1, dt * 8);
      const visible = rt.pos.distanceTo(me) < viewDistance;
      rt.char.root.visible = visible;
      if (visible) {
        rt.char.root.position.copy(rt.pos);
        rt.char.root.rotation.y = rt.yaw;
        rt.char.update(dt, { speed: rt.speed, talking: false, lookYaw: 0 });
      }
      const p = visible && showPlates ? project(rt.pos.x, rt.pos.y + CHAR_HEIGHT + 0.25, rt.pos.z) : null;
      const key = p && p.vis ? `${Math.round(p.sx)}:${Math.round(p.sy)}` : 'off';
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
