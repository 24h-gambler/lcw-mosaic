import type { AdventurePatternId } from '@lcw/content';
import { ADV } from './tuning.js';
import { pickOne, shuffle, type Rng } from './rng.js';
import { misspellings, type WordCard } from './plan.js';

/**
 * The islanders' turns: bullet patterns inside the notebook arena (docs/22 1.3). Pure and deterministic — a pattern is
 * its id, the arena, the words, a seeded rng and fixed-size steps; the engine reads `events` after each step (a hurt,
 * a caught letter, a right or wrong spelling) and turns them into voice, calm and the record.
 *
 * Roles: `hurt` bullets cost voice (HP); `good` ones are to be caught (the next letter, the right spelling, the word
 * that matches the picture); `bad` ones are the wrong choice and cost a little voice when caught.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BulletRole = 'hurt' | 'good' | 'bad';
export type BulletSprite = 'acorn' | 'leaf' | 'letter' | 'bubble' | 'shell' | 'roll' | 'sprinkle' | 'cookie' | 'comma' | 'ink' | 'kite' | 'dot';

export interface Bullet {
  alive: boolean;
  sprite: BulletSprite;
  role: BulletRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  r: number;
  /** Letter, spelling or word drawn on it ('' for plain bullets). */
  text: string;
  /** The word it belongs to (letters, bubbles, cookies). */
  word: string;
  t: number;
  /** Phase for wobble / spin. */
  ph: number;
  /** kiteDive: waits before diving. */
  wait: number;
  bounces: number;
}

export type PatternEvent =
  | { type: 'hurt'; dmg: number }
  | { type: 'letter'; word: string; complete: boolean }
  | { type: 'wrongLetter'; word: string }
  | { type: 'spelling'; word: string; ok: boolean }
  | { type: 'cookie'; word: string; ok: boolean };

export interface PatternState {
  id: AdventurePatternId;
  arena: Rect;
  t: number;
  duration: number;
  /** Seconds until the next spawn (per spawner). */
  timers: number[];
  bullets: Bullet[];
  events: PatternEvent[];
  words: WordCard[];
  wordIdx: number;
  /** letterCatch: letters of the current word caught so far. */
  letterIdx: number;
  /** wordCookies: the word to find. */
  prompt: WordCard | null;
  speed: number;
  angle: number;
  rng: Rng;
}

/** Arena size each pattern uses (the notebook page stretches to it). */
export function arenaFor(id: AdventurePatternId): { w: number; h: number } {
  switch (id) {
    case 'letterCatch':
    case 'spellBubbles':
    case 'wordCookies':
      return { w: 210, h: 112 };
    case 'shellSweep':
    case 'rollBounce':
      return { w: 190, h: 104 };
    case 'windSpiral':
    case 'kiteDive':
      return { w: 170, h: 112 };
    default:
      return { w: 150, h: 104 };
  }
}

export const ARENA_TOP = 118;

export function arenaRect(id: AdventurePatternId): Rect {
  const s = arenaFor(id);
  return { x: Math.round((ADV.screen.w - s.w) / 2), y: ARENA_TOP, w: s.w, h: s.h };
}

const MAX_BULLETS = 160;

export function startPattern(id: AdventurePatternId, words: readonly WordCard[], rng: Rng, opts: { duration: number; speed?: number }): PatternState {
  const ws = words.length ? [...words] : [{ w: 'word', ko: null, emoji: '✨', sentence: 'I know the word word.' }];
  const ps: PatternState = {
    id,
    arena: arenaRect(id),
    t: 0,
    duration: opts.duration,
    timers: [0.4, 0.8, 1.2],
    bullets: [],
    events: [],
    words: ws,
    wordIdx: Math.floor(rng() * ws.length),
    letterIdx: 0,
    prompt: null,
    speed: opts.speed ?? 1,
    angle: 0,
    rng
  };
  if (id === 'wordCookies') ps.prompt = ws[ps.wordIdx]!;
  return ps;
}

export function currentWord(ps: PatternState): WordCard {
  return ps.words[ps.wordIdx % ps.words.length]!;
}

