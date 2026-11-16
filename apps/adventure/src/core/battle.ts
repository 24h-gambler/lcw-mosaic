import type { AdventureLine } from '@lcw/content';
import { ADV } from './tuning.js';
import { calmFor, type Graded, type Stars } from './grade.js';
import { autopilotDir, patternDone, startPattern, stepPattern, type PatternState } from './bullets.js';
import { talkChoices, type EncounterPlan, type TalkItem } from './plan.js';
import type { Rng } from './rng.js';
import { S } from '../ui/strings.js';

/**
 * One encounter (A03): the turn order and every number in it, without drawing. The engine feeds it input and steps;
 * the panel reads `phase`, `msg`, `choices`; the canvas reads `pattern`, `soul`, bars. docs/22 1장·4장.
 *
 * intro → menu → (TALK: talkPick → talk → react) | (POKE: poke → msg) | (POUCH: pouch → msg) | (FRIEND: befriend → end)
 *       → dodge (the islander's turn) → menu …   voice 0 → down → intro again (slower bullets, calm kept at half)
 */

export type Command = 'poke' | 'talk' | 'pouch' | 'friend';
export type Phase = 'msg' | 'menu' | 'talkPick' | 'talk' | 'pouch' | 'poke' | 'befriend' | 'dodge' | 'end';
export type ItemKey = 'honeyDrop' | 'berryBun';

export interface Msg {
  who: 'creature' | 'narrator' | 'keeper';
  line: AdventureLine;
}

export interface BattleHooks {
  sfx?(name: 'hurt' | 'catch' | 'wordDone' | 'wrong' | 'calm' | 'heal' | 'poke' | 'miss' | 'friend' | 'ready' | 'down' | 'select'): void;
  word?(word: string, kind: 'caught' | 'missed'): void;
  hurt?(dmg: number): void;
  calm?(gain: number): void;
}

export const ITEM_INFO: Record<ItemKey, { en: string; ko: string; heal: number }> = {
  honeyDrop: { ...S.items.honeyDrop, heal: ADV.items.honeyDrop.heal },
  berryBun: { ...S.items.berryBun, heal: ADV.items.berryBun.heal }
};

export class Battle {
  phase: Phase = 'msg';
  msgs: Msg[] = [];
  private after: Phase | 'turn' | 'restart' | 'endSpared' | 'endFought' = 'menu';
  hp: number = ADV.hp.max;
  calm = 0;
  grump: number;
  turn = 0;
  done = new Set<string>();
  choices: TalkItem[] = [];
  current: TalkItem | null = null;
  pattern: PatternState | null = null;
  turnLine: AdventureLine | null = null;
  soul = { x: 160, y: 170 };
  invuln = 0;
  /** POKE ring 1 → 0 over pokeRingMs. */
  ring = 0;
  /** Last caught letters of letterCatch (drawn above the page). */
  downs = 0;
  outcome: 'spared' | 'fought' | null = null;
  slow = 1;
  flash = 0;
  shake = 0;

  constructor(
    readonly enc: EncounterPlan,
    private readonly rng: Rng,
    readonly items: Record<ItemKey, number>,
    private readonly hooks: BattleHooks = {}
  ) {
    this.grump = enc.grumpMax;
    this.say([{ who: 'narrator', line: enc.creature.intro }], 'menu');
  }

  get ready(): boolean {
    return this.calm >= this.enc.calmMax;
  }

  private say(msgs: Msg[], then: Battle['after']) {
    this.msgs = msgs;
    this.after = then;
    this.phase = 'msg';
  }

  /** Confirm on a message: next message, or what comes after. */
  advance(): void {
    if (this.phase !== 'msg') return;
    this.msgs.shift();
    if (this.msgs.length) return;
    const a = this.after;
    if (a === 'turn') this.startTurn();
    else if (a === 'restart') this.restart();
    else if (a === 'endSpared') this.finish('spared');
    else if (a === 'endFought') this.finish('fought');
    else this.phase = a;
  }

