/**
 * Lesson controller (docs/19 §4): joins with the code, polls /v1/lesson/state every 3 s and turns what changed into
 * world calls — scene change, goal line, possession sparkle, NPC bubbles, director events. Pure apart from the
 * injected api, world and timers, so it is tested without a browser.
 */
import { LESSON_DIRECTOR_EVENTS, getLessonNpc, type LessonDirectorEventKind, type LessonSceneId } from '@lcw/content';
import {
  LessonHttpError,
  loadStudentSession,
  readUtteranceSubmit,
  saveStudentSession,
  type DialogResult,
  type KeyValue,
  type LessonOffer,
  type StudentLessonApi,
  type StudentLessonState,
  type StudentSession,
  type UtteranceSubmit
} from './api.js';

export const LESSON_POLL_MS = 3_000;
export const LESSON_RETRY_MAX_MS = 15_000;
export const LESSON_BANNER_MS = 6_000;
export const LESSON_BUBBLES_KEPT = 3;

/** What the lesson needs from the world (docs/19 §2 WorldHandle; the two optional methods are lesson additions). */
export interface LessonWorld {
  goToScene(id: LessonSceneId): Promise<void>;
  npcSay(npcId: string, text: string, opts?: { possessed?: boolean }): void;
  setGoal(goalKo: string, targetEn?: string): void;
  celebrate(stars: 0 | 1 | 2 | 3): void;
  setPossessed?(npcId: string | null): void;
  playDirectorEvent?(kind: LessonDirectorEventKind, detail: string): void;
}

export type LessonPhase = 'needs_code' | 'joining' | 'live' | 'ended';
export type LessonConnection = 'ok' | 'retrying';

export interface LessonBubble {
  id: string;
  npcId: string;
  npcNameKo: string;
  text: string;
  possessed: boolean;
  at: number;
}

export interface LessonBanner {
  id: string;
  kind: LessonDirectorEventKind;
  icon: string;
  textKo: string;
  detail: string;
  shownAt: number;
}

export interface LessonView {
  phase: LessonPhase;
  connection: LessonConnection;
  errorCode: string | null;
  nickname: string;
  level: StudentSession['level'];
  stageId: string | null;
  sceneId: LessonSceneId | null;
  goalKo: string;
  mode: StudentLessonState['mode'];
  hint: StudentLessonState['hint'];
  npcId: string;
  offers: LessonOffer[];
  possessedNpcId: string | null;
  bubbles: LessonBubble[];
  banner: LessonBanner | null;
  lastResult: (DialogResult & { utterancesToday: number }) | null;
  /** Bumps on every stage change so the dialog can reset. */
  stageSeq: number;
}

export interface LessonTimers {
  setTimeout(fn: () => void | Promise<void>, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
}

export interface LessonControllerOptions {
  api: StudentLessonApi;
  world: LessonWorld | null;
  store?: KeyValue | null;
  timers?: LessonTimers;
  ui?: '3d' | 'cards';
  onChange?: (v: LessonView) => void;
}

const defaultTimers: LessonTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(() => void fn(), ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now()
};

export function initialLessonView(): LessonView {
  return {
    phase: 'needs_code',
    connection: 'ok',
    errorCode: null,
    nickname: '',
    level: 'L1',
    stageId: null,
    sceneId: null,
    goalKo: '',
    mode: 'guided',
    hint: 'full',
    npcId: 'guide',
    offers: [],
    possessedNpcId: null,
    bubbles: [],
    banner: null,
    lastResult: null,
    stageSeq: 0
  };
}

export class LessonController {
  private view: LessonView = initialLessonView();
  private session: StudentSession | null = null;
  private cursor: number | null = null;
  private timer: unknown = null;
  private bannerTimer: unknown = null;
  private retryMs = LESSON_POLL_MS;
  private readonly seenLines = new Set<string>();
  private readonly seenEvents = new Set<string>();
  private stopped = false;
  private polling = false;
  /** Bumps on start/stop/leave; a poll that began in an older run drops its answer (StrictMode, HMR, re-mount). */
  private run = 0;
  private readonly timers: LessonTimers;

  constructor(private readonly opts: LessonControllerOptions) {
    this.timers = opts.timers ?? defaultTimers;
  }

  get state(): LessonView {
    return this.view;
  }

  /** Starts from a code in the URL, else from a session kept in this tab, else asks for the code. */
  async start(code: string | null): Promise<void> {
    this.halt();
    this.stopped = false;
    if (code) return this.join(code);
    const s = loadStudentSession(this.store());
    if (!s) return this.set({ phase: 'needs_code' });
    this.session = s;
    this.set({ phase: 'live', nickname: s.nickname, level: s.level });
    await this.poll();
  }

  async join(code: string): Promise<void> {
    if (!/^\d{6}$/.test(code)) return this.set({ phase: 'needs_code', errorCode: 'invalid_code' });
    this.set({ phase: 'joining', errorCode: null });
    const run = this.run;
    try {
      const r = await this.opts.api.join(code);
      if (run !== this.run) return;
      this.session = { token: r.student_token, lessonId: r.lesson_id, nickname: r.nickname, level: r.level };
      saveStudentSession(this.session, this.store());
      this.cursor = null;
      this.set({ phase: 'live', nickname: r.nickname, level: r.level });
      await this.poll();
    } catch (e) {
      if (run !== this.run) return;
      this.set({ phase: 'needs_code', errorCode: e instanceof LessonHttpError ? e.code : 'network' });
    }
  }