function spawn(ps: PatternState, b: Partial<Bullet> & Pick<Bullet, 'sprite' | 'x' | 'y'>): Bullet | null {
  let slot = ps.bullets.find((x) => !x.alive);
  if (!slot) {
    if (ps.bullets.length >= MAX_BULLETS) return null;
    slot = { alive: false, sprite: 'dot', role: 'hurt', x: 0, y: 0, vx: 0, vy: 0, ay: 0, r: 3, text: '', word: '', t: 0, ph: 0, wait: 0, bounces: 0 };
    ps.bullets.push(slot);
  }
  Object.assign(slot, { alive: true, role: 'hurt', vx: 0, vy: 0, ay: 0, r: 3, text: '', word: '', t: 0, ph: ps.rng() * Math.PI * 2, wait: 0, bounces: 0 }, b);
  return slot;
}

const letters = 'abcdefghijklmnopqrstuvwxyz';

function spawners(ps: PatternState, k: number, soul: { x: number; y: number }): number {
  const a = ps.arena;
  const r = ps.rng;
  const s = ps.speed;
  const rx = (pad = 8) => a.x + pad + r() * (a.w - pad * 2);
  switch (ps.id) {
    case 'acornDrop':
      if (k > 0) return 99;
      spawn(ps, { sprite: 'acorn', x: rx(), y: a.y - 4, vy: (42 + r() * 22) * s, ay: 22 * s, r: 3 });
      return 0.32;
    case 'leafRing': {
      if (k > 0) return 99;
      const ox = rx(20);
      const gap = Math.floor(r() * 10);
      for (let i = 0; i < 12; i++) {
        if (i === gap || i === gap + 1) continue;
        const ang = (Math.PI * (0.1 + (0.8 * i) / 11));
        spawn(ps, { sprite: 'leaf', x: ox, y: a.y + 2, vx: Math.cos(ang) * 46 * s, vy: Math.sin(ang) * 46 * s, r: 3 });
      }
      return 1.15;
    }
    case 'letterCatch': {
      if (k === 0) {
        const word = currentWord(ps).w.replace(/[^a-z]/g, '');
        const need = word[ps.letterIdx] ?? word[0]!;
        const good = r() < 0.5;
        const ch = good ? need : pickOne([...letters].filter((c) => c !== need), r);
        spawn(ps, { sprite: 'letter', role: good ? 'good' : 'bad', text: ch, word: currentWord(ps).w, x: rx(10), y: a.y - 6, vy: (30 + r() * 12) * s, r: 6 });
        return 0.62;
      }
      if (k === 1) {
        spawn(ps, { sprite: 'ink', x: rx(), y: a.y - 4, vy: 58 * s, r: 3 });
        return 1.5;
      }
      return 99;
    }
    case 'spellBubbles': {
      if (k === 0) {
        const wc = currentWord(ps);
        const set = shuffle([wc.w, ...misspellings(wc.w, r, 2)], r);
        const xs = shuffle([0.2, 0.5, 0.8], r);
        set.forEach((txt, i) =>
          spawn(ps, {
            sprite: 'bubble',
            role: txt === wc.w ? 'good' : 'bad',
            text: txt,
            word: wc.w,
            x: a.x + a.w * xs[i]!,
            y: a.y + a.h + 10 + i * 6,
            vy: -26 * s,
            r: Math.max(9, txt.length * 2.6)
          })
        );
        return 3.0;
      }
      if (k === 1) {
        spawn(ps, { sprite: 'dot', x: rx(), y: a.y + a.h + 4, vy: -62 * s, r: 2 });
        return 0.7;
      }
      return 99;
    }
    case 'shellSweep': {
      if (k > 0) return 99;
      const fromLeft = r() < 0.5;
      const gapY = a.y + 16 + r() * (a.h - 48);
      for (let y = a.y + 6; y < a.y + a.h; y += 12) {
        if (y > gapY && y < gapY + 30) continue;
        spawn(ps, { sprite: 'shell', x: fromLeft ? a.x - 6 : a.x + a.w + 6, y, vx: (fromLeft ? 58 : -58) * s, r: 4 });
      }
      return 1.5;
    }
    case 'bubbleRise':
      if (k > 0) return 99;
      spawn(ps, { sprite: 'bubble', x: rx(), y: a.y + a.h + 6, vy: -(42 + r() * 24) * s, r: 3 });
      return 0.28;
    case 'rollBounce': {
      if (k > 0) return 99;
      const fromLeft = r() < 0.5;
      spawn(ps, { sprite: 'roll', x: fromLeft ? a.x + 4 : a.x + a.w - 4, y: a.y + 6, vx: (fromLeft ? 44 : -44) * s, vy: 0, ay: 150 * s, r: 5 });
      return 0.95;
    }
    case 'sprinkleRain':
      if (k > 0) return 99;
      spawn(ps, { sprite: 'sprinkle', x: a.x - 20 + r() * (a.w + 10), y: a.y - 4, vx: 26 * s, vy: 82 * s, r: 1.6 });
      return 0.13;
    case 'wordCookies': {
      if (k === 0) {
        const target = ps.prompt ?? currentWord(ps);
        const others = shuffle(ps.words.filter((w) => w.w !== target.w), r).slice(0, 2);
        const pool = others.length ? others : [{ ...target, w: misspellings(target.w, r, 1)[0]! }];
        const set = shuffle([target, ...pool], r);
        const fromLeft = r() < 0.5;
        const rows = shuffle([0.22, 0.5, 0.78], r);
        set.forEach((wc, i) =>
          spawn(ps, {
            sprite: 'cookie',
            role: wc.w === target.w ? 'good' : 'bad',
            text: wc.w,
            word: target.w,
            x: fromLeft ? a.x - 20 - i * 18 : a.x + a.w + 20 + i * 18,
            y: a.y + a.h * rows[i]!,
            vx: (fromLeft ? 34 : -34) * s,
            r: Math.max(9, wc.w.length * 2.6)
          })
        );
        return 3.2;
      }
      return 99;
    }
    case 'windSpiral': {
      if (k > 0) return 99;
      ps.angle += 0.42;
      const base = Math.PI * 0.5 + Math.sin(ps.angle) * 1.15;
      for (const off of [0, Math.PI * 0.42]) {
        const ang = base + (off ? (Math.sin(ps.angle * 0.7) > 0 ? off : -off) : 0);
        if (Math.sin(ang) <= 0.05) continue;
        spawn(ps, { sprite: 'comma', x: a.x + a.w / 2, y: a.y + 4, vx: Math.cos(ang) * 50 * s, vy: Math.sin(ang) * 50 * s, r: 2.5 });
      }
      return 0.16;
    }
    case 'inkRain':
      if (k > 0) return 99;
      spawn(ps, { sprite: 'ink', x: rx(), y: a.y - 4, vy: 50 * s, r: 3 });
      return 0.24;
    case 'kiteDive': {
      if (k > 0) return 99;
      const b = spawn(ps, { sprite: 'kite', x: rx(14), y: a.y + 8, r: 4, wait: 0.55 });
      if (b) b.ph = 0;
      void soul;
      return 1.15;
    }
  }
  return 99;
}