  choose(cmd: Command): void {
    if (this.phase !== 'menu') return;
    this.hooks.sfx?.('select');
    if (cmd === 'talk') {
      this.choices = talkChoices(this.enc.talks, this.done, this.turn);
      this.phase = 'talkPick';
    } else if (cmd === 'pouch') {
      if (this.items.honeyDrop + this.items.berryBun <= 0) {
        this.say([{ who: 'narrator', line: S.narr.pouchEmpty }], 'menu');
        return;
      }
      this.phase = 'pouch';
    } else if (cmd === 'poke') {
      this.ring = 1;
      this.phase = 'poke';
    } else if (cmd === 'friend') {
      if (!this.ready) {
        this.say([{ who: 'narrator', line: S.narr.notReady(this.enc.creature.nameEn, this.enc.creature.nameKo) }], 'menu');
        return;
      }
      this.phase = 'befriend';
    }
  }

  back(): void {
    if (this.phase === 'talkPick' || this.phase === 'pouch' || this.phase === 'talk') {
      this.phase = 'menu';
      this.current = null;
    }
  }

  pickTalk(id: string): void {
    if (this.phase !== 'talkPick') return;
    const t = this.choices.find((c) => c.id === id);
    if (!t) return;
    this.current = t;
    this.phase = 'talk';
  }

  /** The talk panel's result (one attempt). Retry keeps the panel open (no penalty), a pass moves on. */
  talkResult(g: Graded): 'retry' | 'next' {
    if (this.phase !== 'talk' || !this.current) return 'next';
    const t = this.current;
    if (!g.pass || g.stars === 0) return 'retry';
    const gain = calmFor(g.stars);
    this.calm = Math.min(this.enc.calmMax, this.calm + gain);
    this.hooks.calm?.(gain);
    this.hooks.sfx?.('calm');
    if (g.stars >= 2) this.done.add(t.id);
    this.current = null;
    const react: Msg = { who: 'creature', line: this.enc.creature.react[g.stars as Stars] };
    if (this.ready) {
      this.hooks.sfx?.('ready');
      this.say([react, { who: 'narrator', line: this.enc.creature.ready }], 'menu');
    } else this.say([react], 'turn');
    return 'next';
  }

  /** Gave up on this TALK (back to the menu, the islander takes its turn: nothing is lost). */
  talkSkip(): void {
    if (this.phase !== 'talk') return;
    this.current = null;
    this.say([{ who: 'creature', line: this.enc.creature.react[0] }], 'turn');
  }

  useItem(k: ItemKey): void {
    if (this.phase !== 'pouch' || this.items[k] <= 0) return;
    this.items[k] -= 1;
    const heal = Math.min(ADV.hp.max - this.hp, ITEM_INFO[k].heal);
    this.hp += heal;
    this.hooks.sfx?.('heal');
    this.say([{ who: 'narrator', line: S.narr.ate(ITEM_INFO[k].en, ITEM_INFO[k].ko, heal) }], 'turn');
  }

  /** POKE: strike when the shrinking ring meets the mark. */
  strike(): void {
    if (this.phase !== 'poke') return;
    const r = this.ring;
    // the mark sits at 25% of the ring's start size
    const acc = Math.max(0, 1 - Math.abs(r - 0.25) / 0.5);
    this.resolvePoke(acc);
  }

  private resolvePoke(acc: number) {
    const c = this.enc.creature;
    if (acc <= 0.05) {
      this.hooks.sfx?.('miss');
      this.say([{ who: 'narrator', line: S.narr.missed }], 'turn');
      return;
    }
    const dmg = Math.round(ADV.pokeDamage * Math.max(0.3, acc));
    this.grump = Math.max(0, this.grump - dmg);
    this.hooks.sfx?.('poke');
    this.shake = ADV.shakeMs / 1000;
    if (this.grump <= 0) this.say([{ who: 'creature', line: c.poked }, { who: 'narrator', line: c.leaves }], 'endFought');
    else this.say([{ who: 'creature', line: c.poked }], 'turn');
  }

  /** FRIEND after calm is full; `said` = the child also said the friendship sentence (recorded by the engine). */
  befriend(): void {
    if (this.phase !== 'befriend') return;
    this.hooks.sfx?.('friend');
    this.say([{ who: 'creature', line: this.enc.creature.friend }], 'endSpared');
  }

