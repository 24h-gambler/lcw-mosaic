/**
 * Lesson controller (docs/19 §4): joins with the code, polls /v1/lesson/state every 3 s and turns what changed into
 * world calls — scene change, goal line, possession sparkle, NPC bubbles, director events. Pure apart from the
 * injected api, world and timers, so it is tested without a browser.
 */
import {
  LESSON_DIRECTOR_EVENTS,
  flushOutbox,
  isRetryableStatus,
  newUtteranceClientId,
  outboxSessionStore,
  pushOutbox,
  readOutbox,
  type LessonDirectorEventKind,
  type LessonHintLevel,
  type LessonSceneId,
  type OutboxStore
} from '@lcw/content';
import { SubmitError } from '../dialog/submit.js';
import {
  LessonHttpError,
  loadStudentSession,
  readLessonMicStatus,
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
import { childNpcName, lessonGoal } from './strings.js';

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
  /** HUD coin chip (WorldHandle.setCoins): the ledger balance from the first poll on. */
  setCoins?(n: number | null): void;
  /** HUD star chip owned by the lesson: this lesson's stars (WorldHandle.setStars). */
  setStars?(n: number | null): void;
  /** Teacher name tag (WorldHandle.setTeacher): with the teacher, or "혼자 놀기"; null = no lesson. */
  setTeacher?(t: { present: boolean; name: string | null } | null): void;
  /** Marks the NPC to talk to over its head (WorldHandle.setGoalNpc): the lesson's NPC while it runs, null after. */
  setGoalNpc?(npcId: string | null): void;
}

export type LessonPhase = 'needs_code' | 'joining' | 'live' | 'ended';
export type LessonConnection = 'ok' | 'retrying';

export interface LessonBubble {
  id: string;
  npcId: string;
  npcNameKo: string;
  /** The NPC's name in the language the child learns (shown first; the Korean only as the help line). */
  npcNameEn?: string;
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
  /** The goal in the language the child learns ('' from an older server: the Korean shows). */
  goalEn: string;
  mode: StudentLessonState['mode'];
  hint: StudentLessonState['hint'];
  npcId: string;
  offers: LessonOffer[];
  possessedNpcId: string | null;
  bubbles: LessonBubble[];
  banner: LessonBanner | null;
  lastResult: (DialogResult & { utterancesToday: number }) | null;
  /** Ledger balance shown on the HUD (state poll, then each answer). */
  coins: number | null;
  /** Stars earned in this lesson (HUD star chip). */
  lessonStars: number;
  /** The stage NPC's opening line for the dialog window. */
  npcLineEn: string;
  /** Server time this client saw the stage begin (lines before it belong to the last stage). */
  stageStartedAt: number;
  /** The teacher's newest line as the stage NPC in this stage, from the server (older than the bubbles kept). */
  stageLastLineEn: string;
  /** Answers kept on this device while the connection was down, sent after the next good poll. */
  outbox: number;
  /** With the teacher now (console heartbeat) or alone; an older server without the field = with the teacher. */
  teacher: { present: boolean; name: string | null };
  /** The lesson's plan id from the server (1PC teacher panel); null on an older server. */
  planId: string | null;
  /** The joined lesson (1PC teacher panel calls). */
  lessonId: string | null;
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
    goalEn: '',
    mode: 'guided',
    hint: 'full',
    npcId: 'guide',
    offers: [],
    possessedNpcId: null,
    bubbles: [],
    banner: null,
    lastResult: null,
    coins: null,
    lessonStars: 0,
    npcLineEn: '',
    stageStartedAt: 0,
    stageLastLineEn: '',
    outbox: 0,
    teacher: { present: true, name: null },
    planId: null,
    lessonId: null,
    stageSeq: 0
  };
}

/**
 * The English line under the world HUD goal. Only with the full hint: in recall and the other hint levels the cards
 * show the sentence masked, and the goal box must not give the answer away.
 */
export function goalTargetEn(hint: LessonHintLevel, offers: readonly { text: string }[]): string | undefined {
  return hint === 'full' ? offers[0]?.text : undefined;
}