/** One fixed step. `vulnerable` = the soul can be hurt now (not in its blink after a hit). */
export function stepPattern(ps: PatternState, dt: number, soul: { x: number; y: number }, vulnerable: boolean): void {
  ps.t += dt;
  const a = ps.arena;
  if (ps.t < ps.duration - 0.6) {
    for (let k = 0; k < ps.timers.length; k++) {
      ps.timers[k]! -= dt;
      let guard = 0;
      while (ps.timers[k]! <= 0 && guard++ < 4) ps.timers[k]! += spawners(ps, k, soul);
    }
  }
  const sr = ADV.soul.hitRadius;
  for (const b of ps.bullets) {
    if (!b.alive) continue;
    b.t += dt;
    if (b.sprite === 'kite' && b.wait > 0) {
      b.wait -= dt;
      if (b.wait <= 0) {
        const dx = soul.x - b.x;
        const dy = soul.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        b.vx = (dx / d) * 105 * ps.speed;
        b.vy = (dy / d) * 105 * ps.speed;
      }
    }
    b.vy += b.ay * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.sprite === 'bubble' || b.sprite === 'leaf') b.x += Math.sin(b.t * 3 + b.ph) * 12 * dt;
    if (b.sprite === 'roll' && b.y > a.y + a.h - b.r) {
      b.y = a.y + a.h - b.r;
      b.vy = -Math.abs(b.vy) * 0.86;
      b.bounces += 1;
    }
    if (b.sprite === 'ink' && b.role === 'hurt' && b.r >= 3 && b.y > a.y + a.h - 3) {
      // a blot splashes into two small drops
      b.alive = false;
      for (const dir of [-1, 1]) spawn(ps, { sprite: 'ink', x: b.x, y: a.y + a.h - 4, vx: dir * 34 * ps.speed, vy: -60 * ps.speed, ay: 120 * ps.speed, r: 2 });
      continue;
    }
    const margin = 30;
    if (b.x < a.x - margin - 40 || b.x > a.x + a.w + margin + 40 || b.y < a.y - margin - 20 || b.y > a.y + a.h + margin || b.t > 9) {
      b.alive = false;
      continue;
    }
    // collisions only inside the page
    if (b.x < a.x || b.x > a.x + a.w || b.y < a.y || b.y > a.y + a.h) continue;
    const dx = b.x - soul.x;
    const dy = b.y - soul.y;
    const rr = b.r + sr;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (b.role === 'hurt') {
      if (!vulnerable) continue;
      b.alive = false;
      ps.events.push({ type: 'hurt', dmg: ADV.damage.hurt });
      vulnerable = false;
      continue;
    }
    // catches
    b.alive = false;
    if (b.sprite === 'letter') {
      if (b.role === 'good' && b.word === currentWord(ps).w) {
        const word = currentWord(ps).w.replace(/[^a-z]/g, '');
        ps.letterIdx += 1;
        const complete = ps.letterIdx >= word.length;
        ps.events.push({ type: 'letter', word: currentWord(ps).w, complete });
        if (complete) {
          ps.letterIdx = 0;
          ps.wordIdx = (ps.wordIdx + 1) % ps.words.length;
          // letters of the finished word still falling are no longer "next"
          for (const o of ps.bullets) if (o.alive && o.sprite === 'letter') o.role = 'bad';
        } else {
          // a falling copy of the letter just caught is not the next one anymore
          const need = word[ps.letterIdx];
          for (const o of ps.bullets) if (o.alive && o.sprite === 'letter') o.role = o.text === need ? 'good' : 'bad';
        }
      } else if (vulnerable) {
        ps.events.push({ type: 'wrongLetter', word: currentWord(ps).w });
        vulnerable = false;
      }
    } else if (b.sprite === 'bubble') {
      ps.events.push({ type: 'spelling', word: b.word, ok: b.role === 'good' });
      // the other bubbles of the same wave pop with it
      for (const o of ps.bullets) if (o.alive && o.sprite === 'bubble' && o.word === b.word && o.text) o.alive = false;
      if (b.role === 'good') ps.wordIdx = (ps.wordIdx + 1) % ps.words.length;
      else vulnerable = false;
    } else if (b.sprite === 'cookie') {
      ps.events.push({ type: 'cookie', word: b.word, ok: b.role === 'good' });
      for (const o of ps.bullets) if (o.alive && o.sprite === 'cookie') o.alive = false;
      if (b.role === 'good') {
        ps.wordIdx = (ps.wordIdx + 1) % ps.words.length;
        ps.prompt = ps.words[ps.wordIdx]!;
      } else vulnerable = false;
    }
  }
}