  /** The dialog panel's `submit` during a lesson: server scores, the world celebrates passes. */
  readonly submit = async (u: UtteranceSubmit | unknown): Promise<DialogResult> => {
    const s = this.session;
    if (!s) throw new LessonHttpError(401, 'student_only');
    const r = await this.opts.api.utterance(s.token, readUtteranceSubmit(u));
    const result: DialogResult = { pass: r.pass, stars: r.stars, feedbackKo: r.feedback_ko, coinsTotal: r.coins_total };
    // No celebrate here: whoever shows the result plays it (App's DialogHost, or the layer's own panel), once.
    this.set({ lastResult: { ...result, utterancesToday: r.utterances_today } });
    return result;
  };

  stop(): void {
    this.halt();
    this.stopped = true;
  }

  private halt(): void {
    this.run++;
    this.polling = false;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    if (this.bannerTimer !== null) this.timers.clearTimeout(this.bannerTimer);
    this.timer = null;
    this.bannerTimer = null;
  }

  /** Leave the lesson on this device (wrong child, shared tablet). */
  leave(): void {
    this.halt();
    saveStudentSession(null, this.store());
    this.session = null;
    this.cursor = null;
    this.stopped = false;
    this.view = { ...initialLessonView() };
    this.emit();
  }

  async poll(): Promise<void> {
    const s = this.session;
    if (!s || this.stopped || this.polling) return;
    const run = this.run;
    this.polling = true;
    try {
      const st = await this.opts.api.state(s.token, {
        cursor: this.cursor,
        scene: this.view.sceneId ?? undefined,
        ui: this.opts.ui ?? '3d'
      });
      if (run !== this.run) return;
      this.retryMs = LESSON_POLL_MS;
      this.apply(st);
      if (this.view.connection !== 'ok' || this.view.errorCode) this.set({ connection: 'ok', errorCode: null });
    } catch (e) {
      if (run !== this.run) return;
      if (e instanceof LessonHttpError && e.status === 401) {
        // The token expired (lesson ended more than 10 minutes ago, or 12 h passed): ask for a new code.
        saveStudentSession(null, this.store());
        this.session = null;
        this.polling = false;
        return this.set({ phase: this.view.phase === 'ended' ? 'ended' : 'needs_code', errorCode: 'expired' });
      }
      this.retryMs = Math.min(LESSON_RETRY_MAX_MS, this.retryMs * 2);
      this.set({ connection: 'retrying' });
    } finally {
      if (run === this.run) this.polling = false;
    }
    if (run !== this.run || this.view.phase === 'ended' || this.stopped || !this.session) return;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => this.poll(), this.view.connection === 'ok' ? LESSON_POLL_MS : this.retryMs);
  }

  /** Applies one state response. Exposed for tests and for the cards fallback. */
  apply(st: StudentLessonState): void {
    const w = this.opts.world;
    this.cursor = st.cursor;
    const patch: Partial<LessonView> = {};
    const stageChanged = st.stage_id !== this.view.stageId;
    const targetsChanged = JSON.stringify(st.offers) !== JSON.stringify(this.view.offers);
    if (stageChanged) {
      patch.stageId = st.stage_id;
      patch.sceneId = st.scene_id;
      patch.stageSeq = this.view.stageSeq + 1;
      patch.lastResult = null;
      if (w && st.scene_id !== this.view.sceneId) void w.goToScene(st.scene_id).catch(() => undefined);
    }
    if (stageChanged || targetsChanged || st.stage_goal_ko !== this.view.goalKo) {
      w?.setGoal(st.stage_goal_ko, st.offers[0]?.text);
    }
    Object.assign(patch, {
      goalKo: st.stage_goal_ko,
      mode: st.mode,
      hint: st.hint,
      npcId: st.npc_id,
      offers: st.offers
    });
    if (st.possessed_npc_id !== this.view.possessedNpcId) {
      patch.possessedNpcId = st.possessed_npc_id;
      w?.setPossessed?.(st.possessed_npc_id);
    }
    const fresh: LessonBubble[] = [];
    for (const line of st.npc_lines) {
      if (this.seenLines.has(line.id)) continue;
      this.seenLines.add(line.id);
      // Lines only come from the director's npc-say, which possesses that NPC as it speaks: always the teacher's voice,
      // even if the teacher switched NPC before this poll.
      const possessed = line.possessed ?? true;
      w?.npcSay(line.npc_id, line.text, { possessed });
      fresh.push({
        id: line.id,
        npcId: line.npc_id,
        npcNameKo: getLessonNpc(line.npc_id)?.nameKo ?? line.npc_id,
        text: line.text,
        possessed,
        at: line.at
      });
    }
    if (fresh.length) patch.bubbles = [...this.view.bubbles, ...fresh].slice(-LESSON_BUBBLES_KEPT);
    for (const ev of st.events) {
      if (this.seenEvents.has(ev.id)) continue;
      this.seenEvents.add(ev.id);
      const def = LESSON_DIRECTOR_EVENTS.find((x) => x.kind === ev.kind);
      if (!def) continue;
      w?.playDirectorEvent?.(ev.kind, ev.detail);
      if (ev.kind === 'star_celebration') w?.celebrate(3);
      patch.banner = {
        id: ev.id,
        kind: ev.kind,
        icon: def.icon,
        textKo: def.studentBannerKo,
        detail: ev.detail,
        shownAt: this.timers.now()
      };
      if (this.bannerTimer !== null) this.timers.clearTimeout(this.bannerTimer);
      const id = ev.id;
      this.bannerTimer = this.timers.setTimeout(() => {
        if (this.view.banner?.id === id) this.set({ banner: null });
      }, LESSON_BANNER_MS);
    }
    if (st.ended) patch.phase = 'ended';
    this.set(patch);
  }

  private store(): KeyValue | null | undefined {
    return this.opts.store;
  }

  private set(patch: Partial<LessonView>): void {
    this.view = { ...this.view, ...patch };
    this.emit();
  }

  private emit(): void {
    this.opts.onChange?.(this.view);
  }
}