export class LessonController {
  private view: LessonView = initialLessonView();
  private session: StudentSession | null = null;
  private cursor: number | null = null;
  private timer: unknown = null;
  private bannerTimer: unknown = null;
  /** The world got the teacher tag at least once (the first poll always sets it). */
  private teacherShown = false;
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
    // After a refresh the banner counts what this tab kept before the first send.
    this.set({ phase: 'live', nickname: s.nickname, level: s.level, outbox: readOutbox(this.outboxStore(), s.lessonId).length });
    await this.poll();
  }

  async join(code: string): Promise<void> {
    if (!/^\d{6}$/.test(code)) return this.set({ phase: 'needs_code', errorCode: 'invalid_code' });
    this.set({ phase: 'joining', errorCode: null });
    const run = this.run;
    try {
      const r = await this.opts.api.join(code);
      if (run !== this.run) return;
      // Another lesson in the same tab (a new code without "나가기"): nothing of the last one carries over (stars,
      // stage, lines, coins until the first poll).
      if (this.session && this.session.lessonId !== r.lesson_id) {
        this.view = initialLessonView();
        this.seenLines.clear();
        this.seenEvents.clear();
      }
      this.session = { token: r.student_token, lessonId: r.lesson_id, nickname: r.nickname, level: r.level, voiceStore: r.voice_store === true };
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
    const run = this.run;
    // One id per answer, and the stage it answers: a lost response or a resend from the outbox is the same answer.
    const body = {
      ...readUtteranceSubmit(u),
      client_id: newUtteranceClientId(this.timers.now()),
      ...(this.view.stageId ? { stage_id: this.view.stageId } : {})
    };
    let r: Awaited<ReturnType<StudentLessonApi['utterance']>>;
    try {
      r = await this.opts.api.utterance(s.token, body);
    } catch (e) {
      // No connection (or a server hiccup): keep the answer on this device and send it after the next good poll.
      if (e instanceof LessonHttpError && isRetryableStatus(e.status) && run === this.run && this.session === s) {
        this.set({ outbox: pushOutbox(this.outboxStore(), s.lessonId, { body, queuedAt: this.timers.now() }), connection: 'retrying' });
        this.schedulePoll(this.retryMs);
        throw new SubmitError('queued', 'saved_on_device');
      }
      throw e;
    }
    const result: DialogResult = { pass: r.pass, stars: r.stars, feedbackKo: r.feedback_ko, ...(r.feedback_en ? { feedbackEn: r.feedback_en } : {}), coinsTotal: r.coins_total };
    // An answer that lands after "나가기", a new code or stop belongs to a lesson this screen no longer shows: the
    // panel still gets its result, the HUD chips do not move.
    if (run !== this.run || this.session !== s) return result;
    // No celebrate here: whoever shows the result plays it (App's DialogHost, or the layer's own panel), once.
    this.set({ lastResult: { ...result, utterancesToday: r.utterances_today } });
    this.showCoins(r.coins_total);
    // The star chip moves with the answer, not when the child taps "done": the server's sum after this answer, as is.
    if (typeof r.lesson_stars === 'number') this.showStars(r.lesson_stars);
    else if (r.pass && r.stars > 0) this.showStars(this.view.lessonStars + r.stars);
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
        ui: this.opts.ui ?? '3d',
        mic: readLessonMicStatus()
      });
      if (run !== this.run) return;
      this.retryMs = LESSON_POLL_MS;
      this.apply(st);
      if (this.view.connection !== 'ok' || this.view.errorCode) this.set({ connection: 'ok', errorCode: null });
      // Back online: what the child said meanwhile goes now, in order.
      void this.flushOutbox();
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
    this.schedulePoll(this.view.connection === 'ok' ? LESSON_POLL_MS : this.retryMs);
  }

  private schedulePoll(ms: number): void {
    if (this.stopped || !this.session) return;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => this.poll(), ms);
  }

  private flushing: Promise<void> | null = null;

  /** Sends the answers kept offline (lesson outbox) in order; the HUD takes the server's numbers from each. */
  flushOutbox(): Promise<void> {
    // One send at a time: a second call (next poll) waits for the one already going.
    if (!this.flushing) this.flushing = this.sendOutbox().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async sendOutbox(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const store = this.outboxStore();
    if (readOutbox(store, s.lessonId).length === 0) {
      if (this.view.outbox !== 0) this.set({ outbox: 0 });
      return;
    }
    const run = this.run;
    const res = await flushOutbox({
      store,
      lessonId: s.lessonId,
      send: (b) => this.opts.api.utterance(s.token, b as never),
      statusOf: (e) => (e instanceof LessonHttpError ? e.status : null)
    });
    if (run !== this.run || this.session !== s) return;
    for (const r of res.sent) {
      this.showCoins(r.coins_total);
      if (typeof r.lesson_stars === 'number') this.showStars(r.lesson_stars);
    }
    this.set({ outbox: res.left });
  }

  private outboxStore(): OutboxStore {
    return this.opts.store ?? outboxSessionStore();
  }

  private showStars(n: number | undefined): void {
    // Stars only grow in a lesson: a poll answered before the latest answer landed must not take one back.
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= this.view.lessonStars) return;
    this.opts.world?.setStars?.(n);
    this.set({ lessonStars: n });
  }

  private showCoins(n: number | null | undefined): void {
    if (typeof n !== 'number' || !Number.isFinite(n) || n === this.view.coins) return;
    this.opts.world?.setCoins?.(n);
    this.set({ coins: n });
  }

  /** Applies one state response. Exposed for tests and for the cards fallback. */
  apply(st: StudentLessonState): void {
    const w = this.opts.world;
    this.cursor = st.cursor;
    this.showCoins(st.coins_balance);
    this.showStars(st.lesson_stars);
    if (typeof st.npc_line_en === 'string' && st.npc_line_en !== this.view.npcLineEn) this.set({ npcLineEn: st.npc_line_en });
    const lastLine = st.stage_last_line_en ?? '';
    if (lastLine !== this.view.stageLastLineEn) this.set({ stageLastLineEn: lastLine });
    const patch: Partial<LessonView> = {};
    // A → B → A between two polls is a new stage start too (the stage log's time moved), not "nothing changed".
    const stageChanged =
      st.stage_id !== this.view.stageId ||
      (typeof st.stage_started_at === 'number' && this.view.stageStartedAt > 0 && st.stage_started_at > this.view.stageStartedAt);
    const targetsChanged = JSON.stringify(st.offers) !== JSON.stringify(this.view.offers);
    if (stageChanged) {
      patch.stageId = st.stage_id;
      patch.sceneId = st.scene_id;
      patch.stageSeq = this.view.stageSeq + 1;
      // server clock, the same one the NPC lines carry
      patch.stageStartedAt = typeof st.stage_started_at === 'number' ? st.stage_started_at : st.server_now;
      patch.lastResult = null;
      if (w && st.scene_id !== this.view.sceneId) void w.goToScene(st.scene_id).catch(() => undefined);
    }
    const goalEn = st.stage_goal_en ?? '';
    if (stageChanged || targetsChanged || st.stage_goal_ko !== this.view.goalKo || goalEn !== this.view.goalEn) {
      w?.setGoal(lessonGoal(goalEn, st.stage_goal_ko), goalTargetEn(st.hint, st.offers));
    }
    Object.assign(patch, {
      goalKo: st.stage_goal_ko,
      goalEn,
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
        npcNameKo: childNpcName(line.npc_id).nameKo,
        npcNameEn: childNpcName(line.npc_id).nameEn,
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
      // A world that plays director events does its own star burst; celebrate only for one that does not.
      if (ev.kind === 'star_celebration' && !w?.playDirectorEvent) w?.celebrate(3);
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
    if ((st.plan_id ?? null) !== this.view.planId) patch.planId = st.plan_id ?? null;
    if (st.lesson_id !== this.view.lessonId) patch.lessonId = st.lesson_id;
    const teacher = st.teacher ? { present: st.teacher.present, name: st.teacher.name } : { present: true, name: null };
    if (teacher.present !== this.view.teacher.present || teacher.name !== this.view.teacher.name || !this.teacherShown) {
      patch.teacher = teacher;
      this.teacherShown = true;
      w?.setTeacher?.(teacher);
    }
    if (st.ended) {
      patch.phase = 'ended';
      w?.setTeacher?.(null);
    }
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
