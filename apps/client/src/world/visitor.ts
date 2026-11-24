/**
 * The teacher in the child's own world (Dan 11-16 12:10: the teacher comes into the student's world, the student
 * presses nothing). The lesson layer calls `world.setTeacher({ name })` when the lesson goes live and
 * `setTeacher(null)` when it ends; the world adds an NPC with id `TEACHER_NPC_ID`, so `npcSay('teacher', …)`,
 * `setPossessed`, dialogs and E/tap reach the teacher like any NPC. The teacher walks to stay a few steps from the
 * child (never on top of them) and carries a name plate over the head.
 */
import { helpKoOn } from './lang.js';
import { teacherNameEn } from './strings.js';
import * as THREE from 'three';
import { COLOR_TOKENS as C, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { NpcDef, NpcLook } from './town.js';

export const TEACHER_NPC_ID = 'teacher';

/** One look for every teacher (no likeness of a real person): dark hair in a bun, a sky-blue cardigan. */
export const TEACHER_LOOK: NpcLook = { skin: 0xf0c8a0, hair: 0x3a2a22, shirt: 0x3fa9f5, pants: 0x2f3b52, shoes: 0x3a4152, hairStyle: 'bun' };

/**
 * Can E, a tap or the dialog frame pick this NPC? The teacher too (R325, Dan 11-19 "선생님에게 상호작용하면 언제든 거래
 * 창"): E, a click or a tap on the teacher opens the trade window. In a lesson the stage's NPC still wins E when both are
 * in reach (every NPC but the lesson's scores +1.5 in the engine, review of #86).
 */
export function pickableNpc(def: Pick<NpcDef, 'id' | 'soloOnly'>, lesson: boolean): boolean {
  return !(lesson && def.soloOnly);
}

/**
 * The score E and the talk prompt rank NPCs in reach by (lower wins). Distance, plus a turn cost: one in front of the
 * view beats one just behind the child's back (R2625 ④). A passer-by scores +1.5, so the lesson's NPC wins unless the
 * passer is clearly the one in front (Dan 11-19). R331: the real teacher who walked up and stands in front of the view
 * scores -2.5, so E reaches the teacher even with the lesson's guide at the child's feet (live 11-24: guide 0.8 m below
 * the gaze, teacher 2 m straight ahead, E went to the guide and the trade never opened). E at the teacher still answers
 * an open sentence first (`lessonTalkAction` 'reopen'), so the lesson's sentence is never skipped by this.
 */
export function npcTalkScore(p: { dist: number; off: number; passer: boolean; realTeacher: boolean }): number {
  let score = p.dist + (p.off > 1.2 ? 2.5 : p.off * 0.6);
  if (p.passer) score += 1.5;
  if (p.realTeacher && p.off < 0.7) score -= 2.5;
  return score;
}

export function teacherDef(name: string): NpcDef {
  const clean = cleanTeacherName(name);
  const bare = clean.replace(/\s*선생님$/, '').trim();
  // nameKo stays Korean (the lesson and dialog lanes put it in Korean lines); nameEn is the screen name
  return { id: TEACHER_NPC_ID, ctx: 'guide', nameKo: bare ? `${bare} 선생님` : '선생님', nameEn: teacherNameEn(clean) ?? 'Teacher', home: 'plaza', look: TEACHER_LOOK };
}

/** Teacher name for the plate: trimmed, folded, at most 16 characters. */
export function cleanTeacherName(raw: string | null | undefined): string {
  const s = (raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, 16).join('');
}

/**
 * The name plate over the teacher, in the language the child learns (Dan 11-16 14:3x): the name alone ("Ms. Kim"),
 * "Teacher" without one. A Korean title the console typed ("김 선생님", the server default "선생님") is dropped from
 * the English plate and comes back in the Korean help line when that is on ("Ms. Kim · Ms. Kim 선생님").
 */
export function plateText(name: string, help = helpKoOn()): string {
  const n = cleanTeacherName(name);
  const bare = n.replace(/\s*선생님$/, '').trim();
  const en = teacherNameEn(n) ?? 'Teacher';
  if (!help) return en;
  const ko = bare ? `${bare} 선생님` : '선생님';
  return `${en} · ${ko}`;
}

/**
 * Where the teacher walks to: 2.4 m from the child, in front and 34° to one side of where the child looks (in view in
 * first person, beside a stage NPC rather than between). Returns null while the teacher is already close enough.
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
