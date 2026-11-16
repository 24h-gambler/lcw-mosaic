/**
 * The teacher in the child's own world (Dan 11-16 12:10: the teacher comes into the student's world, the student
 * presses nothing). The lesson layer calls `world.setTeacher({ name })` when the lesson goes live and
 * `setTeacher(null)` when it ends; the world adds an NPC with id `TEACHER_NPC_ID`, so `npcSay('teacher', …)`,
 * `setPossessed`, dialogs and E/tap reach the teacher like any NPC. The teacher walks to stay a few steps from the
 * child (never on top of them) and carries a name plate over the head.
 */
import * as THREE from 'three';
import { COLOR_TOKENS as C, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { NpcDef, NpcLook } from './town.js';

export const TEACHER_NPC_ID = 'teacher';

/** One look for every teacher (no likeness of a real person): dark hair in a bun, a sky-blue cardigan. */
export const TEACHER_LOOK: NpcLook = { skin: 0xf0c8a0, hair: 0x3a2a22, shirt: 0x3fa9f5, pants: 0x2f3b52, shoes: 0x3a4152, hairStyle: 'bun' };

export function teacherDef(name: string): NpcDef {
  const clean = cleanTeacherName(name);
  return { id: TEACHER_NPC_ID, ctx: 'guide', nameKo: plateText(clean), nameEn: clean || 'Teacher', home: 'plaza', look: TEACHER_LOOK };
}

/** Teacher name for the plate: trimmed, folded, at most 16 characters; empty becomes "선생님" alone. */
export function cleanTeacherName(raw: string | null | undefined): string {
  const s = (raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, 16).join('');
}

export function plateText(name: string): string {
  const n = cleanTeacherName(name);
  return n ? `${n} 선생님` : '선생님';
}

/**
 * Where the teacher walks to: 2.4 m from the child, on the side away from where the child looks (so the teacher is
 * in view in first person, ahead-left). Returns null while the teacher is already close enough (no fidgeting).
 */
export function teacherTarget(px: number, pz: number, playerYaw: number, tx: number, tz: number): [number, number] | null {
  const d = Math.hypot(tx - px, tz - pz);
  if (d > 1.6 && d < 4.5) return null;
  const a = playerYaw + 0.6;
  return [px + Math.sin(a) * 2.4, pz + Math.cos(a) * 2.4];
}

/** A name plate sprite (canvas text), drawn over the teacher's head; always faces the camera. */
export function makePlate(text: string): THREE.Sprite {
  const px = 32;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const font = `800 ${px}px ${T.fonts.ui}`;
    let w = 200;
    if (ctx) {
      ctx.font = font;
      w = Math.ceil(ctx.measureText(text).width) + 40;
    }
    canvas.width = w;
    canvas.height = px + 24;
    if (ctx) {
      ctx.font = font;
      ctx.fillStyle = C['ink-900'];
      ctx.beginPath();
      ctx.roundRect(0, 0, w, px + 24, 14);
      ctx.fill();
      ctx.fillStyle = C.sun;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, (px + 24) / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
  }
  const s = new THREE.Sprite(mat);
  const h = 0.2;
  s.scale.set(h * ((canvas?.width ?? 200) / (canvas?.height ?? 56)), h, 1);
  s.renderOrder = 3;
  return s;
}

export function disposePlate(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}