  private startTurn() {
    const c = this.enc.creature;
    const id = c.patterns[this.turn % c.patterns.length]!;
    const [lo, hi] = this.enc.cls === 'critter' ? ADV.turnSec.critter : ADV.turnSec.guardian;
    const duration = lo + this.rng() * (hi - lo);
    this.pattern = startPattern(id, this.enc.words, this.rng, { duration, speed: this.slow });
    this.turnLine = c.turns[this.turn % c.turns.length]!;
    const a = this.pattern.arena;
    this.soul = { x: a.x + a.w / 2, y: a.y + a.h * 0.62 };
    this.invuln = 0.4;
    this.turn += 1;
    this.phase = 'dodge';
  }

  private restart() {
    this.hp = ADV.hp.max;
    this.calm = Math.floor(this.calm / 2);
    this.grump = this.enc.grumpMax;
    this.slow = ADV.retrySlow;
    this.pattern = null;
    this.say([{ who: 'narrator', line: this.enc.creature.intro }], 'menu');
  }

  private finish(o: 'spared' | 'fought') {
    this.outcome = o;
    this.phase = 'end';
    this.pattern = null;
  }

  /** One fixed step. `dir` = the soul's input (−1..1 each), ignored when the autopilot drives. */
  step(dt: number, dir: { x: number; y: number }, autopilot = false): void {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (this.phase === 'poke') {
      this.ring -= dt / (ADV.pokeRingMs / 1000);
      if (this.ring <= 0) {
        this.ring = 0;
        this.resolvePoke(0);
      }
      return;
    }
    if (this.phase !== 'dodge' || !this.pattern) return;
    const ps = this.pattern;
    const d = autopilot ? autopilotDir(ps, this.soul) : dir;
    const m = Math.hypot(d.x, d.y);
    if (m > 0) {
      const k = Math.min(1, m) / m;
      this.soul.x += d.x * k * ADV.soul.speed * dt;
      this.soul.y += d.y * k * ADV.soul.speed * dt;
    }
    const a = ps.arena;
    const half = ADV.soul.size / 2;
    this.soul.x = Math.max(a.x + half, Math.min(a.x + a.w - half, this.soul.x));
    this.soul.y = Math.max(a.y + half, Math.min(a.y + a.h - half, this.soul.y));
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    stepPattern(ps, dt, this.soul, this.invuln <= 0);
    for (const e of ps.events) {
      if (e.type === 'hurt') this.hurt(e.dmg);
      else if (e.type === 'letter') {
        this.addCalm(e.complete ? ADV.catchCalm.word : ADV.catchCalm.letter);
        this.hooks.sfx?.(e.complete ? 'wordDone' : 'catch');
        if (e.complete) this.hooks.word?.(e.word, 'caught');
      } else if (e.type === 'wrongLetter') {
        this.hooks.word?.(e.word, 'missed');
        this.hurt(ADV.damage.wrongCatch, true);
      } else if (e.type === 'spelling' || e.type === 'cookie') {
        if (e.ok) {
          this.addCalm(e.type === 'spelling' ? ADV.catchCalm.bubble : ADV.catchCalm.cookie);
          this.hooks.sfx?.('wordDone');
          this.hooks.word?.(e.word, 'caught');
        } else {
          this.hooks.word?.(e.word, 'missed');
          this.hurt(ADV.damage.wrongCatch, true);
        }
      }
    }
    ps.events.length = 0;
    if (this.hp <= 0) {
      this.downs += 1;
      this.pattern = null;
      this.hooks.sfx?.('down');
      this.say([{ who: 'narrator', line: S.narr.voiceRest }], 'restart');
      return;
    }
    if (patternDone(ps)) {
      this.pattern = null;
      this.turnLine = null;
      this.phase = 'menu';
    }
  }

  private addCalm(n: number) {
    const before = this.ready;
    this.calm = Math.min(this.enc.calmMax, this.calm + n);
    this.hooks.calm?.(n);
    if (!before && this.ready) this.hooks.sfx?.('ready');
  }

  private hurt(dmg: number, wrong = false) {
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = ADV.soul.invulnMs / 1000;
    this.flash = ADV.hitFlashMs / 1000;
    this.hooks.hurt?.(dmg);
    this.hooks.sfx?.(wrong ? 'wrong' : 'hurt');
  }
}
