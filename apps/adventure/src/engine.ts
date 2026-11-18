import {
  ADVENTURE_CHAPTERS,
  adventureChapter,
  adventureLevelOf,
  adventureVoice,
  npcCast,
  type AdventureChapterId,
  type AdventureLevel,
  type AdventureLine,
  type NpcVoice
} from '@lcw/content';
import { EnglishDayFileSchema, type AdventureActivity, type AdventureLineMode, type EnglishDayFile } from '@lcw/schemas';
import { ADV } from './core/tuning.js';
import { buildChapterPlan, type ChapterPlan, type TalkItem } from './core/plan.js';
import { Battle, type Command, type ItemKey } from './core/battle.js';
import { gradeExact, gradePick, gradeSpelling, gradeSpoken, type Graded } from './core/grade.js';
import { buildIsland, feetBox, findPath, moveFeet, type IslandMap, type MapEntity } from './core/map.js';
import { createRng, hashSeed } from './core/rng.js';
import {
  CHAPTER_IDS,
  SETTINGS_KEY,
  STORAGE_KEY,
  earlierWords,
  isCleared,
  isUnlocked,
  kstDate,
  lockReason,
  mergeSettings,
  nextChapter,
  parseProgress,
  recordFinish,
  toSettings,
  type Progress
} from './core/progress.js';
import { addLine, betterPlay, buildEnvelope, envelopeDate, chapterStars, startRecord, toActivity, wordHit, type ChapterRecord } from './core/record.js';
import { dayFileUrls, readEdLink, resultUrl, type EdLink } from './core/edlink.js';
import { Sound, type SfxName } from './audio/sound.js';
import type { TrackId } from './audio/tracks.js';
import { Voice } from './audio/voice.js';
import { S } from './ui/strings.js';

/**
 * The adventure at run time: scenes, input, the fixed-step loop and every link out (document file, result envelope,
 * server settings). The canvas (render.ts) and the React panel (ui/) only read `snap` and call the methods here.
 */

export type Scene = 'title' | 'explore' | 'battle' | 'end' | 'parent';

export interface ExploreMsg {
  who: string;
  whoKo: string;
  lines: AdventureLine[];
  i: number;
  voice: NpcVoice | null;
  /** A word stone: the word to hear and say. */
  stone?: { w: string; ko: string | null; emoji: string; lit: boolean; index: number };
}

export interface EntityState {
  e: MapEntity;
  /** pixel position (feet centre) */
  x: number;
  y: number;
  state: 'idle' | 'friend' | 'gone';
  talked: number;
}

export interface Snapshot {
  v: number;
  scene: Scene;
  /** The document's day file and the server progress are in (start waits for them, docs/22 1.2). */
  booted: boolean;
  /** Opened from the student document (the next island waits for the next lesson day, not just tomorrow). */
  linked: boolean;
  help: boolean;
  sound: boolean;
  touch: boolean;
  chapter: AdventureChapterId;
  level: AdventureLevel;
  islands: Array<{ id: AdventureChapterId; en: string; ko: string; state: 'open' | 'cleared' | 'previous' | 'next-day'; stars: number }>;
  selected: AdventureChapterId;
  dayNote: 'document' | 'document-failed' | 'none';
  exploreMsg: ExploreMsg | null;
  reveal: number;
  battle: {
    phase: Battle['phase'];
    msg: { who: 'creature' | 'narrator' | 'keeper'; line: AdventureLine } | null;
    menuIndex: number;
    choices: TalkItem[];
    current: TalkItem | null;
    ready: boolean;
    items: Record<ItemKey, number>;
    creatureEn: string;
    creatureKo: string;
    turnLine: AdventureLine | null;
    befriendLine: AdventureLine | null;
  } | null;
  end: {
    activity: AdventureActivity;
    friends: string[];
    words: string[];
    nextNote: 'next-day' | 'done-all' | 'replay';
    back: string | null;
    sent: 'sending' | 'sent' | 'failed' | 'off';
  } | null;
  progress: Progress;
  hint: AdventureLine | null;
}