export function patternDone(ps: PatternState): boolean {
  return ps.t >= ps.duration;
}

/** The autopilot (`?autopilot=1`, real-screen checks): steer away from hurt bullets, toward the ones to catch. */
export function autopilotDir(ps: PatternState, soul: { x: number; y: number }): { x: number; y: number } {
  let fx = 0;
  let fy = 0;
  for (const b of ps.bullets) {
    if (!b.alive) continue;
    const dx = soul.x - b.x;
    const dy = soul.y - b.y;
    const d2 = dx * dx + dy * dy + 1;
    if (b.role === 'good') {
      if (d2 < 90 * 90) {
        fx -= (dx / Math.sqrt(d2)) * 2.2;
        fy -= (dy / Math.sqrt(d2)) * 2.2;
      }
      continue;
    }
    const reach = (b.r + 22) ** 2;
    if (d2 > reach * 3) continue;
    // look a little ahead along the bullet's path
    const ax = soul.x - (b.x + b.vx * 0.12);
    const ay = soul.y - (b.y + b.vy * 0.12);
    const a2 = ax * ax + ay * ay + 1;
    fx += (ax / a2) * 900;
    fy += (ay / a2) * 900;
  }
  const a = ps.arena;
  // stay away from the walls
  fx += 30 / Math.max(4, soul.x - a.x) - 30 / Math.max(4, a.x + a.w - soul.x);
  fy += 30 / Math.max(4, soul.y - a.y) - 30 / Math.max(4, a.y + a.h - soul.y);
  const m = Math.hypot(fx, fy);
  return m < 0.15 ? { x: 0, y: 0 } : { x: fx / m, y: fy / m };
}
