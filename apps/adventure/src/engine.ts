import {
  ADVENTURE_CHAPTERS,
  ADVENTURE_CREDITS,
  ADVENTURE_ENDING,
  ADVENTURE_FERRY,
  ADVENTURE_ITEMS,
  ADVENTURE_MERCHANT,
  ADVENTURE_PROLOGUE,
  ADVENTURE_SAIL,
  ADVENTURE_SKILLS,
  ADVENTURE_STORY,
  adventureChapter,
  adventureGoodsInfo,
  adventureGoodsName,
  adventureLevelOf,
  islanderVoice,
  npcCast,
  type AdventureChapterId,
  type AdventureLevel,
  type AdventureLine,
  type AdventureNpc,
  type AdventureSkillId,
  type NpcVoice
} from '@lcw/content';
import { EnglishDayFileSchema, type AdventureActivity, type AdventureLineMode, type EnglishDayFile } from '@lcw/schemas';
import { ADV } from './core/tuning.js';
import { buildChapterPlan, type ChapterPlan, type TalkItem } from './core/plan.js';
import { Battle, ITEM_KEYS, MENU, type Command, type ItemKey } from './core/battle.js';
import { gradeExact, gradePick, gradeSpelling, gradeSpoken, type Graded } from './core/grade.js';
import { blocks, buildIsland, feetBox, findPath, moveFeet, tileAt, type IslandMap, type MapEntity } from './core/map.js';
import { addCoins, buy, canBuy, hasFlag, learn, maxHp, newRun, openChest, parseRun, restAt, retrySpeed, revive, RUN_KEY, setFlag, type BuyCheck, type Run } from './core/run.js';
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
import { addLine, betterPlay, buildEnvelope, datedPlays, chapterStars, startRecord, toActivity, wordHit, wordsSaid, type ChapterRecord } from './core/record.js';
import { dayFileUrls, readEdLink, resultUrl, type EdLink } from './core/edlink.js';
import { Sound, type SfxName } from './audio/sound.js';
import { BOSS_LAST_TRACK, BOSS_TRACK, type TrackId } from './audio/tracks.js';
import { Voice } from './audio/voice.js';
import { S } from './ui/strings.js';

/**
 * The adventure at run time: scenes, input, the fixed-step loop and every link out (document file, result envelope,
 * server settings). The canvas (render.ts) and the React panel (ui/) only read `snap` and call the methods here.
 */

export type Scene = 'title' | 'story' | 'explore' | 'battle' | 'down' | 'end' | 'parent';

/** What happens when a talk on the island ends (R2734: talks lead on — to a node, the shop, the guardian, the island's end). */
export type MsgAfter = { kind: 'node'; to: string } | { kind: 'guardian' } | { kind: 'finish' };

/** A full-screen story page: the opening, the boat between islands, the ending and the last words. */
export interface StoryMsg {
  kind: 'prologue' | 'sail' | 'ending' | 'credits';
  who: string;
  whoKo: string;
  lines: readonly AdventureLine[];
  i: number;
}

export interface ShopRow {
  id: string;
  kind: 'item' | 'gear' | 'skill';
  en: string;
  ko: string;
  info: AdventureLine;
  cost: number;
  check: BuyCheck;
}

export interface ExploreMsg {
  who: string;
  whoKo: string;
  lines: AdventureLine[];
  i: number;
  voice: NpcVoice | null;
  /** A word stone: the word to hear and say. */
  stone?: { w: string; ko: string | null; emoji: string; lit: boolean; index: number };
  /** Replies shown with the last line (an islander's talk with choices). */
  choices?: AdventureLine[];
  /** Whose talk tree and where in it. */
  npc?: { tree: AdventureNpc; node: string };
  after?: MsgAfter;
}