const HELP_KEY = 'lcw.adventure.help';
const SOUND_KEY = 'lcw.adventure.sound';

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
function session(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

const MENU: Command[] = ['poke', 'talk', 'pouch', 'friend'];

export class Engine {
  readonly sound = new Sound();
  readonly voice = new Voice(this.sound);
  readonly params = new URLSearchParams(location.search);
  readonly autopilot = this.params.get('autopilot') === '1';
  readonly unlockAll = this.params.get('unlock') === 'all';
  readonly ed: EdLink | null = readEdLink(location.search, session());
  scene: Scene = 'title';
  progress: Progress = parseProgress(store()?.getItem(STORAGE_KEY));
  help = store()?.getItem(HELP_KEY) !== '0';
  soundOn = store()?.getItem(SOUND_KEY) !== '0';
  touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** The sentence level: the document's level first, then ?level=, then the linked device's level (docs/22 2.3). */
  level: AdventureLevel = adventureLevelOf(this.params.get('level'));
  /** The student's own level as the document / device says it (L1-L6), reported in the envelope. */
  langLevel: string | null = /^L?[1-6]$/i.test(this.params.get('level') ?? '') ? `L${(this.params.get('level') ?? '').replace(/^L/i, '')}` : null;
  booted = false;
  day: EnglishDayFile | null = null;
  dayNote: Snapshot['dayNote'] = 'none';
  selected: AdventureChapterId = 1;
  chapter: AdventureChapterId = 1;
  plan: ChapterPlan | null = null;
  island: IslandMap | null = null;
  entities: EntityState[] = [];
  player = { x: 0, y: 0, dir: 0 as 0 | 1 | 2, flip: false, frame: 0 as 0 | 1, walkT: 0 };
  camX = 0;
  exploreMsg: ExploreMsg | null = null;
  reveal = 0;
  battle: Battle | null = null;
  battleEnc = 0;
  items: Record<ItemKey, number> = { honeyDrop: ADV.items.honeyDrop.startCount, berryBun: ADV.items.berryBun.startCount };
  menuIndex = 1;
  record: ChapterRecord | null = null;
  end: Snapshot['end'] = null;
  sessionActs = new Map<string, AdventureActivity>();
  /** Input */
  keys = new Set<string>();
  pad = { x: 0, y: 0 };
  /** Tap-to-walk: the tapped spot (drawn as a marker), the tile route to it, and the islander or thing tapped. */
  walkTo: { x: number; y: number } | null = null;
  walkPath: Array<{ x: number; y: number }> = [];
  walkTarget: EntityState | null = null;
  drag: { x: number; y: number } | null = null;
  fade = 0;
  t = 0;
  frames = 0;
  private listeners = new Set<() => void>();
  private snapV = 0;
  private snap: Snapshot;
  private lastTouch: string | null = null;
  private lastPhaseKey = '';
  /** The last envelope the document answered OK to (nothing new → no beacon on leaving). */
  private confirmed: string | null = null;
  /** The last body sent as a beacon (hiding the tab again with nothing new sends nothing). */
  private beaconed: string | null = null;

  constructor() {
    this.sound.setEnabled(this.soundOn);
    this.voice.enabled = this.soundOn;
    this.selected = nextChapter(this.progress, this.lessonDay(), { unlockAll: this.unlockAll });
    if (this.params.get('view') === 'parent') this.scene = 'parent';
    this.snap = this.build();
  }

  today(): string {
    return kstDate(Date.now());
  }

  /** The lesson day: the student document's day when opened from it (a new document day = a new lesson), else today. */
  lessonDay(): string {
    return this.ed ? (this.ed.date ?? this.day?.date ?? this.today()) : this.today();
  }

  // ---------- store for React ----------
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.snap;
  notify(): void {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  private islands(): Snapshot['islands'] {
    const today = this.lessonDay();
    return ADVENTURE_CHAPTERS.map((c) => {
      const lr = this.unlockAll ? 'open' : lockReason(this.progress, c.id, today);
      const state: Snapshot['islands'][number]['state'] = isCleared(this.progress, c.id) ? 'cleared' : lr;
      return { id: c.id, en: c.islandEn, ko: c.islandKo, state, stars: this.progress.chapters[c.id]?.stars ?? 0 };
    });
  }

  private build(): Snapshot {
    const b = this.battle;
    const enc = b?.enc;
    return {
      v: ++this.snapV,
      scene: this.scene,
      booted: this.booted,
      linked: Boolean(this.ed),
      help: this.help,
      sound: this.soundOn,
      touch: this.touch,
      chapter: this.chapter,
      level: this.level,
      islands: this.islands(),
      selected: this.selected,
      dayNote: this.dayNote,
      exploreMsg: this.exploreMsg ? { ...this.exploreMsg, stone: this.exploreMsg.stone ? { ...this.exploreMsg.stone } : undefined } : null,
      reveal: this.reveal,
      battle:
        b && enc
          ? {
              phase: b.phase,
              msg: b.phase === 'msg' ? (b.msgs[0] ?? null) : null,
              menuIndex: this.menuIndex,
              choices: [...b.choices],
              current: b.current,
              ready: b.ready,
              items: { ...b.items },
              creatureEn: enc.creature.nameEn,
              creatureKo: enc.creature.nameKo,
              turnLine: b.turnLine,
              befriendLine: this.plan ? this.plan.chapter.befriend[this.plan.level] : null
            }
          : null,
      end: this.end,
      progress: this.progress,
      hint: this.hint()
    };
  }

  private hint(): AdventureLine | null {
    if (this.scene !== 'explore' || this.exploreMsg) return null;
    const alive = this.entities.filter((e) => (e.e.kind === 'critter' || e.e.kind === 'guardian') && e.state === 'idle');
    if (!alive.length) return null;
    const unlit = this.entities.filter((e) => e.e.kind === 'stone' && e.talked === 0).length;
    return unlit ? S.walkStones : S.walkOn;
  }

  // ---------- boot ----------
  async boot(): Promise<void> {
    // both loads finish (or time out) before the islands can be started: the level and the open island depend on them
    const loads = Promise.all([this.loadDay(), this.loadServerProgress()]);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), ADV.bootWaitMs));
    const first = await Promise.race([loads, timeout]);
    if (first) this.applyBoot(first[0], first[1]);
    else {
      this.applyBoot(null, null);
      // a slow document or server still counts while the child is on the island map
      void loads.then(([doc, device]) => {
        if (this.scene === 'title' && !this.plan) this.applyBoot(doc, device);
      });
    }
  }

  private applyBoot(docLevel: string | number | null, deviceLevel: string | null) {
    const urlLevel = this.params.get('level');
    const chosen = docLevel ?? (urlLevel && /^L?[1-6]$/i.test(urlLevel) ? urlLevel : null) ?? deviceLevel;
    if (chosen != null) {
      this.level = adventureLevelOf(chosen);
      this.langLevel = typeof chosen === 'number' ? `L${chosen}` : `L${String(chosen).replace(/^L/i, '')}`;
    }
    this.booted = true;
    this.selected = nextChapter(this.progress, this.lessonDay(), { unlockAll: this.unlockAll });
    this.notify();
  }

  /** The document's day file; returns the level it names. */
  private async loadDay(): Promise<string | number | null> {
    if (!this.ed) return null;
    for (const url of dayFileUrls(this.ed)) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const parsed = EnglishDayFileSchema.safeParse(await r.json());
        if (!parsed.success) continue;
        this.day = parsed.data;
        this.dayNote = 'document';
        return parsed.data.level ?? null;
      } catch {
        // blocked or offline: try the next file
      }
    }
    this.dayNote = 'document-failed';
    return null;
  }

  private deviceToken(): string | null {
    try {
      return sessionStorage.getItem('lcw.studentToken') || localStorage.getItem('lcw.deviceToken');
    } catch {
      return null;
    }
  }

  /** A linked child's progress on the server (and the device's level, returned). */
  private async loadServerProgress(): Promise<string | null> {
    const tok = this.deviceToken();
    if (!tok) return null;
    const h = { authorization: `Bearer ${tok}` };
    const level = fetch('/v1/device/me', { headers: h })
      .then(async (me) => (me.ok ? (((await me.json()) as { level?: string }).level ?? null) : null))
      .catch(() => null);
    try {
      const r = await fetch('/v1/settings', { headers: h });
      if (r.ok) {
        const j = (await r.json()) as { settings?: Record<string, unknown> };
        this.progress = mergeSettings(this.progress, j.settings);
        this.saveLocal();
        // the server lost or lacks what this device has (another screen rewrote the row): put it back
        const mine = toSettings(this.progress)[SETTINGS_KEY];
        if (mine && j.settings?.[SETTINGS_KEY] !== mine) void this.saveServer();
      }
    } catch {
      // offline: the device copy is enough
    }
    return level;
  }

  private saveLocal() {
    try {
      store()?.setItem(STORAGE_KEY, JSON.stringify(this.progress));
    } catch {
      // storage blocked: this tab remembers
    }
  }

  private async saveServer(): Promise<boolean> {
    const tok = this.deviceToken();
    if (!tok) return false;
    const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
    try {
      // the PUT replaces the whole row: never write without having read it (a failed read would wipe the world's settings)
      const r = await fetch('/v1/settings', { headers: h });
      if (!r.ok) return false;
      const cur = ((await r.json()) as { settings?: Record<string, unknown> }).settings ?? {};
      const next = { ...cur, ...toSettings(this.progress) };
      if (Object.keys(next).length > ADV.settingsMaxKeys) return false;
      const put = await fetch('/v1/settings', { method: 'PUT', headers: h, body: JSON.stringify({ settings: next }) });
      return put.ok;
    } catch {
      // next finish or the next start tries again
      return false;
    }
  }

  // ---------- settings ----------
  toggleHelp() {
    this.help = !this.help;
    try {
      store()?.setItem(HELP_KEY, this.help ? '1' : '0');
    } catch {
      // per tab
    }
    this.notify();
  }
  toggleSound() {
    this.sound.unlock();
    this.soundOn = !this.soundOn;
    this.sound.setEnabled(this.soundOn);
    this.voice.enabled = this.soundOn;
    if (!this.soundOn) this.voice.stop();
    try {
      store()?.setItem(SOUND_KEY, this.soundOn ? '1' : '0');
    } catch {
      // per tab
    }
    this.notify();
  }

  sfx(n: SfxName) {
    this.sound.sfx(n);
  }

  music(id: TrackId | null) {
    this.sound.music(id);
  }

  // ---------- title ----------
  selectIsland(id: AdventureChapterId) {
    this.selected = id;
    this.sfx('move');
    this.notify();
  }

  canStart(id: AdventureChapterId): boolean {
    return isUnlocked(this.progress, id, this.lessonDay(), { unlockAll: this.unlockAll });
  }

  startChapter(id: AdventureChapterId = this.selected) {
    this.sound.unlock();
    if (!this.booted) return;
    if (!this.canStart(id)) {
      this.sfx('wrong');
      return;
    }
    this.chapter = id;
    const ch = adventureChapter(id);
    const saved = this.progress.chapters[id]?.words ?? [];
    // the day's words go to the chapter the document opened today (a new island), replays keep their own words
    const useDay = this.day && !isCleared(this.progress, id) ? this.day : null;
    this.plan = buildChapterPlan({ chapter: id, level: this.level, day: useDay, savedWords: useDay ? [] : saved, earlierWords: earlierWords(this.progress, id) });
    this.island = buildIsland(id);
    const T = ADV.tile;
    this.entities = this.island.entities.map((e) => ({ e, x: e.tx * T + T / 2, y: e.ty * T + T - 2, state: 'idle', talked: 0 }));
    this.player = { x: this.island.start.tx * T + T / 2, y: this.island.start.ty * T + T - 2, dir: 2, flip: false, frame: 0, walkT: 0 };
    this.items = { honeyDrop: ADV.items.honeyDrop.startCount, berryBun: ADV.items.berryBun.startCount };
    this.record = startRecord(id, this.plan.level, [...this.plan.words, ...this.plan.review].map((w) => w.w), Date.now(), this.langLevel);
    this.end = null;
    this.battle = null;
    this.scene = 'explore';
    this.fade = 1;
    this.exploreMsg = { who: S.title.en, whoKo: S.title.ko, lines: [{ en: ch.islandEn, ko: ch.islandKo }, ch.intro], i: 0, voice: null };
    this.reveal = 0;
    this.music(ch.music);
    this.voice.prefetch(this.plan.words.map((w) => ({ voice: npcCast().modelVoice, text: w.w })));
    this.notify();
  }

  toTitle() {
    this.voice.stop();
    this.scene = 'title';
    this.battle = null;
    this.exploreMsg = null;
    this.selected = nextChapter(this.progress, this.lessonDay(), { unlockAll: this.unlockAll });
    this.music('title');
    this.fade = 1;
    this.notify();
  }

  openParent() {
    this.voice.stop();
    this.scene = 'parent';
    this.music(null);
    this.notify();
  }

  // ---------- input ----------
  confirm() {
    this.sound.unlock();
    if (this.scene === 'title') return this.startChapter();
    if (this.scene === 'explore') {
      if (this.exploreMsg) return this.advanceExplore();
      return this.interactFacing();
    }
    if (this.scene === 'battle' && this.battle) {
      const b = this.battle;
      if (b.phase === 'msg') {
        const text = b.msgs[0]?.line.en ?? '';
        if (this.reveal < text.length) {
          this.reveal = text.length;
          this.notify();
          return;
        }
        b.advance();
        this.afterBattleChange();
        return;
      }
      if (b.phase === 'menu') return this.command(MENU[this.menuIndex]!);
      if (b.phase === 'poke') {
        b.strike();
        this.afterBattleChange();
        return;
      }
      if (b.phase === 'befriend') return this.befriend(false);
      if (b.phase === 'end') return this.leaveBattle();
    }
  }

  cancel() {
    if (this.scene === 'battle' && this.battle) {
      this.battle.back();
      this.afterBattleChange();
    } else if (this.scene === 'explore' && this.exploreMsg) this.advanceExplore(true);
  }

  menuMove(d: number) {
    if (this.scene === 'title') {
      const i = CHAPTER_IDS.indexOf(this.selected);
      this.selectIsland(CHAPTER_IDS[(i + d + 4) % 4]!);
      return;
    }
    if (this.battle?.phase === 'menu') {
      this.menuIndex = (this.menuIndex + d + 4) % 4;
      this.sfx('move');
      this.notify();
    }
  }

  command(c: Command) {
    const b = this.battle;
    if (!b || b.phase !== 'menu') return;
    this.menuIndex = MENU.indexOf(c);
    b.choose(c);
    this.afterBattleChange();
  }

  pickTalk(id: string) {
    this.battle?.pickTalk(id);
    const t = this.battle?.current;
    if (t && t.mode !== 'spell') {
      // a learner hears the model sentence first at L1; above, on the 🔊
      if (this.plan?.level === 1 && t.mode === 'say') void this.voice.speak(npcCast().modelVoice, t.target);
      if (t.mode === 'pick' && t.prompt && this.battle) void this.voice.speak(adventureVoice(this.battle.enc.creature.voice), t.prompt.en);
    } else if (t?.mode === 'spell') void this.voice.speak(npcCast().modelVoice, t.target, 0.8);
    this.afterBattleChange();
  }

  /** The TALK panel's answer. `transcripts` for say (voice or typed), `answer` for build/spell/pick. */
  talkAttempt(a: { mode: AdventureLineMode; transcripts?: string[]; answer?: string; tries: number }): Graded {
    const b = this.battle;
    const t = b?.current;
    if (!b || !t || !this.record) return { stars: 0, score: 0, pass: false, missed: [] };
    let g: Graded;
    const level = this.plan?.level ?? this.level;
    if (t.mode === 'say') g = gradeSpoken(t.target, a.transcripts ?? [], level);
    else if (t.mode === 'pick') g = gradePick(t.target, a.answer ?? '', a.tries);
    else if (t.mode === 'spell') g = gradeSpelling(t.target, a.answer ?? '', a.tries);
    else g = gradeExact(t.target, a.answer ?? '', a.tries);
    const ko = t.ko ?? '';
    addLine(this.record, { en: t.target, ko, mode: a.mode, ok: g.pass && g.stars > 0, stars: g.stars });
    if (t.word && t.mode === 'spell') wordHit(this.record, t.word, g.pass ? 'caught' : 'missed');
    if (!g.pass || g.stars === 0) this.sfx('wrong');
    return g;
  }

  /** After the panel showed the stars: hand the result to the encounter. */
  talkDone(g: Graded) {
    this.battle?.talkResult(g);
    this.afterBattleChange();
  }

  talkSkip() {
    this.battle?.talkSkip();
    this.afterBattleChange();
  }

  useItem(k: ItemKey) {
    this.battle?.useItem(k);
    this.afterBattleChange();
  }

  befriend(said: boolean, transcript?: string[], mode: 'voice' | 'typed' = 'voice') {
    const b = this.battle;
    if (!b || b.phase !== 'befriend' || !this.plan || !this.record) return;
    const line = this.plan.chapter.befriend[this.plan.level];
    if (said && transcript) {
      const g = gradeSpoken(line.en, transcript, this.plan.level);
      addLine(this.record, { en: line.en, ko: line.ko, mode, ok: g.pass, stars: g.stars });
    }
    b.befriend();
    this.afterBattleChange();
  }

  speakModel(text: string, rate?: number) {
    this.sound.unlock();
    void this.voice.speak(npcCast().modelVoice, text, rate);
  }

  setPad(x: number, y: number) {
    this.pad = { x, y };
  }

  /** Canvas tap / drag in logical coordinates. */
  pointer(kind: 'down' | 'move' | 'up', x: number, y: number) {
    this.sound.unlock();
    if (this.scene === 'explore' && !this.exploreMsg) {
      if (kind === 'up') return;
      this.walkToward(x + this.camX, y);
    } else if (this.scene === 'battle' && this.battle?.phase === 'dodge') {
      if (kind === 'down') this.drag = { x, y };
      else if (kind === 'move' && this.drag) {
        const s = this.battle.soul;
        s.x += x - this.drag.x;
        s.y += y - this.drag.y;
        this.drag = { x, y };
      } else if (kind === 'up') this.drag = null;
    } else if (kind === 'down' && this.scene === 'battle' && this.battle?.phase === 'poke') {
      this.battle.strike();
      this.afterBattleChange();
    }
  }

  // ---------- explore ----------
  private advanceExplore(skip = false) {
    const m = this.exploreMsg;
    if (!m) return;
    const text = m.lines[m.i]?.en ?? '';
    if (!skip && this.reveal < text.length) {
      this.reveal = text.length;
      this.notify();
      return;
    }
    m.i += 1;
    this.reveal = 0;
    if (skip || m.i >= m.lines.length) this.exploreMsg = null;
    else if (m.voice) void this.voice.speak(m.voice, m.lines[m.i]!.en);
    this.notify();
  }

  private interactFacing() {
    const p = this.player;
    const T = ADV.tile;
    const dx = p.dir === 2 ? (p.flip ? -1 : 1) : 0;
    const dy = p.dir === 0 ? 1 : p.dir === 1 ? -1 : 0;
    const fx = p.x + dx * T * 0.8;
    const fy = p.y - 4 + dy * T * 0.8;
    const hit = this.entities.find((e) => e.state !== 'gone' && Math.abs(e.x - fx) < T * 0.9 && Math.abs(e.y - 6 - fy) < T * 0.9);
    if (hit) this.touchEntity(hit, true);
  }

  private stoneLines(i: number) {
    const w = this.plan?.words[i % (this.plan?.words.length || 1)];
    return w;
  }

  private touchEntity(es: EntityState, force = false) {
    const e = es.e;
    if (!this.plan) return;
    const ch = this.plan.chapter;
    if (e.kind === 'critter' || e.kind === 'guardian') {
      if (es.state !== 'idle') {
        if (force && es.state === 'friend') {
          const c = e.kind === 'guardian' ? ch.guardian : ch.critters[e.index as 0 | 1];
          this.exploreMsg = { who: c.nameEn, whoKo: c.nameKo, lines: [c.friend], i: 0, voice: adventureVoice(c.voice) };
          this.reveal = 0;
          this.notify();
        }
        return;
      }
      this.startBattle(e.kind === 'guardian' ? 2 : e.index);
      return;
    }
    if (!force && this.lastTouch === e.id) return;
    this.lastTouch = e.id;
    if (e.kind === 'villager') {
      const v = ch.villager;
      this.exploreMsg = { who: v.nameEn, whoKo: v.nameKo, lines: v.lines, i: 0, voice: adventureVoice('guide') };
      void this.voice.speak(adventureVoice('guide'), v.lines[0]!.en);
    } else if (e.kind === 'stone') {
      const w = this.stoneLines(e.index);
      if (!w) return;
      this.exploreMsg = {
        who: S.wordStone.en,
        whoKo: S.wordStone.ko,
        lines: [{ en: w.sentence, ko: w.ko ? `${w.w} = ${w.ko}` : '' }],
        i: 0,
        voice: null,
        stone: { w: w.w, ko: w.ko, emoji: w.emoji, lit: es.talked > 0, index: e.index }
      };
      this.sfx('stone');
      void this.voice.speak(npcCast().modelVoice, w.w, 0.85);
    } else if (e.kind === 'bell') {
      const first = es.talked === 0;
      if (first) this.items.honeyDrop += 1;
      this.sfx('bell');
      this.exploreMsg = {
        who: S.bell.en,
        whoKo: S.bell.ko,
        lines: [
          first ? S.bellFirst : S.bellAgain
        ],
        i: 0,
        voice: null
      };
      es.talked += 1;
    }
    this.reveal = 0;
    this.notify();
  }

  /** A word stone: the child said the word (or its sentence). */
  stoneSaid(transcripts: string[], mode: AdventureLineMode) {
    const m = this.exploreMsg;
    if (!m?.stone || !this.record) return false;
    const w = this.plan?.words[m.stone.index];
    if (!w) return false;
    const g = gradeSpoken(w.sentence, transcripts, this.plan!.level);
    const gw = gradeSpoken(w.w, transcripts, this.plan!.level);
    const best = g.stars >= gw.stars ? { g, en: w.sentence } : { g: gw, en: w.w };
    // a word stone is practice on the way: it is recorded, but the three-star count is the islanders' talks
    addLine(this.record, { en: best.en, ko: w.ko ? `${w.w} = ${w.ko}` : '', mode, ok: best.g.pass, stars: best.g.stars, stone: true });
    if (best.g.pass) {
      const es = this.entities.find((x) => x.e.kind === 'stone' && x.e.index === m.stone!.index);
      if (es) es.talked += 1;
      m.stone.lit = true;
      this.sfx('wordDone');
    } else this.sfx('wrong');
    this.notify();
    return best.g.pass;
  }

  stoneLook(index: number) {
    const es = this.entities.find((x) => x.e.kind === 'stone' && x.e.index === index);
    if (es && es.talked === 0) es.talked = 1;
  }

  private stopWalk() {
    this.walkTo = null;
    this.walkPath = [];
    this.walkTarget = null;
  }

  /** A tap on the island: walk round what is in the way; a tapped islander, stone or bell is talked to on arrival. */
  private walkToward(wx: number, wy: number) {
    const isl = this.island;
    if (!isl) return;
    const T = ADV.tile;
    const p = this.player;
    const hit = this.entities.find((e) => e.state !== 'gone' && overlaps({ x: wx, y: wy, w: 1, h: 1 }, grow(entityBox(e), 6))) ?? null;
    // stones, the villager and the bell are walked round; an islander in a gate is walked into (that is the meeting)
    const solidAt = (tx: number, ty: number) =>
      this.entities.some((e) => e.state === 'idle' && e.e.kind !== 'critter' && e.e.kind !== 'guardian' && overlaps({ x: tx * T + 1, y: ty * T + 1, w: T - 2, h: T - 2 }, entityBox(e)));
    const from = { tx: Math.floor(p.x / T), ty: Math.floor((p.y - 1) / T) };
    const to = hit ? { tx: Math.floor(hit.x / T), ty: Math.floor((hit.y - 4) / T) } : { tx: Math.floor(wx / T), ty: Math.floor(wy / T) };
    const steps = findPath(isl, from, to, (tx, ty) => !(tx === from.tx && ty === from.ty) && solidAt(tx, ty));
    this.walkPath = steps.map((st) => ({ x: st.tx * T + T / 2, y: st.ty * T + T - 2 }));
    this.walkTarget = hit;
    this.walkTo = { x: wx, y: wy };
  }

  /** End of a tap-walk: face what was tapped and talk to it. */
  private arrive() {
    const t = this.walkTarget;
    this.stopWalk();
    if (!t || t.state === 'gone') return;
    const p = this.player;
    const dx = t.x - p.x;
    const dy = t.y - 4 - (p.y - 4);
    if (Math.abs(dx) > Math.abs(dy)) {
      p.dir = 2;
      p.flip = dx < 0;
    } else p.dir = dy < 0 ? 1 : 0;
    this.touchEntity(t, true);
  }

  private stepExplore(dt: number) {
    const isl = this.island;
    if (!isl) return;
    const p = this.player;
    let dx = 0;
    let dy = 0;
    if (!this.exploreMsg) {
      if (this.keys.has('left')) dx -= 1;
      if (this.keys.has('right')) dx += 1;
      if (this.keys.has('up')) dy -= 1;
      if (this.keys.has('down')) dy += 1;
      dx += this.pad.x;
      dy += this.pad.y;
      if (!dx && !dy && this.walkTo) {
        let wp = this.walkPath[0];
        while (wp && Math.hypot(wp.x - p.x, wp.y - p.y) < 1) {
          this.walkPath.shift();
          wp = this.walkPath[0];
        }
        if (wp) {
          dx = wp.x - p.x;
          dy = wp.y - p.y;
        } else this.arrive();
      } else if (dx || dy) this.stopWalk();
    } else this.stopWalk();
    const m = Math.hypot(dx, dy);
    if (m > 0) {
      const k = (ADV.player.speed * dt) / Math.max(1, m);
      const nx = dx * Math.min(k, ADV.player.speed * dt);
      const ny = dy * Math.min(k, ADV.player.speed * dt);
      const before = { x: p.x, y: p.y };
      let next = moveFeet(isl, p.x, p.y, nx, ny);
      // islanders and things are solid too (until they are friends)
      const solid = this.entities.find((e) => e.state === 'idle' && overlaps(feetBox(next.x, next.y), entityBox(e)));
      if (solid) {
        next = before;
        this.stopWalk();
        this.touchEntity(solid, solid === this.walkTarget);
      } else this.lastTouch = this.entities.some((e) => overlaps(feetBox(next.x, next.y), grow(entityBox(e), 4))) ? this.lastTouch : null;
      if (this.walkTo && next.x === before.x && next.y === before.y) this.stopWalk();
      p.x = next.x;
      p.y = next.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        p.dir = 2;
        p.flip = dx < 0;
      } else p.dir = dy < 0 ? 1 : 0;
      p.walkT += dt;
      p.frame = Math.floor(p.walkT * 6) % 2 ? 1 : 0;
    } else p.frame = 0;
    // the guardian's clearing: walking up to it (from any row) starts the meeting
    const g = this.entities.find((e) => e.e.kind === 'guardian' && e.state === 'idle');
    if (g && !this.exploreMsg && p.x > g.x - 26) {
      p.x = g.x - 27;
      this.touchEntity(g);
    }
    const viewW = ADV.screen.w;
    this.camX = Math.max(0, Math.min(isl.w * ADV.tile - viewW, p.x - viewW / 2));
  }

  // ---------- battle ----------
  startBattle(i: number) {
    if (!this.plan) return;
    const enc = this.plan.encounters[i]!;
    this.voice.stop();
    this.battleEnc = i;
    this.battle = new Battle(enc, createRng(hashSeed(this.plan.seed, i, this.t)), this.items, {
      sfx: (n) => this.sfx(n),
      word: (w, kind) => this.record && wordHit(this.record, w, kind),
      hurt: (d) => {
        if (this.record) this.record.hpLost += d;
      }
    });
    this.menuIndex = 1;
    this.scene = 'battle';
    this.fade = 1;
    this.reveal = 0;
    this.sfx('encounter');
    this.music(enc.cls === 'critter' ? 'battle' : 'guardian');
    const v = adventureVoice(enc.creature.voice);
    this.voice.prefetch([
      ...enc.creature.turns.map((l) => ({ voice: v, text: l.en })),
      ...enc.creature.react.map((l) => ({ voice: v, text: l.en })),
      { voice: v, text: enc.creature.friend.en }
    ]);
    this.lastPhaseKey = '';
    this.afterBattleChange();
  }

  private afterBattleChange() {
    const b = this.battle;
    if (!b) return;
    const key = `${b.phase}|${b.msgs.length}|${b.msgs[0]?.line.en ?? ''}|${b.current?.id ?? ''}`;
    if (key !== this.lastPhaseKey) {
      this.lastPhaseKey = key;
      this.reveal = 0;
      const m = b.phase === 'msg' ? b.msgs[0] : null;
      if (m?.who === 'creature') void this.voice.speak(adventureVoice(b.enc.creature.voice), m.line.en);
      if (b.phase === 'dodge' && b.turnLine) void this.voice.speak(adventureVoice(b.enc.creature.voice), b.turnLine.en);
    }
    this.notify();
  }

  private leaveBattle() {
    const b = this.battle;
    if (!b || !this.plan || !this.record) return;
    const enc = b.enc;
    const es = this.entities.find((e) => (this.battleEnc === 2 ? e.e.kind === 'guardian' : e.e.kind === 'critter' && e.e.index === this.battleEnc));
    if (b.outcome === 'spared') {
      this.record.befriended.push(enc.creature.id);
      if (es) {
        es.state = 'friend';
        es.y -= ADV.tile; // steps off the path
      }
    } else {
      this.record.fought.push(enc.creature.id);
      if (es) es.state = 'gone';
    }
    this.battle = null;
    if (this.battleEnc === 2) {
      this.record.outcome = b.outcome === 'spared' ? 'spared' : 'fought';
      this.finishChapter();
      return;
    }
    this.scene = 'explore';
    this.fade = 1;
    this.music(this.plan.chapter.music);
    this.notify();
  }

  private finishChapter() {
    if (!this.record || !this.plan) return;
    const r = this.record;
    r.endedMs = Date.now();
    const act = toActivity(r, r.endedMs);
    const today = this.lessonDay();
    const wasCleared = isCleared(this.progress, this.chapter);
    this.progress = recordFinish(this.progress, this.chapter, today, { stars: chapterStars(r), outcome: r.outcome, words: this.plan.words.map((w) => w.w), activity: act });
    this.saveLocal();
    void this.saveServer();
    const had = this.sessionActs.get(act.id);
    if (!had || betterPlay(act, had)) this.sessionActs.set(act.id, act);
    const friends = r.befriended.map((id) => {
      const c = [...this.plan!.chapter.critters, this.plan!.chapter.guardian].find((x) => x.id === id);
      return c?.nameEn ?? id;
    });
    const nextNote: NonNullable<Snapshot['end']>['nextNote'] = this.chapter === 4 ? 'done-all' : wasCleared ? 'replay' : 'next-day';
    this.end = { activity: act, friends, words: this.plan.words.map((w) => w.w), nextNote, back: this.ed?.back ?? null, sent: this.ed ? 'sending' : 'off' };
    const end = this.end;
    void this.postResults().then((sent) => {
      if (this.end === end) {
        this.end = { ...end, sent };
        this.notify();
      }
    });
    this.scene = 'end';
    this.record = null;
    this.fade = 1;
    this.sfx('clear');
    this.music('friend');
    this.notify();
  }

  /** The envelope of what this tab played (contract v1); `includeOpen` adds an island left half way. */
  private envelope(includeOpen: boolean): string | null {
    if (!this.ed) return null;
    const acts = [...this.sessionActs.values()];
    if (includeOpen && this.record && this.record.lines.length) {
      const open = toActivity(this.record, Date.now());
      const prev = this.progress.chapters[this.chapter]?.last;
      // never overwrite a finished play of today with a half one
      if (!this.sessionActs.has(open.id) && !(prev && prev.extra.outcome !== 'quit' && prev.endedAt.slice(0, 10) === this.today())) acts.push(open);
    }
    const env = buildEnvelope(this.ed.student, envelopeDate(this.ed.date ?? this.day?.date, this.today()), acts);
    return env ? JSON.stringify(env) : null;
  }

  /**
   * At a chapter's end: POST and wait for the answer, retrying twice (the document's endpoint may be missing or busy).
   * Whatever is not confirmed goes again with the next chapter's end or when the page is left (same ids overwrite).
   */
  async postResults(): Promise<'sent' | 'failed' | 'off'> {
    const url = this.ed ? resultUrl(this.ed) : null;
    const body = this.envelope(false);
    if (!url || !body) return 'off';
    for (const wait of ADV.resultRetryMs) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const r = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8' }, keepalive: true });
        if (r.ok) {
          this.confirmed = body;
          return 'sent';
        }
      } catch {
        // offline or blocked: try again
      }
    }
    return 'failed';
  }

  /** Leaving the page: one beacon with everything not confirmed yet, the island in progress included. */
  sendResults(includeOpen = false): 'sent' | 'failed' | 'off' {
    const url = this.ed ? resultUrl(this.ed) : null;
    const body = this.envelope(includeOpen);
    if (!url || !body) return 'off';
    if (body === this.confirmed || body === this.beaconed) return 'sent';
    try {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (ok) this.beaconed = body;
      return ok ? 'sent' : 'failed';
    } catch {
      return 'failed';
    }
  }

  // ---------- loop ----------
  step(dt: number) {
    this.t += dt;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3);
    const textNow = this.scene === 'explore' ? this.exploreMsg?.lines[this.exploreMsg.i]?.en : this.battle?.phase === 'msg' ? this.battle.msgs[0]?.line.en : null;
    if (textNow && this.reveal < textNow.length) {
      const before = Math.floor(this.reveal);
      this.reveal = Math.min(textNow.length, this.reveal + dt * ADV.textCps);
      const now = Math.floor(this.reveal);
      if (now !== before) {
        if (now % 2 === 0 && /\w/.test(textNow[now - 1] ?? '')) this.sound.blip(this.battle ? 520 : 640);
        if (now % 3 === 0 || now === textNow.length) this.notify();
      }
    }
    if (this.scene === 'explore') this.stepExplore(dt);
    if (this.scene === 'battle' && this.battle) {
      const b = this.battle;
      const before = b.phase;
      let dx = 0;
      let dy = 0;
      if (this.keys.has('left')) dx -= 1;
      if (this.keys.has('right')) dx += 1;
      if (this.keys.has('up')) dy -= 1;
      if (this.keys.has('down')) dy += 1;
      dx += this.pad.x;
      dy += this.pad.y;
      b.step(dt, { x: dx, y: dy }, this.autopilot && !dx && !dy && !this.drag);
      if (b.phase !== before) this.afterBattleChange();
    }
  }
}

function entityBox(e: EntityState) {
  // critters fill their gate (three tiles high); others are a block at their feet
  const B = ADV.entityBox;
  if (e.e.kind === 'critter') return { x: e.x - B.critter.w / 2, y: e.y - B.critter.h + B.critter.below, w: B.critter.w, h: B.critter.h };
  const { w, h } = e.e.kind === 'guardian' ? B.guardian : B.small;
  return { x: e.x - w / 2, y: e.y - h, w, h };
}

function grow(b: { x: number; y: number; w: number; h: number }, n: number) {
  return { x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
