import { ADVENTURE_ITEMS, ADVENTURE_SKILLS, type AdventureItemId, type AdventureLevel, type AdventureLine, type AdventureSkillId } from '@lcw/content';
import { ADV } from './tuning.js';
import { calmFor, type Graded, type Stars } from './grade.js';
import { autopilotDir, patternDone, startPattern, stepPattern, type PatternState } from './bullets.js';
import { skillItem, talkChoices, type EncounterPlan, type TalkItem } from './plan.js';
import { calmGain, heal as healRun, hitCost, hurt as hurtRun, maxHp, type Run } from './run.js';
import type { Rng } from './rng.js';
import { S } from '../ui/strings.js';

/**
 * One encounter (A03): the turn order and every number in it, without drawing. The engine feeds it input and steps;
 * the panel reads `phase`, `msg`, `choices`; the canvas reads `pattern`, `soul`, bars. docs/22 1장·4장.
 *
 * intro → menu → (TALK: talkPick → talk → react) | (SKILL: skillPick → talk → effect) | (POKE: poke → msg)
 *       | (POUCH: pouch → msg) | (FRIEND: befriend → end) → dodge (the islander's turn) → menu …
 *
 * R2734: the voice (HP) is the trip's (`run.hp`), not the meeting's. At 0 the meeting ends 'down' and the engine wakes
 * the Keeper at the last lantern post. A guardian has stages: at each step of calm (or of grump lost) it says a line and
 * its turns change (new patterns, faster, harder hits).
 */

export type Command = 'poke' | 'talk' | 'pouch' | 'friend';
/** R2861: exactly four choices — attack, talk, item, let them go. Magic words live inside TALK. */
export const MENU: readonly Command[] = ['poke', 'talk', 'pouch', 'friend'];
export type Phase = 'msg' | 'menu' | 'talkPick' | 'skillPick' | 'talk' | 'pouch' | 'poke' | 'befriend' | 'dodge' | 'end';
export type ItemKey = AdventureItemId;
export const ITEM_KEYS: readonly ItemKey[] = ['honeyDrop', 'berryBun', 'starTea'];

export interface Msg {
  who: 'creature' | 'narrator' | 'keeper';
  line: AdventureLine;
}

export type BattleSfx =
  | 'hurt'
  | 'catch'
  | 'wordDone'
  | 'wrong'
  | 'calm'
  | 'heal'
  | 'poke'
  | 'miss'
  | 'friend'
  | 'ready'
  | 'down'
  | 'select'
  | 'skill'
  | 'stage';

export interface BattleHooks {
  sfx?(name: BattleSfx): void;
  word?(word: string, kind: 'caught' | 'missed'): void;
  hurt?(dmg: number): void;
  calm?(gain: number): void;
  /** A guardian moved to stage `i` (0 = the first). */
  stage?(i: number): void;
}

export interface BattleOpts {
  level: AdventureLevel;
  /** Bullet speed for this meeting (a guardian met again after running out of voice is slower). */
  speedMul?: number;
}

export const ITEM_INFO: Record<ItemKey, { en: string; ko: string; heal: number }> = {
  honeyDrop: { en: ADVENTURE_ITEMS.honeyDrop.nameEn, ko: ADVENTURE_ITEMS.honeyDrop.nameKo, heal: ADV.items.honeyDrop.heal },
  berryBun: { en: ADVENTURE_ITEMS.berryBun.nameEn, ko: ADVENTURE_ITEMS.berryBun.nameKo, heal: ADV.items.berryBun.heal },
  starTea: { en: ADVENTURE_ITEMS.starTea.nameEn, ko: ADVENTURE_ITEMS.starTea.nameKo, heal: ADV.items.starTea.heal }
};

export class Battle {
  phase: Phase = 'msg';
  msgs: Msg[] = [];
  private after: Phase | 'turn' | 'endSpared' | 'endFought' | 'endDown' = 'menu';
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
  downs = 0;
  outcome: 'spared' | 'fought' | 'down' | null = null;
  slow: number;
  flash = 0;
  shake = 0;
  /** Guardian stage (index into enc.stages; 0 when it has none). */
  stage = 0;
  /** Skills said in this meeting (each once). */
  usedSkills = new Set<AdventureSkillId>();
  /** SAID English lines passed in this meeting (voice or typed). A fight cannot end until at least one (R2861: English gates progress). */
  talkPasses = 0;
  /** Next turn only: hits hurt less (Shield Song) / bullets slower (Slow Wind). */
  shield = false;
  windSlow = false;
  /** Skills that can still be said now (the SKILL list). */
  skillList: AdventureSkillId[] = [];

  constructor(
    readonly enc: EncounterPlan,
    private readonly rng: Rng,
    readonly run: Run,
    private readonly hooks: BattleHooks = {},
    readonly opts: BattleOpts = { level: 1 }
  ) {
    this.grump = enc.grumpMax;
    this.slow = opts.speedMul ?? 1;
    const first = enc.stages[0];
    this.say([{ who: 'narrator', line: enc.creature.intro }, ...(first ? [{ who: 'creature' as const, line: first.line }] : [])], 'menu');
  }