export interface EntityState {
  e: MapEntity;
  /** pixel position (feet centre) */
  x: number;
  y: number;
  state: 'idle' | 'friend' | 'gone' | 'open';
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
  islands: Array<{ id: AdventureChapterId; en: string; ko: string; state: 'open' | 'cleared' | 'previous'; stars: number }>;
  /** One list cursor for whatever list is on screen (keyboard: arrows move it, Z picks it). */
  cursor: number;
  run: { hp: number; hpMax: number; coins: number; items: Record<ItemKey, number>; gear: string[]; skills: AdventureSkillId[] };
  story: StoryMsg | null;
  shop: { rows: ShopRow[]; note: AdventureLine | null } | null;
  down: { where: 'post' | 'start'; boss: boolean } | null;
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
    /** Pouch rows with something in them. */
    pouch: ItemKey[];
    skills: Array<{ id: AdventureSkillId; en: string; ko: string; info: AdventureLine }>;
    talk: { tries: number; result: Graded | null };
    stage: number;
    stageCount: number;
    creatureEn: string;
    creatureKo: string;
    turnLine: AdventureLine | null;
    befriendLine: AdventureLine | null;
  } | null;
  end: {
    activity: AdventureActivity;
    friends: string[];
    words: string[];
    nextNote: 'sail' | 'done-all';
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
  /** The whole trip (R2734): voice, coins, pouch, gear, magic words, chests, the last lantern post. */
  run: Run = parseRun(store()?.getItem(RUN_KEY));
  story: StoryMsg | null = null;
  private storyThen: (() => void) | null = null;
  shop: { note: AdventureLine | null } | null = null;
  down: Snapshot['down'] = null;
  /** The one list cursor (title isles use `selected`, the battle menu `menuIndex`). */
  cursor = 0;
  /** The TALK being answered: tries so far and the last result (the panel and Z both read it). */
  talk: { tries: number; result: Graded | null } = { tries: 0, result: null };
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
      cursor: this.cursor,
      run: { hp: this.run.hp, hpMax: maxHp(this.run), coins: this.run.coins, items: { ...this.run.items }, gear: [...this.run.gear], skills: [...this.run.skills] },
      story: this.story ? { ...this.story } : null,
      shop: this.shop ? { rows: this.shopRows(), note: this.shop.note } : null,
      down: this.down,
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
              pouch: this.pouchRows(),
              skills: b.skillList.map((id) => ({ id, en: ADVENTURE_SKILLS[id].nameEn, ko: ADVENTURE_SKILLS[id].nameKo, info: ADVENTURE_SKILLS[id].info })),
              talk: { ...this.talk },
              stage: b.stage,
              stageCount: b.stageCount,
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
    if (this.scene !== 'explore' || this.exploreMsg || this.shop) return null;
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
        if (!this.plan) this.applyBoot(doc, device);
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

  /** Start on the map: the opening story the first time, then the island. */
  begin(id: AdventureChapterId = this.selected) {
    this.sound.unlock();
    if (!this.booted) return;
    if (!this.canStart(id)) {
      this.sfx('wrong');
      return;
    }
    if (id === 1 && !this.run.prologue) {
      this.run.prologue = true;
      this.saveRun();
      this.showStory({ kind: 'prologue', who: S.title.en, whoKo: S.title.ko, lines: ADVENTURE_PROLOGUE, i: 0 }, 'story', () => this.startChapter(1));
      return;
    }
    this.startChapter(id);
  }

  startChapter(id: AdventureChapterId = this.selected) {
    this.sound.unlock();
    if (!this.booted) return;
    if (!this.canStart(id)) {
      this.sfx('wrong');
      return;
    }
    this.chapter = id;
    this.selected = id;
    const ch = adventureChapter(id);
    const saved = this.progress.chapters[id]?.words ?? [];
    // the day's words go to the chapter the document opened today (a new island), replays keep their own words
    const useDay = this.day && !isCleared(this.progress, id) ? this.day : null;
    this.plan = buildChapterPlan({ chapter: id, level: this.level, day: useDay, savedWords: useDay ? [] : saved, earlierWords: earlierWords(this.progress, id) });
    this.island = buildIsland(id);
    const T = ADV.tile;
    this.entities = this.island.entities.map((e) => ({
      e,
      x: e.tx * T + T / 2,
      y: e.ty * T + T - 2,
      state: e.kind === 'chest' && hasFlag(this.run, `chest-${id}-${e.index}`) ? 'open' : 'idle',
      talked: 0
    }));
    this.placeAt(this.island.start.tx, this.island.start.ty);
    // a new island starts rested (the boat ride); the last post is this island's beach until a post is touched
    this.run.hp = maxHp(this.run);
    this.run.post = null;
    this.saveRun();
    this.record = startRecord(id, this.plan.level, [...this.plan.words, ...this.plan.review].map((w) => w.w), Date.now(), this.langLevel);
    this.end = null;
    this.battle = null;
    this.story = null;
    this.shop = null;
    this.down = null;
    this.scene = 'explore';
    this.fade = 1;
    this.exploreMsg = { who: S.title.en, whoKo: S.title.ko, lines: [{ en: ch.islandEn, ko: ch.islandKo }, ch.intro], i: 0, voice: null };
    this.reveal = 0;
    this.music(ch.music);
    this.voice.prefetch(this.plan.words.map((w) => ({ voice: npcCast().modelVoice, text: w.w })));
    this.notify();
  }

  private placeAt(tx: number, ty: number) {
    const T = ADV.tile;
    this.player = { x: tx * T + T / 2, y: ty * T + T - 2, dir: 2, flip: false, frame: 0, walkT: 0 };
    this.stopWalk();
    const isl = this.island;
    if (isl) this.camX = Math.max(0, Math.min(isl.w * T - ADV.screen.w, this.player.x - ADV.screen.w / 2));
  }

  toTitle() {
    this.voice.stop();
    this.scene = 'title';
    this.battle = null;
    this.exploreMsg = null;
    this.story = null;
    this.shop = null;
    this.down = null;
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

  // ---------- story pages ----------
  private showStory(st: StoryMsg, track: TrackId, then: () => void) {
    this.voice.stop();
    this.story = st;
    this.storyThen = then;
    this.scene = 'story';
    this.battle = null;
    this.exploreMsg = null;
    this.shop = null;
    this.reveal = 0;
    this.fade = 1;
    this.music(track);
    this.speakStory();
    this.notify();
  }

  private speakStory() {
    const st = this.story;
    const line = st?.lines[st.i];
    if (!st || !line) return;
    if (st.kind === 'sail') void this.voice.speak(islanderVoice('oarly', 'errand_neighbor'), line.en);
    else void this.voice.speak(npcCast().modelVoice, line.en);
  }

  private advanceStory() {
    const st = this.story;
    if (!st) return;
    const text = st.lines[st.i]?.en ?? '';
    if (this.reveal < text.length) {
      this.reveal = text.length;
      this.notify();
      return;
    }
    st.i += 1;
    this.reveal = 0;
    if (st.i >= st.lines.length) {
      const then = this.storyThen;
      this.story = null;
      this.storyThen = null;
      then?.();
      return;
    }
    this.sfx('select');
    this.speakStory();
    this.notify();
  }

  /** The end page's way on: the boat to the next island, or the ending after the last one. */
  sailOn() {
    if (this.scene !== 'end') return;
    const ch = this.chapter;
    if (ch === 4) {
      setFlag(this.run, 'ending');
      this.saveRun();
      this.showStory({ kind: 'ending', who: S.endingTitle.en, whoKo: S.endingTitle.ko, lines: ADVENTURE_ENDING, i: 0 }, 'ending', () =>
        this.showStory({ kind: 'credits', who: S.title.en, whoKo: S.title.ko, lines: ADVENTURE_CREDITS, i: 0 }, 'ending', () => this.toTitle())
      );
      return;
    }
    const next = (ch + 1) as AdventureChapterId;
    this.showStory({ kind: 'sail', who: ADVENTURE_FERRY.nameEn, whoKo: ADVENTURE_FERRY.nameKo, lines: ADVENTURE_SAIL[ch as 1 | 2 | 3], i: 0 }, 'sail', () => this.startChapter(next));
  }

  // ---------- input ----------
  /**
   * Z / Enter (R2734: it never stalls — every screen has one thing Z does). Returns false only where the panel's own
   * buttons are the answer (building a sentence, spelling, the microphone), so the page presses the focused button.
   */
  confirm(): boolean {
    this.sound.unlock();
    if (this.scene === 'title') {
      this.begin();
      return true;
    }
    if (this.scene === 'story') {
      this.advanceStory();
      return true;
    }
    if (this.scene === 'down') {
      this.wake();
      return true;
    }
    if (this.scene === 'end') {
      this.sailOn();
      return true;
    }
    if (this.scene === 'explore') {
      if (this.shop) {
        this.shopPick(this.cursor);
        return true;
      }
      if (this.exploreMsg) {
        this.advanceExplore(Boolean(this.exploreMsg.stone));
        return true;
      }
      this.interactFacing();
      return true;
    }
    if (this.scene === 'battle' && this.battle) {
      const b = this.battle;
      if (b.phase === 'msg') {
        const text = b.msgs[0]?.line.en ?? '';
        if (this.reveal < text.length) {
          this.reveal = text.length;
          this.notify();
          return true;
        }
        b.advance();
        this.afterBattleChange();
        return true;
      }
      if (b.phase === 'menu') {
        this.command(MENU[this.menuIndex]!);
        return true;
      }
      if (b.phase === 'talkPick') {
        const t = b.choices[this.cursor];
        if (t) this.pickTalk(t.id);
        return true;
      }
      if (b.phase === 'skillPick') {
        const id = b.skillList[this.cursor];
        if (id) this.pickSkill(id);
        return true;
      }
      if (b.phase === 'pouch') {
        const k = this.pouchRows()[this.cursor];
        if (k) this.useItem(k);
        return true;
      }
      if (b.phase === 'talk' && b.current) {
        const r = this.talk.result;
        if (r && r.pass && r.stars > 0) {
          this.talkDone(r);
          return true;
        }
        if (b.current.mode === 'pick') {
          const c = b.current.choices?.[this.cursor];
          if (c) this.talkAttempt({ mode: 'pick', answer: c });
          return true;
        }
        return false;
      }
      if (b.phase === 'poke') {
        b.strike();
        this.afterBattleChange();
        return true;
      }
      if (b.phase === 'befriend') {
        this.befriend(false);
        return true;
      }
      if (b.phase === 'end') {
        this.leaveBattle();
        return true;
      }
      // dodge: the arrow keys move the voice bubble; Z has nothing to wait for
      return true;
    }
    return false;
  }

  cancel() {
    if (this.scene === 'battle' && this.battle) {
      this.battle.back();
      this.afterBattleChange();
    } else if (this.scene === 'explore' && this.shop) this.leaveShop();
    else if (this.scene === 'explore' && this.exploreMsg) this.advanceExplore(true);
  }

  /** How many rows the list on screen has (0 = no list). */
  listLen(): number {
    if (this.scene === 'explore') {
      if (this.shop) return this.shopRows().length + 1;
      const m = this.exploreMsg;
      if (m?.choices && m.i === m.lines.length - 1) return m.choices.length;
      return 0;
    }
    const b = this.battle;
    if (this.scene !== 'battle' || !b) return 0;
    if (b.phase === 'talkPick') return b.choices.length;
    if (b.phase === 'skillPick') return b.skillList.length;
    if (b.phase === 'pouch') return this.pouchRows().length;
    if (b.phase === 'talk' && b.current?.mode === 'pick' && !(this.talk.result?.pass && this.talk.result.stars > 0)) return b.current.choices?.length ?? 0;
    return 0;
  }

  menuMove(d: number) {
    if (this.scene === 'title') {
      const i = CHAPTER_IDS.indexOf(this.selected);
      this.selectIsland(CHAPTER_IDS[(i + d + 4) % 4]!);
      return;
    }
    if (this.scene === 'battle' && this.battle?.phase === 'menu') {
      this.menuIndex = (this.menuIndex + d + MENU.length) % MENU.length;
      this.sfx('move');
      this.notify();
      return;
    }
    const n = this.listLen();
    if (n > 0) {
      this.cursor = (this.cursor + d + n) % n;
      this.sfx('move');
      this.notify();
    }
  }

  /** Arrow keys: a list on screen takes them, else they walk / move the voice bubble. */
  wantsArrows(): boolean {
    return this.scene === 'title' || (this.scene === 'battle' && this.battle?.phase === 'menu') || this.listLen() > 0;
  }

  setCursor(i: number) {
    if (i === this.cursor) return;
    this.cursor = i;
    this.notify();
  }

  command(c: Command) {
    const b = this.battle;
    if (!b || b.phase !== 'menu') return;
    this.menuIndex = MENU.indexOf(c);
    b.choose(c);
    this.cursor = 0;
    this.afterBattleChange();
  }

  private pouchRows(): ItemKey[] {
    return ITEM_KEYS.filter((k) => this.run.items[k] > 0);
  }

  pickTalk(id: string) {
    this.battle?.pickTalk(id);
    const t = this.battle?.current;
    this.talk = { tries: 0, result: null };
    this.cursor = 0;
    if (t && t.mode !== 'spell') {
      // a learner hears the model sentence first at L1; above, on the 🔊
      if (this.plan?.level === 1 && t.mode === 'say') void this.voice.speak(npcCast().modelVoice, t.target);
      if (t.mode === 'pick' && t.prompt && this.battle) void this.voice.speak(islanderVoice(this.battle.enc.creature.id, this.battle.enc.creature.voice), t.prompt.en);
    } else if (t?.mode === 'spell') void this.voice.speak(npcCast().modelVoice, t.target, 0.8);
    this.afterBattleChange();
  }

  /** SKILL: the magic words open as a TALK (pick or say them). */
  pickSkill(id: AdventureSkillId) {
    this.battle?.pickSkill(id);
    this.talk = { tries: 0, result: null };
    this.cursor = 0;
    this.afterBattleChange();
  }

  /** The TALK panel's answer. `transcripts` for say (voice or typed), `answer` for build/spell/pick. */
  talkAttempt(a: { mode: AdventureLineMode; transcripts?: string[]; answer?: string }): Graded {
    const b = this.battle;
    const t = b?.current;
    if (!b || !t || !this.record) return { stars: 0, score: 0, pass: false, missed: [] };
    const tries = this.talk.tries + 1;
    let g: Graded;
    const level = this.plan?.level ?? this.level;
    if (t.mode === 'say') g = gradeSpoken(t.target, a.transcripts ?? [], level);
    else if (t.mode === 'pick') g = gradePick(t.target, a.answer ?? '', tries);
    else if (t.mode === 'spell') g = gradeSpelling(t.target, a.answer ?? '', tries);
    else g = gradeExact(t.target, a.answer ?? '', tries);
    const ko = t.ko ?? '';
    addLine(this.record, { en: t.target, ko, mode: a.mode, ok: g.pass && g.stars > 0, stars: g.stars });
    if (t.word && t.mode === 'spell') wordHit(this.record, t.word, g.pass ? 'caught' : 'missed');
    // a day word inside what the child said or typed is a word they used (the guardian's word column)
    if (t.mode === 'say') wordsSaid(this.record, a.transcripts ?? []);
    if (!g.pass || g.stars === 0) this.sfx('wrong');
    else this.sfx('select');
    this.talk = { tries, result: g };
    this.notify();
    return g;
  }

  /** After the panel showed the stars: hand the result to the encounter. */
  talkDone(g: Graded) {
    this.battle?.talkResult(g);
    this.talk = { tries: 0, result: null };
    this.cursor = 0;
    this.saveRun();
    this.afterBattleChange();
  }

  talkSkip() {
    this.battle?.talkSkip();
    this.talk = { tries: 0, result: null };
    this.afterBattleChange();
  }

  useItem(k: ItemKey) {
    this.battle?.useItem(k);
    this.saveRun();
    this.afterBattleChange();
  }

  befriend(said: boolean, transcript?: string[], mode: 'voice' | 'typed' = 'voice') {
    const b = this.battle;
    if (!b || b.phase !== 'befriend' || !this.plan || !this.record) return;
    const line = this.plan.chapter.befriend[this.plan.level];
    if (said && transcript) {
      const g = gradeSpoken(line.en, transcript, this.plan.level);
      addLine(this.record, { en: line.en, ko: line.ko, mode, ok: g.pass, stars: g.stars });
      wordsSaid(this.record, transcript);
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
    if (this.scene === 'explore' && !this.exploreMsg && !this.shop) {
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

  // ---------- trip state ----------
  private saveRun() {
    try {
      store()?.setItem(RUN_KEY, JSON.stringify(this.run));
    } catch {
      // storage blocked: this tab remembers
    }
  }

  /** Start the whole trip again from island 1 (the map's "new trip"; island progress and records stay). */
  newTrip() {
    this.run = newRun();
    this.saveRun();
    this.notify();
  }

  // ---------- talks with choices ----------
  /** Open a node of an islander's talk tree ('@end' closes, '@shop' opens Tumble's cart). Rewards are given once. */
  private openNode(tree: AdventureNpc, node: string) {
    if (node === '@shop') return this.openShop();
    const n = tree.tree[node];
    if (node === '@end' || !n) return this.closeMsg();
    const taken = n.reward ? hasFlag(this.run, n.reward.flag) : false;
    const lines = [...(taken ? (n.after ?? n.lines) : n.lines)];
    if (n.reward && !taken) {
      const r = n.reward;
      setFlag(this.run, r.flag);
      if (r.coins) {
        addCoins(this.run, r.coins);
        lines.push(S.coinsGot(r.coins));
        this.sfx('coin');
      }
      if (r.item) {
        this.run.items[r.item] = Math.min(ADV.items.maxEach, this.run.items[r.item] + 1);
        lines.push(S.itemGot(ADVENTURE_ITEMS[r.item].nameEn, ADVENTURE_ITEMS[r.item].nameKo));
      }
      if (r.skill && learn(this.run, r.skill)) {
        lines.push(S.skillLearned(ADVENTURE_SKILLS[r.skill].nameEn, ADVENTURE_SKILLS[r.skill].nameKo));
        this.sfx('skill');
      }
      this.saveRun();
    }
    const voice = islanderVoice(tree.id, tree.voice);
    this.exploreMsg = {
      who: tree.nameEn,
      whoKo: tree.nameKo,
      lines,
      i: 0,
      voice,
      choices: n.choices?.map((c) => c.say),
      npc: { tree, node },
      after: n.choices ? undefined : { kind: 'node', to: n.next ?? '@end' }
    };
    this.cursor = 0;
    this.reveal = 0;
    void this.voice.speak(voice, lines[0]!.en);
    this.notify();
  }

  /** A reply picked in an islander's talk (click, or the cursor + Z). */
  chooseReply(i: number) {
    const m = this.exploreMsg;
    if (!m?.choices || !m.npc || m.i !== m.lines.length - 1) return;
    const node = m.npc.tree.tree[m.npc.node];
    const c = node?.choices?.[i];
    if (!c) return;
    this.sfx('select');
    this.openNode(m.npc.tree, c.to);
  }

  private closeMsg() {
    this.exploreMsg = null;
    this.reveal = 0;
    if (this.scene === 'explore' && this.plan) this.music(this.plan.chapter.music);
    this.notify();
  }

  // ---------- Tumble's cart ----------
  private shopRows(): ShopRow[] {
    return ADVENTURE_STORY[this.chapter].stock.map((g) => {
      const name = adventureGoodsName(g.id);
      return { id: g.id, kind: g.kind, en: name.en, ko: name.ko, info: adventureGoodsInfo(g.id), cost: g.cost, check: canBuy(this.run, g) };
    });
  }

  private openShop() {
    this.exploreMsg = null;
    this.shop = { note: null };
    this.cursor = 0;
    this.music('shop');
    this.sfx('select');
    this.notify();
  }

  /** Buy the row (the row after the last one is "Bye!"). */
  shopPick(i: number) {
    if (!this.shop) return;
    const stock = ADVENTURE_STORY[this.chapter].stock;
    const g = stock[i];
    this.cursor = i;
    if (!g) return this.leaveShop();
    const r = buy(this.run, g);
    const name = adventureGoodsName(g.id);
    this.shop.note = r === 'ok' ? S.shopBought(name.en, name.ko) : r === 'coins' ? S.shopNoCoins : r === 'owned' ? S.shopOwned : S.shopFull;
    this.sfx(r === 'ok' ? 'buy' : 'wrong');
    if (r === 'ok') this.saveRun();
    this.notify();
  }

  leaveShop() {
    if (!this.shop) return;
    this.shop = null;
    this.openNode(ADVENTURE_MERCHANT, 'bye');
  }

  // ---------- out of voice ----------
  /** Wake at the last lantern post touched on this island (or on its beach), voice full; a guardian is met again slower. */
  wake() {
    if (this.scene !== 'down' || !this.island) return;
    const boss = this.down?.boss ?? false;
    revive(this.run, boss ? this.chapter : undefined);
    const post = this.run.post && this.run.post.chapter === this.chapter ? this.entities.find((e) => e.e.id === this.run.post!.id) : null;
    if (post) this.placeAt(post.e.tx, post.e.ty + 1);
    else this.placeAt(this.island.start.tx, this.island.start.ty);
    this.saveRun();
    this.down = null;
    this.scene = 'explore';
    this.fade = 1;
    this.sfx('revive');
    this.music(this.plan?.chapter.music ?? null);
    this.exploreMsg = { who: S.post.en, whoKo: S.post.ko, lines: [S.postRest], i: 0, voice: null };
    this.reveal = 0;
    this.notify();
  }

  // ---------- explore ----------
  /** Z on a talk: show the whole line, then the next; on the last line with replies, Z picks the reply at the cursor. */
  private advanceExplore(skip = false) {
    const m = this.exploreMsg;
    if (!m) return;
    const text = m.lines[m.i]?.en ?? '';
    if (!skip && this.reveal < text.length) {
      this.reveal = text.length;
      this.notify();
      return;
    }
    const last = m.i >= m.lines.length - 1;
    if (!skip && last && m.choices?.length) return this.chooseReply(this.cursor);
    if (!skip && !last) {
      m.i += 1;
      this.reveal = 0;
      if (m.voice) void this.voice.speak(m.voice, m.lines[m.i]!.en);
      this.notify();
      return;
    }
    // the talk is over (or skipped with X): what it leads to still happens — a guardian is still met, an island still ends
    const after = m.after;
    this.exploreMsg = null;
    this.reveal = 0;
    if (after?.kind === 'guardian') return this.startBattle(2);
    if (after?.kind === 'finish') return this.finishChapter();
    if (after?.kind === 'node' && m.npc && !skip) return this.openNode(m.npc.tree, after.to);
    this.closeMsg();
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
          this.exploreMsg = { who: c.nameEn, whoKo: c.nameKo, lines: [c.friend], i: 0, voice: islanderVoice(c.id, c.voice) };
          this.reveal = 0;
          this.notify();
        }
        return;
      }
      if (e.kind === 'guardian') {
        // the guardian speaks first (R2734: a meeting with a build-up), then the meeting begins — Z or X both lead on
        const g = ch.guardian;
        const v = islanderVoice(g.id, g.voice);
        this.exploreMsg = { who: g.nameEn, whoKo: g.nameKo, lines: [...ADVENTURE_STORY[this.chapter].bossTalk], i: 0, voice: v, after: { kind: 'guardian' } };
        this.reveal = 0;
        this.music(BOSS_TRACK[this.chapter]);
        this.sfx('encounter');
        void this.voice.speak(v, this.exploreMsg.lines[0]!.en);
        this.notify();
        return;
      }
      this.startBattle(e.index);
      return;
    }
    if (!force && this.lastTouch === e.id) return;
    this.lastTouch = e.id;
    if (e.kind === 'villager') {
      es.talked += 1;
      return this.openNode(ADVENTURE_STORY[this.chapter].villager, 'start');
    }
    if (e.kind === 'merchant') {
      es.talked += 1;
      return this.openNode(ADVENTURE_MERCHANT, 'start');
    }
    if (e.kind === 'stone') {
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
    } else if (e.kind === 'chest') {
      const got = openChest(this.run, this.chapter, e.index as 0 | 1);
      es.state = 'open';
      if (got) {
        this.sfx('chest');
        this.sfx('coin');
        const item = got.item ? { en: ADVENTURE_ITEMS[got.item].nameEn, ko: ADVENTURE_ITEMS[got.item].nameKo } : null;
        this.exploreMsg = { who: S.chest.en, whoKo: S.chest.ko, lines: [S.chestOpen(got.coins, item)], i: 0, voice: null };
        this.saveRun();
      } else this.exploreMsg = { who: S.chest.en, whoKo: S.chest.ko, lines: [S.chestEmpty], i: 0, voice: null };
    } else if (e.kind === 'post') {
      restAt(this.run, { chapter: this.chapter, id: e.id });
      es.talked += 1;
      this.saveRun();
      this.sfx('post');
      this.music('post');
      this.exploreMsg = { who: S.post.en, whoKo: S.post.ko, lines: [S.postRest], i: 0, voice: null };
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
      // a stone said out loud pays once per island (R2734 coins)
      if (setFlag(this.run, `stone-${this.chapter}-${m.stone.index}`)) {
        addCoins(this.run, ADV.coins.stoneLit);
        this.sfx('coin');
        this.saveRun();
      }
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
    if (!this.exploreMsg && !this.shop) {
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
    if (g && !this.exploreMsg && !this.shop && p.x > g.x - 26) {
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
    const boss = enc.creature.role === 'guardian';
    this.battle = new Battle(
      enc,
      createRng(hashSeed(this.plan.seed, i, this.t)),
      this.run,
      {
        sfx: (n) => this.sfx(n),
        word: (w, kind) => this.record && wordHit(this.record, w, kind),
        hurt: (d) => {
          if (this.record) this.record.hpLost += d;
        },
        // the guardian's last stages get its hottest tune
        stage: (s) => {
          if (s >= 2) this.music(BOSS_LAST_TRACK[this.chapter]);
        }
      },
      { level: this.plan.level, speedMul: boss ? retrySpeed(this.run, this.chapter) : 1 }
    );
    this.menuIndex = 1;
    this.cursor = 0;
    this.talk = { tries: 0, result: null };
    this.scene = 'battle';
    this.fade = 1;
    this.reveal = 0;
    this.sfx('encounter');
    this.music(boss ? BOSS_TRACK[this.chapter] : 'battle');
    const v = islanderVoice(enc.creature.id, enc.creature.voice);
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
      if (m?.who === 'creature') void this.voice.speak(islanderVoice(b.enc.creature.id, b.enc.creature.voice), m.line.en);
      if (b.phase === 'dodge' && b.turnLine) void this.voice.speak(islanderVoice(b.enc.creature.id, b.enc.creature.voice), b.turnLine.en);
    }
    this.notify();
  }

  private leaveBattle() {
    const b = this.battle;
    if (!b || !this.plan || !this.record) return;
    const enc = b.enc;
    const isBoss = this.battleEnc === 2;
    this.battle = null;
    if (b.outcome === 'down') {
      // out of voice: the "down" page, then the last lantern post (the islander stays where it was)
      this.saveRun();
      this.down = { where: this.run.post?.chapter === this.chapter ? 'post' : 'start', boss: isBoss };
      this.scene = 'down';
      this.fade = 1;
      this.music('down');
      this.notify();
      return;
    }
    const es = this.entities.find((e) => (isBoss ? e.e.kind === 'guardian' : e.e.kind === 'critter' && e.e.index === this.battleEnc));
    const lines: AdventureLine[] = [];
    if (b.outcome === 'spared') {
      this.record.befriended.push(enc.creature.id);
      if (es) {
        es.state = 'friend';
        es.y -= ADV.tile; // steps off the path
      }
      const coins = isBoss ? ADV.coins.guardianFriend : ADV.coins.critterFriend;
      addCoins(this.run, coins);
      lines.push(S.coinsGot(coins));
      this.sfx('coin');
    } else {
      this.record.fought.push(enc.creature.id);
      if (es) es.state = 'gone';
    }
    this.saveRun();
    this.scene = 'explore';
    this.fade = 1;
    this.reveal = 0;
    this.music(this.plan.chapter.music);
    if (isBoss) {
      this.record.outcome = b.outcome === 'spared' ? 'spared' : 'fought';
      setFlag(this.run, `boss-${this.chapter}`);
      const g = this.plan.chapter.guardian;
      this.exploreMsg = { who: g.nameEn, whoKo: g.nameKo, lines: [...ADVENTURE_STORY[this.chapter].bossAfter, ...lines], i: 0, voice: null, after: { kind: 'finish' } };
    } else if (lines.length) this.exploreMsg = { who: S.coinsLabel.en, whoKo: S.coinsLabel.ko, lines, i: 0, voice: null };
    this.notify();
  }

  private finishChapter() {
    if (!this.record || !this.plan) return;
    const r = this.record;
    r.endedMs = Date.now();
    const act = toActivity(r, r.endedMs);
    const today = this.lessonDay();
    this.progress = recordFinish(this.progress, this.chapter, today, { stars: chapterStars(r), outcome: r.outcome, words: this.plan.words.map((w) => w.w), activity: act });
    this.saveLocal();
    void this.saveServer();
    const had = this.sessionActs.get(act.id);
    if (!had || betterPlay(act, had)) this.sessionActs.set(act.id, act);
    const friends = r.befriended.map((id) => {
      const c = [...this.plan!.chapter.critters, this.plan!.chapter.guardian].find((x) => x.id === id);
      return c?.nameEn ?? id;
    });
    const nextNote: NonNullable<Snapshot['end']>['nextNote'] = this.chapter === 4 ? 'done-all' : 'sail';
    this.end = { activity: act, friends, words: this.plan.words.map((w) => w.w), nextNote, back: this.ed?.back ?? null, sent: this.ed ? 'sending' : 'off' };
    const end = this.end;
    void this.postResults().then((sent) => {
      if (this.end === end) {
        this.end = { ...end, sent };
        this.notify();
      }
    });
    this.scene = 'end';
    this.exploreMsg = null;
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
    const dated = datedPlays(this.ed.date ?? this.day?.date, this.today(), acts);
    const env = buildEnvelope(this.ed.student, dated.date, dated.acts);
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

  // ---------- headless checks ----------
  /**
   * What tools/adventure-play.mjs reads to find its way (the page never reads it): the scene, the list on screen, the
   * island's walls, where everyone stands, the trip and the audio graph. The bot still plays only with keys.
   */
  debugState() {
    const T = ADV.tile;
    const b = this.battle;
    const isl = this.island;
    return {
      scene: this.scene,
      chapter: this.chapter,
      phase: b?.phase ?? null,
      msg: this.scene === 'story' ? (this.story?.lines[this.story.i]?.en ?? null) : this.exploreMsg ? (this.exploreMsg.lines[this.exploreMsg.i]?.en ?? null) : b?.phase === 'msg' ? (b.msgs[0]?.line.en ?? null) : null,
      msgWho: this.exploreMsg?.who ?? null,
      choices: this.exploreMsg?.choices?.map((c) => c.en) ?? null,
      shop: this.shop ? this.shopRows().map((r) => ({ id: r.id, kind: r.kind, cost: r.cost, check: r.check })) : null,
      cursor: this.cursor,
      listLen: this.listLen(),
      menuIndex: this.menuIndex,
      talk: b?.current ? { id: b.current.id, mode: b.current.mode, target: b.current.target, choices: b.current.choices ?? null, skill: b.current.skill ?? null, result: this.talk.result } : null,
      talkChoices: b?.phase === 'talkPick' ? b.choices.map((c) => ({ id: c.id, mode: c.mode })) : null,
      skillList: b ? (b.phase === 'skillPick' ? [...b.skillList] : this.run.skills.filter((k) => !b.usedSkills.has(k))) : null,
      pouch: b ? this.pouchRows() : null,
      battle: b ? { creature: b.enc.creature.id, boss: b.enc.creature.role === 'guardian', cls: b.enc.cls, calm: b.calm, calmMax: b.enc.calmMax, grump: b.grump, ready: b.ready, stage: b.stage, stageCount: b.stageCount, slow: b.slow, outcome: b.outcome, soul: { ...b.soul } } : null,
      player: { x: this.player.x, y: this.player.y, tx: Math.floor(this.player.x / T), ty: Math.floor((this.player.y - 1) / T), dir: this.player.dir, flip: this.player.flip },
      entities: this.entities.map((e) => ({ id: e.e.id, kind: e.e.kind, index: e.e.index, tx: e.e.tx, ty: e.e.ty, x: e.x, y: e.y, state: e.state, box: entityBox(e) })),
      tile: T,
      speed: ADV.player.speed,
      walls: isl ? Array.from({ length: isl.h }, (_, y) => Array.from({ length: isl.w }, (_, x) => (blocks(tileAt(isl, x, y)) ? '#' : '.')).join('')) : null,
      run: { ...this.run, hpMax: maxHp(this.run) },
      down: this.down,
      end: this.end ? { nextNote: this.end.nextNote, sent: this.end.sent, stars: this.end.activity.stars } : null,
      story: this.story ? { kind: this.story.kind, i: this.story.i, n: this.story.lines.length } : null,
      progress: this.progress,
      audio: this.sound.state(),
      reveal: this.reveal,
      frames: this.frames
    };
  }

  // ---------- loop ----------
  step(dt: number) {
    this.t += dt;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3);
    const textNow =
      this.scene === 'story'
        ? this.story?.lines[this.story.i]?.en
        : this.scene === 'explore'
          ? this.exploreMsg?.lines[this.exploreMsg.i]?.en
          : this.battle?.phase === 'msg'
            ? this.battle.msgs[0]?.line.en
            : null;
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