  get hp(): number {
    return this.run.hp;
  }
  get hpMax(): number {
    return maxHp(this.run);
  }
  get items(): Record<ItemKey, number> {
    return this.run.items;
  }
  get ready(): boolean {
    return this.calm >= this.enc.calmMax;
  }
  /** CALM is full and the child has actually spoken English in this meeting: only then can it be let go. */
  get spareReady(): boolean {
    return this.ready && this.talkPasses > 0;
  }
  get stageCount(): number {
    return this.enc.stages.length;
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
    else if (a === 'endSpared') this.finish('spared');
    else if (a === 'endFought') this.finish('fought');
    else if (a === 'endDown') this.finish('down');
    else this.phase = a;
  }

  choose(cmd: Command): void {
    if (this.phase !== 'menu') return;
    this.hooks.sfx?.('select');
    if (cmd === 'talk') {
      const base = talkChoices(this.enc.talks, this.done, this.turn);
      // R2861: magic words are said as English inside TALK (the four-choice menu has no fifth SKILL button)
      const magic = this.run.skills.filter((s) => !this.usedSkills.has(s)).map((s) => skillItem(s, this.opts.level, this.rng));
      this.choices = [...base, ...magic].slice(0, 4);
      this.phase = 'talkPick';
    } else if (cmd === 'pouch') {
      if (ITEM_KEYS.every((k) => this.run.items[k] <= 0)) {
        this.say([{ who: 'narrator', line: S.narr.pouchEmpty }], 'menu');
        return;
      }
      this.phase = 'pouch';
    } else if (cmd === 'poke') {
      this.ring = 1;
      this.phase = 'poke';
    } else if (cmd === 'friend') {
      if (!this.spareReady) {
        this.say([{ who: 'narrator', line: this.ready ? S.narr.talkFirst : S.narr.notReady(this.enc.creature.nameEn, this.enc.creature.nameKo) }], 'menu');
        return;
      }
      this.phase = 'befriend';
    }
  }

  /** X: back to the four choices. Leaving a TALK never takes the islander's turn and never moves the story (R2861). */
  back(): void {
    if (this.phase === 'talkPick' || this.phase === 'pouch' || this.phase === 'talk' || this.phase === 'skillPick') {
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

  /** SKILL: the magic words open as a TALK (pick the right words, or say them with 🎤). */
  pickSkill(id: AdventureSkillId): void {
    if (this.phase !== 'skillPick' || !this.skillList.includes(id)) return;
    this.current = skillItem(id, this.opts.level, this.rng);
    this.phase = 'talk';
  }

  /** The talk panel's result (one attempt). Retry keeps the panel open (no penalty), a pass moves on. */
  talkResult(g: Graded): 'retry' | 'next' {
    if (this.phase !== 'talk' || !this.current) return 'next';
    const t = this.current;
    if (!g.pass || g.stars === 0) return 'retry';
    // R2861: only a SAID line (voice, or typed when the microphone is off) is English work that opens the story.
    // Picking a reply, building a sentence or spelling still calms the islander but never counts as a pass.
    if (t.mode === 'say' && !t.skill) this.talkPasses += 1;
    this.current = null;
    if (t.skill) {
      this.cast(t.skill);
      return 'next';
    }
    const gain = calmGain(this.run, calmFor(g.stars));
    this.calm = Math.min(this.enc.calmMax, this.calm + gain);
    this.hooks.calm?.(gain);
    this.hooks.sfx?.('calm');
    if (g.stars >= 2) this.done.add(t.id);
    const react: Msg = { who: 'creature', line: this.enc.creature.react[g.stars as Stars] };
    const staged = this.checkStage();
    if (this.spareReady) {
      this.hooks.sfx?.('ready');
      this.say([react, ...staged, { who: 'narrator', line: this.enc.creature.ready }], 'menu');
    } else if (this.ready) {
      // calm is full but no English has been SAID yet (only picks / puzzles): it still covers its ears
      this.say([react, ...staged, { who: 'narrator', line: S.narr.talkFirst }], 'menu');
    } else this.say([react, ...staged], 'turn');
    return 'next';
  }

  private cast(s: AdventureSkillId) {
    this.usedSkills.add(s);
    this.run.skillsUsed += 1;
    this.hooks.sfx?.('skill');
    const sk = ADVENTURE_SKILLS[s];
    let line: AdventureLine;
    let extra: Msg[] = [];
    if (s === 'warmHeal') {
      const got = healRun(this.run, ADV.skill.heal);
      this.hooks.sfx?.('heal');
      line = S.narr.skillHeal(got);
    } else if (s === 'shieldSong') {
      this.shield = true;
      line = S.narr.skillShield;
    } else if (s === 'slowWind') {
      this.windSlow = true;
      line = S.narr.skillSlow;
    } else {
      const gain = Math.round(this.enc.calmMax * ADV.skill.sparkCalm);
      this.calm = Math.min(this.enc.calmMax, this.calm + gain);
      this.hooks.calm?.(gain);
      line = S.narr.skillSpark;
      extra = this.checkStage();
      if (this.ready) {
        this.hooks.sfx?.('ready');
        this.say([{ who: 'keeper', line: { en: sk.nameEn + '!', ko: sk.nameKo + '!' } }, { who: 'narrator', line }, ...extra, { who: 'narrator', line: this.enc.creature.ready }], 'menu');
        return;
      }
    }
    this.say([{ who: 'keeper', line: { en: sk.nameEn + '!', ko: sk.nameKo + '!' } }, { who: 'narrator', line }, ...extra], 'turn');
  }

  useItem(k: ItemKey): void {
    if (this.phase !== 'pouch' || this.run.items[k] <= 0) return;
    this.run.items[k] -= 1;
    const got = healRun(this.run, ITEM_INFO[k].heal);
    this.hooks.sfx?.('heal');
    this.say([{ who: 'narrator', line: S.narr.ate(ITEM_INFO[k].en, ITEM_INFO[k].ko, got) }], 'turn');
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
    if (this.grump <= 0) {
      // R2861: attack alone never ends a meeting. The islander covers its ears until the child has said English.
      if (this.talkPasses === 0) {
        this.grump = 1;
        this.hooks.sfx?.('wrong');
        this.say([{ who: 'narrator', line: S.narr.talkFirst }], 'turn');
        return;
      }
      this.say([{ who: 'creature', line: c.poked }, { who: 'narrator', line: c.leaves }], 'endFought');
    } else this.say([{ who: 'creature', line: c.poked }, ...this.checkStage()], 'turn');
  }

  /** FRIEND after calm is full. */
  befriend(): void {
    if (this.phase !== 'befriend') return;
    this.hooks.sfx?.('friend');
    this.say([{ who: 'creature', line: this.enc.creature.friend }], 'endSpared');
  }

  /** How far this meeting has gone (0..1): the more of calm filled or of grump lost. */
  get progressFrac(): number {
    return Math.max(this.calm / this.enc.calmMax, 1 - this.grump / this.enc.grumpMax);
  }

  /** A guardian steps up to every stage it has passed: its line, a sound, the engine's music hook. */
  private checkStage(): Msg[] {
    const st = this.enc.stages;
    const out: Msg[] = [];
    while (this.stage + 1 < st.length && this.progressFrac >= st[this.stage + 1]!.at) {
      this.stage += 1;
      out.push({ who: 'creature', line: st[this.stage]!.line });
      this.hooks.sfx?.('stage');
      this.hooks.stage?.(this.stage);
    }
    return out;
  }

  private startTurn() {
    const c = this.enc.creature;
    const st = this.enc.stages[this.stage];
    const pats = st?.patterns.length ? st.patterns : c.patterns;
    const id = pats[this.turn % pats.length]!;
    const [lo, hi] = ADV.turnSec[this.enc.cls];
    const duration = lo + this.rng() * (hi - lo);
    const speed = (st?.speed ?? 1) * this.slow * (this.windSlow ? ADV.skill.slowFactor : 1);
    this.pattern = startPattern(id, this.enc.words, this.rng, { duration, speed });
    this.turnLine = c.turns[this.turn % c.turns.length]!;
    const a = this.pattern.arena;
    this.soul = { x: a.x + a.w / 2, y: a.y + a.h * 0.62 };
    this.invuln = 0.4;
    this.turn += 1;
    this.windSlow = false;
    this.phase = 'dodge';
  }

  private finish(o: 'spared' | 'fought' | 'down') {
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
    const hitDmg = this.enc.stages[this.stage]?.damage;
    for (const e of ps.events) {
      if (e.type === 'hurt') this.hurt(hitDmg ?? e.dmg);
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
    if (this.run.hp <= 0) {
      this.downs += 1;
      this.pattern = null;
      this.turnLine = null;
      this.shield = false;
      this.hooks.sfx?.('down');
      this.say([{ who: 'narrator', line: S.narr.voiceOut }], 'endDown');
      return;
    }
    if (patternDone(ps)) {
      this.pattern = null;
      this.turnLine = null;
      this.shield = false;
      const staged = this.checkStage();
      if (staged.length) this.say(staged, 'menu');
      else this.phase = 'menu';
    }
  }

  private addCalm(n: number) {
    const before = this.ready;
    this.calm = Math.min(this.enc.calmMax, this.calm + n);
    this.hooks.calm?.(n);
    if (!before && this.ready) this.hooks.sfx?.('ready');
  }

  private hurt(raw: number, wrong = false) {
    const base = hitCost(this.run, raw);
    const dmg = this.shield ? Math.max(1, Math.round(base * ADV.skill.shieldFactor)) : base;
    hurtRun(this.run, dmg);
    this.invuln = ADV.soul.invulnMs / 1000;
    this.flash = ADV.hitFlashMs / 1000;
    this.hooks.hurt?.(dmg);
    this.hooks.sfx?.(wrong ? 'wrong' : 'hurt');
  }
}
