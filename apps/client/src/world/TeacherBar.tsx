/**
 * The teacher in the world (Dan 11-16 "평상시 1인칭으로 진행되는 것 아니었나요?"; docs/02 §11; R325 Dan 11-19 "LCW 가
 * 선생님과 함께 진행되지 않는다").
 *
 * The console (/director, "🧭 월드에 들어가기") opens `/world/?teach=<lesson id>` in the same tab. With the console's
 * own sign-in (localStorage `lcw.operatorToken`, an `lcwop_` session or the ops key) this page joins the lesson's
 * multi room as role 'teacher' (operator ticket naming `lesson-<id>`): the child's world draws its one teacher figure
 * where the teacher walks (E / a tap on it opens the child's trade window), and the teacher sees the child.
 *
 * The teacher's panel (left, under the HUD's top stack, folds to one row) runs the lesson from inside the world:
 *  - say a line as the teacher (typed, or 🎤 en-US), shown as the teacher's bubble and the child's side-panel line;
 *  - the stage: while this page beats (source 'world') the stages wait for the teacher (docs/18 §11); the panel says
 *    when the auto rules call the stage done and "다음 단계로" moves it;
 *  - give one of the teacher's things, see the child's trades and newest sentence;
 *  - "같이 걷기" walks after the child, "학생 옆으로" stands next to them, "콘솔로" goes back to /director.
 */
import React, { useEffect, useRef, useState } from 'react';
import { TEACHER_STOCK, tradeAskLine, tradeOffers, getLessonPlan, readWorldSetup, type WorldSetupChoice } from '@lcw/content';
import { COLOR_TOKENS as C, SHAPE_TOKENS as SHAPE, SPACING_TOKENS as SP, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { WorldHandle } from './api.js';

export const OPERATOR_TOKEN_KEY = 'lcw.operatorToken';
export const TEACHER_NAME_KEY = 'lcw.teacherName';
/** Same cadence as the console (apps/web teacherPresence.ts TEACHER_BEAT_MS / TEACHER_RETRY_MS). */
export const TEACH_BEAT_MS = 15_000;
export const TEACH_RETRY_MS = 5_000;
/** How often the panel reads the lesson feed (stage, child's sentence, trades). */
export const TEACH_FEED_MS = 2_500;

export interface TeachSession {
  lessonId: string;
  token: string;
  /** The name alone ("김민지"), or null: the child's plate then says "선생님". */
  name: string | null;
}

interface Store {
  getItem(k: string): string | null;
}

/**
 * `?teach=<lesson id>` (or `?teach=new` to start one) plus a console sign-in on this browser, else null (a child's
 * page never becomes a teacher's). R331: the in-world panel starts lessons too, so the console is only a handoff.
 */
export function teachFrom(search: string, store: Store | null): TeachSession | null {
  const id = new URLSearchParams(search).get('teach') ?? '';
  if (id !== 'new' && !/^les-[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  let token: string | null = null;
  let name: string | null = null;
  try {
    token = store?.getItem(OPERATOR_TOKEN_KEY) ?? null;
    name = store?.getItem(TEACHER_NAME_KEY) ?? null;
  } catch {
    return null;
  }
  if (!token || token.length < 16) return null;
  const clean = (name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return { lessonId: id, token, name: clean || null };
}

/**
 * R331: a teacher address (`?teach=new` / `?teach=les-…`) on a browser with no console sign-in goes to the sign-in door
 * (`/director`, which hands back to the world once signed in) instead of quietly opening the world as a plain player.
 */
export function teachSignInRedirect(search: string, store: Store | null): string | null {
  const id = new URLSearchParams(search).get('teach') ?? '';
  if (id !== 'new' && !/^les-[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  return teachFrom(search, store) ? null : '/director';
}

/**
 * What the teacher's room ticket asks for: the lesson's room, under the teacher's name. Start mode ('new') names no
 * room: the teacher sits alone until the lesson starts and the page moves to its room.
 */
export function teachTicketBody(s: TeachSession): { room: string; name: string } | null {
  if (s.lessonId === 'new') return null;
  return { room: `lesson-${s.lessonId}`, name: s.name ?? '선생님' };
}

/** The teacher's screen copy (Korean: the teacher's own language; the English lines are the child's). */
export const TS = {
  title: '🧑‍🏫 선생님 · 월드에서 수업 중',
  students: (n: number) => (n > 0 ? `학생 ${n}명이 같은 곳에 있어요` : '학생이 아직 월드에 없어요'),
  fold: '접기',
  unfold: '선생님 패널',
  goNear: '학생 옆으로',
  follow: '같이 걷기',
  /** R326 play fighting switch for the room (the label says what a press does) */
  pvpOff: '때리기 끄기',
  pvpOn: '때리기 켜기',
  following: '같이 걷는 중 · 멈추기',
  console: '콘솔로',
  say: '말하기',
  sayPlaceholder: '학생에게 영어로 한마디',
  sayMic: '🎤',
  sayQuick: '바로 쓰는 말',
  stage: (n: number, total: number, title: string) => `단계 ${n}/${total} · ${title}`,
  // R2861①: the teacher in the world holds only the planned minutes; the child's own talk still moves the stage
  held: '선생님과 함께 — 시간으로는 안 넘어가요, 학생이 말하면 넘어가요',
  ready: (why: string) =>
    `이 단계 끝 — ${why === 'passes' ? '문장 다 함' : why === 'followups' ? '질문 다 함' : why === 'free' ? '자기 말로 함' : why === 'tries' ? '여러 번 말함' : '시간 다 됨'}`,
  next: '다음 단계로 ▶',
  last: '마지막 단계예요',
  give: '물건 주기',
  given: (label: string) => `${label} 줬어요`,
  askTitle: '🤝 교환 제안 (영어 문장으로 받기)',
  askItem: '줄 물건',
  askSentence: '이 문장으로 말하면 줌 (별은 학생이 실제로 말한 만큼)',
  askStars: (n: number) => '⭐'.repeat(n),
  askSend: '제안하기',
  askDone: '교환을 제안했어요. 학생이 다가와 E 를 누르고 문장으로 말하면 성립돼요',
  askNeedSentence: '문장을 먼저 골라 주세요',
  trades: '주고받기',
  noTrades: '아직 주고받은 것이 없어요',
  childSaid: '학생의 마지막 말',
  failed: '보내지 못했어요. 다시 눌러 주세요',
  ended: '수업이 끝났어요',
  endLesson: '수업 끝',
  endConfirm: '정말 끝내기 (리포트 만들기)',
  endComment: '오늘 한마디 (리포트에 들어감)',
  endNext: '다음 수업 날짜',
  reportReady: '리포트 준비됨',
  openReport: '리포트 열기',
  targetTitle: '🎯 목표 문장 띄우기',
  targetPlaceholder: '학생 화면에 띄울 영어 문장',
  targetSend: '띄우기',
  targetDone: '목표 문장을 띄웠어요',
  targetMoved: '그 사이 단계가 넘어갔어요. 문장은 그대로 둡니다',
  pinTitle: '📌 핀',
  pinCoaching: 'F1 코칭',
  pinExpression: 'F2 새 표현',
  pinPlaceholder: '메모 (영어 권장)',
  pinDone: '핀을 남겼어요',
  feedTitle: '학생 발화',
  feedEmpty: '아직 한 말이 없어요',
  startTitle: '🧑‍🏫 수업 시작하기',
  joinCode: (code: string) => `학생 참가 숫자 ${code} · 학생은 첫 화면 '수업 참가'에 적어요 (영어의 날 표에서 들어오면 숫자 없이 바로)`,
  startPick: '학생 고르기',
  start: '수업 시작',
  startStarting: '여는 중…',
  startDone: '수업이 열렸어요. 들어갑니다…',
  startEmpty: '등록된 학생이 없어요. 콘솔에서 먼저 등록해 주세요',
  signIn: '콘솔 로그인이 끝났어요. 콘솔에서 다시 들어와 주세요',
  replaced: '다른 탭에서 이 수업 월드를 열었어요. 학생은 그 탭의 선생님을 봐요',
  takeOver: '여기서 다시 들어가기'
} as const;

/** The room connection as the bar sees it (room-client.ts RoomClient). */
export interface TeachRoom {
  readonly status: string;
  takeOver(): void;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What the panel reads from GET /v1/admin/lessons/:id/feed (the console's own feed). */
export interface TeachFeed {
  lesson: { stage_id: string | null; plan_id?: string; ended_at: number | null; targets?: string[]; join_code?: string | null };
  stage_hold?: { held: boolean; ready: string | null; next_stage_id: string | null };
  student_view?: { last_utterance: { transcript: string; target_text: string; pass: boolean } | null };
  utterances?: Array<{ id: string; transcript: string; stars: number; pass: boolean; at: number }>;
  pins?: Array<{ id: string; kind: string; note: string }>;
  trades?: Array<{ client_id: string; kind: string; get_key: string | null; give_key: string | null; transcript: string; ok: boolean; stars?: number; reason?: string | null }>;
  world_look?: unknown;
}

/** One row of GET /v1/admin/students for the in-world start mode. */
export interface TeachStudent {
  player_id: string;
  nickname: string;
  level?: string;
}

export interface TeacherBarProps {
  world: WorldHandle;
  session: TeachSession;
  fetchImpl?: FetchLike;
  /** The multi room connection: another tab of this teacher taking the seat shows here with a way back. */
  room?: TeachRoom | null;
  /** Test seam: where "콘솔로" goes. */
  goConsole?: () => void;
  /** The child's world look from the feed (season, sky, animal friend): the teacher walks in the child's own world. */
  onLook?: (look: WorldSetupChoice | null) => void;
}

/** One id per teacher action (the server keeps one gift per id: a double tap gives one thing). */
function actionId(now: number): string {
  return `c${now}-${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
}

interface Recognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
function recognizerCtor(): (new () => Recognizer) | null {
  const g = globalThis as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export function TeacherBar({ world, session, room, fetchImpl, goConsole, onLook }: TeacherBarProps): React.ReactElement {
  const [peers, setPeers] = useState(0);
  const [state, setState] = useState<'live' | 'ended' | 'signin'>('live');
  const [replaced, setReplaced] = useState(room?.status === 'replaced');
  const [folded, setFolded] = useState(() => typeof innerHeight === 'number' && innerHeight <= 500);
  const [feed, setFeed] = useState<TeachFeed | null>(null);
  const [line, setLine] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [pvp, setPvp] = useState(() => world.roomPvp?.() ?? true);
  // the button shows what the room says (hello, a reconnect, the switch's own echo), not what was last pressed
  useEffect(() => world.onRoomPvp?.(setPvp), [world]);
  const [listening, setListening] = useState(false);
  const autoWent = useRef(false);
  const lookKey = useRef('');
  const onLookRef = useRef(onLook);
  onLookRef.current = onLook;
  const f: FetchLike = fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
  const fRef = useRef(f);
  fRef.current = f;
  const base = `/v1/admin/lessons/${encodeURIComponent(session.lessonId)}`;
  const headers = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' };
  const post = async (path: string, body: unknown): Promise<boolean> => {
    try {
      const r = await fRef.current(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      setMsg(r.ok ? null : TS.failed);
      return r.ok;
    } catch {
      setMsg(TS.failed);
      return false;
    }
  };

  const startMode = session.lessonId === 'new';
  // Start mode names no lesson: no heartbeat and no feed until the lesson opens (then the page moves to its room).
  // Presence beat while the teacher is in the world (the console's tab is this one now): source 'world' = the teacher
  // walks with the child, so the stages wait for the teacher (docs/18 §11).
  // Only a tab the teacher looks at, and not one replaced by another tab, holds the stages (review R326: a forgotten
  // background tab held them for good); otherwise the beat is a plain console beat and the auto rules run.
  const replacedRef = useRef(replaced);
  replacedRef.current = replaced;
  // Once the lesson is over (the panel's own end, or the feed saw it) the beat stops: a beat on an ended lesson only
  // earns a 409 the browser prints as a console error (R331 live run, after 'end').
  const lessonOver = state === 'ended';
  useEffect(() => {
    if (startMode || lessonOver) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beat = async (): Promise<void> => {
      if (stop) return;
      let next = TEACH_BEAT_MS;
      const looking = (typeof document === 'undefined' || document.visibilityState !== 'hidden') && !replacedRef.current;
      try {
        const r = await fRef.current(`/v1/admin/lessons/${encodeURIComponent(session.lessonId)}/presence`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ panel: 'open', source: looking ? 'world' : 'console', ...(session.name ? { name: session.name } : {}) })
        });
        if (r.status === 409 || r.status === 404) {
          setState('ended');
          return;
        }
        if (r.status === 401) {
          setState('signin');
          return;
        }
        if (!r.ok) next = TEACH_RETRY_MS;
      } catch {
        next = TEACH_RETRY_MS;
      }
      if (!stop) timer = setTimeout(() => void beat(), next);
    };
    void beat();
    return () => {
      stop = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [session.lessonId, session.token, session.name, startMode, lessonOver]);

  // The lesson feed: stage and its hold, the child's newest sentence, trades, the child's world look.
  useEffect(() => {
    if (startMode) return;
    let stop = false;
    const read = async () => {
      try {
        const r = await fRef.current(`/v1/admin/lessons/${encodeURIComponent(session.lessonId)}/feed`, { headers: { authorization: `Bearer ${session.token}` } });
        if (!r.ok || stop) return;
        const j = (await r.json()) as TeachFeed;
        if (stop) return;
        setFeed(j);
        if (j.lesson.ended_at) setState('ended');
        const look = j.world_look ? readWorldSetup(j.world_look) : null;
        const key = JSON.stringify(look);
        if (key !== lookKey.current) {
          lookKey.current = key;
          onLookRef.current?.(look);
        }
      } catch {
        /* the next read tries again */
      }
    };
    void read();
    const t = setInterval(() => void read(), TEACH_FEED_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session.lessonId, session.token, startMode]);

  // How many people share the room; on the first child seen, stand next to them once.
  useEffect(() => {
    const id = setInterval(() => {
      const n = world.getStats?.().peers ?? 0;
      setPeers(n);
      setReplaced(room?.status === 'replaced');
      if (n > 0 && !autoWent.current) {
        autoWent.current = true;
        void world.goNearPeer?.('student');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [world, room]);
  useEffect(() => () => world.followPeer?.(null), [world]);

  const say = async (text: string) => {
    const t = text.trim().slice(0, 280);
    if (!t) return;
    if (await post('/npc-say', { npc_id: 'teacher', text: t })) {
      setLine('');
      // the teacher's own bubble on this page too (the child's world shows it over the teacher figure)
      world.playerSay?.(t);
    }
  };
  const mic = () => {
    const R = recognizerCtor();
    if (!R || listening) return;
    const r = new R();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const heard = e.results[0]?.[0]?.transcript ?? '';
      if (heard) setLine(heard);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };

  // R331: the in-world panel runs the lesson (the console is only a handoff): own target sentence, F1/F2 pins, end.
  const [target, setTarget] = useState('');
  const [pinNote, setPinNote] = useState('');
  const [endArmed, setEndArmed] = useState(false);
  const [comment, setComment] = useState('');
  const [nextAt, setNextAt] = useState('');
  const [reportPath, setReportPath] = useState<string | null>(null);
  // R331 교환 제안: 큰 주머니의 물건 + 그 물건의 교환 문장(서버가 채점하는 tradeOffers 와 같은 문장 — 물건 이름만 ⭐1,
  // 더 갖추면 ⭐2·⭐3). 자유 문장은 서버 채점과 어긋나 받지 않는다.
  const [askKey, setAskKey] = useState(TEACHER_STOCK[0]?.key ?? '');
  const askOffers = tradeOffers({ getKey: askKey });
  const [askStar, setAskStar] = useState(2);
  const askSentence = askOffers.find((o) => o.stars === askStar)?.text ?? askOffers[0]?.text ?? '';
  const postRaw = async (path: string, body: unknown): Promise<Response | null> => {
    try {
      return await fRef.current(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      setMsg(TS.failed);
      return null;
    }
  };
  const pushTarget = async (text: string) => {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    if (!stage) {
      setMsg(TS.failed);
      return;
    }
    const r = await postRaw('/stage', { stage_id: stage.id, targets: [t], only_if_stage: true });
    if (!r) return;
    if (r.status === 409) {
      setMsg(TS.targetMoved);
      return;
    }
    if (r.ok) {
      setTarget('');
      setMsg(TS.targetDone);
    } else setMsg(TS.failed);
  };
  const addPin = async (kind: 'coaching' | 'expression') => {
    const r = await postRaw('/pins', { kind, at_ms: Date.now(), note: pinNote.trim().slice(0, 300) });
    if (!r) return;
    if (r.ok) {
      setPinNote('');
      setMsg(TS.pinDone);
    } else setMsg(TS.failed);
  };
  // F1 = coaching pin, F2 = expression pin (the console's shortcuts, now in the world).
  useEffect(() => {
    if (startMode || state !== 'live') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' && e.key !== 'F2') return;
      e.preventDefault();
      void addPin(e.key === 'F1' ? 'coaching' : 'expression');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  /**
   * R331 교환 제안: 선생님 말풍선으로 "이렇게 말하면 <물건>" 알림. 수업 목표 문장(/stage)은 건드리지 않는다 — 교환은
   * 학생이 선생님 곁에서 E 로 여는 교환 창에서 같은 tradeOffers 문장으로 채점되고, 물건은 학생이 말해야 넘어간다.
   */
  const proposeTrade = async () => {
    const item = TEACHER_STOCK.find((it) => it.key === askKey);
    if (!item || !askSentence) {
      setMsg(TS.askNeedSentence);
      return;
    }
    const said = tradeAskLine(askSentence, item.label);
    if (await post('/npc-say', { npc_id: 'teacher', text: said.slice(0, 280) })) {
      world.playerSay?.(said);
      setMsg(TS.askDone);
    }
  };

  const endLesson = async () => {
    if (!endArmed) {
      setEndArmed(true);
      return;
    }
    const r = await postRaw('/end', {
      teacher_comment: comment.trim().slice(0, 400),
      next_lesson_at: nextAt.trim().slice(0, 60)
    });
    if (!r) return;
    if (r.ok) {
      const j = (await r.json().catch(() => null)) as { report_path?: string } | null;
      setReportPath(j?.report_path ?? null);
      setMsg(null);
      setState('ended');
    } else setMsg(TS.failed);
  };

  const back = goConsole ?? (() => location.assign('/director'));
  const btn: React.CSSProperties = {
    pointerEvents: 'auto',
    border: `2px solid ${C['ink-900']}`,
    borderRadius: SHAPE.radiusCardPx,
    background: C['paper-50'],
    color: C['ink-900'],
    font: 'inherit',
    fontWeight: 700,
    padding: `${SP[0]}px ${SP[2]}px`,
    minHeight: SP[5] + SP[1],
    cursor: 'pointer'
  };
  const head =
    state === 'ended' ? TS.ended : state === 'signin' ? TS.signIn : replaced ? TS.replaced : `${TS.title} · ${TS.students(peers)}`;
  const plan = getLessonPlan(feed?.lesson.plan_id);
  const idx = plan.stages.findIndex((s) => s.id === feed?.lesson.stage_id);
  const stage = idx >= 0 ? plan.stages[idx]! : null;
  const nextStage = idx >= 0 ? (plan.stages[idx + 1] ?? null) : null;
  const hold = feed?.stage_hold;
  const quick = stage ? [stage.teacherScriptEn, ...(stage.followUpsEn ?? [])].filter(Boolean).slice(0, 4) : [];
  const last = feed?.student_view?.last_utterance ?? null;
  const box: React.CSSProperties = {
    position: 'absolute',
    // left, under the HUD's top stack (scene chip, goal card): the middle of the view stays the world's
    top: 'calc(var(--lcw-hud-top-b, 120px) + 8px)',
    left: SP[2],
    zIndex: 46,
    pointerEvents: 'auto',
    background: C['night-900'],
    color: C['paper-0'],
    border: `2px solid ${C['ink-900']}`,
    borderRadius: SHAPE.radiusCardPx,
    fontFamily: T.fonts.ui,
    fontSize: T.scale.small.sizePx
  };
  // R331 start mode (?teach=new): pick a student, open the lesson, walk into its room. No heartbeat yet.
  if (startMode) {
    return (
      <div className="lcw-teachbar" role="status" data-hud-part="" style={{ ...box, width: 'min(320px, 44vw)', padding: SP[2], display: 'grid', gap: SP[1] }}>
        <strong>{TS.startTitle}</strong>
        <TeachStart token={session.token} fetchImpl={f} prefer={typeof location === 'undefined' ? null : teachPrepFrom(location.search)} />
        <button type="button" style={btn} onClick={back}>
          {TS.console}
        </button>
        {msg ? <div role="alert" style={{ fontSize: T.scale.micro.sizePx }}>{msg}</div> : null}
      </div>
    );
  }
  if (folded) {
    return (
      <div className="lcw-teachbar" role="status" data-hud-part="" data-folded="1" style={{ ...box, display: 'flex', gap: SP[1], alignItems: 'center', padding: SP[1] }}>
        <button type="button" data-testid="teach-unfold" style={btn} onClick={() => setFolded(false)}>
          {TS.unfold} · {peers}
        </button>
        {state === 'live' && !replaced ? (
          <button type="button" style={btn} disabled={peers === 0} onClick={() => void world.goNearPeer?.('student')}>
            {TS.goNear}
          </button>
        ) : null}
        <button type="button" style={btn} onClick={back}>
          {TS.console}
        </button>
      </div>
    );
  }
  return (
    <div
      className="lcw-teachbar"
      role="status"
      data-hud-part=""
      style={{ ...box, width: 'min(320px, 44vw)', maxHeight: 'calc(100vh - var(--lcw-hud-top-b, 120px) - var(--lcw-hud-stack, 80px) - 20px)', overflowY: 'auto', padding: SP[2], display: 'flex', flexDirection: 'column', gap: SP[1] }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: SP[1], alignItems: 'flex-start' }}>
        <span style={{ fontWeight: 700 }}>{head}</span>
        <button type="button" data-testid="teach-fold" style={{ ...btn, minHeight: SP[5], whiteSpace: 'nowrap' }} onClick={() => setFolded(true)}>
          {TS.fold}
        </button>
      </div>
      {state === 'ended' && reportPath ? (
        // R331: the report stays one tap away in the world after the end (the end form folds away with the live state)
        <div data-testid="teach-report" style={{ background: C['paper-50'], color: C['ink-900'], borderRadius: SHAPE.radiusCardPx, padding: SP[1] }}>
          {TS.reportReady} · <a href={reportPath} style={{ fontWeight: 700 }}>{TS.openReport}</a>
        </div>
      ) : null}
      {state === 'live' && replaced ? (
        <button
          type="button"
          style={btn}
          onClick={() => {
            room?.takeOver();
            setReplaced(false);
          }}
        >
          {TS.takeOver}
        </button>
      ) : null}
      {state === 'live' && !replaced ? (
        <div style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap' }}>
          <button type="button" style={btn} disabled={peers === 0} onClick={() => void world.goNearPeer?.('student')}>
            {TS.goNear}
          </button>
          <button
            type="button"
            data-testid="teach-follow"
            aria-pressed={following}
            style={{ ...btn, background: following ? C.sun : C['paper-50'] }}
            onClick={() => {
              const on = !following;
              setFollowing(on);
              world.followPeer?.(on ? 'student' : null);
            }}
          >
            {following ? TS.following : TS.follow}
          </button>
          {world.setRoomPvp ? (
            <button
              type="button"
              data-testid="teach-pvp"
              aria-pressed={!pvp}
              style={btn}
              onClick={() => {
                if (!world.setRoomPvp?.(!pvp)) setMsg(TS.failed);
              }}
            >
              {pvp ? TS.pvpOff : TS.pvpOn}
            </button>
          ) : null}
          <button type="button" style={btn} onClick={back}>
            {TS.console}
          </button>
        </div>
      ) : (
        <button type="button" style={btn} onClick={back}>
          {TS.console}
        </button>
      )}
      {state === 'live' && feed?.lesson.join_code ? (
        <div data-testid="teach-join-code" style={{ background: C.sun, color: C['ink-900'], borderRadius: SHAPE.radiusCardPx, padding: SP[1], fontSize: T.scale.small.sizePx, fontWeight: 700 }}>
          {TS.joinCode(feed.lesson.join_code)}
        </div>
      ) : null}
      {state === 'live' && stage ? (
        <section data-testid="teach-stage" style={{ background: C['paper-0'], color: C['ink-900'], borderRadius: SHAPE.radiusCardPx, padding: SP[1], display: 'grid', gap: SP[1] }}>
          <strong>{TS.stage(idx + 1, plan.stages.length, stage.titleKo)}</strong>
          {hold?.held ? <span style={{ fontSize: T.scale.micro.sizePx }}>{TS.held}</span> : null}
          {hold?.ready ? (
            <span data-testid="teach-ready" style={{ background: C.sun, borderRadius: SHAPE.radiusButtonPx, padding: `0 ${SP[1]}px`, fontWeight: 700 }}>
              {TS.ready(hold.ready)}
            </span>
          ) : null}
          {nextStage ? (
            <button
              type="button"
              data-testid="teach-next"
              style={{ ...btn, background: hold?.ready ? C['leaf-d'] : C['paper-50'], color: hold?.ready ? C['paper-0'] : C['ink-900'] }}
              onClick={() => void post('/stage', { stage_id: nextStage.id, targets: nextStage.targets.map((t) => t.text) })}
            >
              {TS.next} {nextStage.titleKo}
            </button>
          ) : (
            <span style={{ fontSize: T.scale.micro.sizePx }}>{TS.last}</span>
          )}
        </section>
      ) : null}
      {state === 'live' ? (
        <section data-testid="teach-say" style={{ display: 'grid', gap: SP[1] }}>
          <form
            style={{ display: 'flex', gap: SP[1] }}
            onSubmit={(e) => {
              e.preventDefault();
              void say(line);
            }}
          >
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder={TS.sayPlaceholder}
              aria-label={TS.sayPlaceholder}
              maxLength={280}
              style={{ ...btn, flex: '1 1 auto', minWidth: 0, fontWeight: 400, cursor: 'text' }}
            />
            {recognizerCtor() ? (
              <button type="button" aria-label={TS.sayMic} style={{ ...btn, background: listening ? C.sun : C['paper-50'] }} onClick={mic}>
                {TS.sayMic}
              </button>
            ) : null}
            <button type="submit" data-testid="teach-say-send" style={{ ...btn, background: C['brand-d'], color: C['paper-0'] }}>
              {TS.say}
            </button>
          </form>
          {quick.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[0] }} aria-label={TS.sayQuick}>
              {quick.map((q) => (
                <button key={q} type="button" style={{ ...btn, minHeight: SP[5], fontWeight: 400, fontSize: T.scale.micro.sizePx, textAlign: 'left' }} onClick={() => void say(q)}>
                  {q}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {state === 'live' && last ? (
        <div data-testid="teach-child-said" style={{ fontSize: T.scale.small.sizePx }}>
          <span style={{ opacity: 0.8 }}>{TS.childSaid} </span>
          {last.pass ? '✅' : '🔁'} “{last.transcript}”
        </div>
      ) : null}
      {state === 'live' && (feed?.utterances?.length || last) ? (
        <section data-testid="teach-feed" style={{ display: 'grid', gap: SP[0], fontSize: T.scale.small.sizePx }}>
          <strong>{TS.feedTitle} ({feed?.utterances?.length ?? (last ? 1 : 0)})</strong>
          <ul style={{ margin: 0, paddingLeft: SP[3], display: 'grid', gap: SP[0] }}>
            {(feed?.utterances ?? []).slice(-5).map((u) => (
              <li key={u.id}>
                {u.pass ? '✅' : '🔁'} “{u.transcript}”{u.stars > 0 ? ` ⭐${u.stars}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {state === 'live' ? (
        <section data-testid="teach-target" style={{ display: 'grid', gap: SP[1] }}>
          <form
            style={{ display: 'flex', gap: SP[1] }}
            onSubmit={(e) => {
              e.preventDefault();
              void pushTarget(target);
            }}
          >
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={TS.targetPlaceholder}
              aria-label={TS.targetPlaceholder}
              maxLength={200}
              style={{ ...btn, flex: '1 1 auto', minWidth: 0, fontWeight: 400, cursor: 'text' }}
            />
            <button type="submit" data-testid="teach-target-send" style={btn} disabled={!target.trim()}>
              {TS.targetSend}
            </button>
          </form>
          {(feed?.lesson.targets?.length ?? 0) > 0 ? (
            <div style={{ fontSize: T.scale.micro.sizePx, opacity: 0.85 }}>{TS.targetTitle}: {(feed?.lesson.targets ?? []).join(' · ')}</div>
          ) : null}
        </section>
      ) : null}
      {state === 'live' ? (
        <section data-testid="teach-pins" style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: T.scale.micro.sizePx }}>{TS.pinTitle}{feed?.pins?.length ? ` (${feed.pins.length})` : ''}</strong>
          <input
            value={pinNote}
            onChange={(e) => setPinNote(e.target.value)}
            placeholder={TS.pinPlaceholder}
            aria-label={TS.pinPlaceholder}
            maxLength={300}
            style={{ ...btn, flex: '1 1 120px', minWidth: 0, fontWeight: 400, cursor: 'text', minHeight: SP[5] }}
          />
          <button type="button" data-testid="teach-pin-coaching" style={{ ...btn, minHeight: SP[5] }} onClick={() => void addPin('coaching')}>
            {TS.pinCoaching}
          </button>
          <button type="button" data-testid="teach-pin-expression" style={{ ...btn, minHeight: SP[5] }} onClick={() => void addPin('expression')}>
            {TS.pinExpression}
          </button>
        </section>
      ) : null}
      {state === 'live' ? (
        <details data-testid="teach-end">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{TS.endLesson}</summary>
          <div style={{ display: 'grid', gap: SP[1], marginTop: SP[1] }}>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={TS.endComment}
              aria-label={TS.endComment}
              maxLength={400}
              style={{ ...btn, fontWeight: 400, cursor: 'text', minHeight: SP[5] }}
            />
            <input
              value={nextAt}
              onChange={(e) => setNextAt(e.target.value)}
              placeholder={TS.endNext}
              aria-label={TS.endNext}
              maxLength={60}
              style={{ ...btn, fontWeight: 400, cursor: 'text', minHeight: SP[5] }}
            />
            <div style={{ display: 'flex', gap: SP[1] }}>
              <button type="button" data-testid="teach-end-go" style={{ ...btn, background: endArmed ? C['brand-d'] : C['paper-50'], color: endArmed ? C['paper-0'] : C['ink-900'] }} onClick={() => void endLesson()}>
                {endArmed ? TS.endConfirm : TS.endLesson}
              </button>
              {endArmed ? (
                <button type="button" style={{ ...btn, minHeight: SP[5] }} onClick={() => setEndArmed(false)}>
                  ✕
                </button>
              ) : null}
            </div>
            {reportPath ? (
              <div style={{ fontSize: T.scale.small.sizePx }}>
                {TS.reportReady} · <a href={reportPath} style={{ fontWeight: 700 }}>{TS.openReport}</a>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      {state === 'live' ? (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            {TS.give} · {TS.trades} {feed?.trades?.length ? `(${feed.trades.length})` : ''}
          </summary>
          <form
            data-testid="teach-ask"
            style={{ display: 'grid', gap: SP[1], marginTop: SP[1], background: C['paper-0'], color: C['ink-900'], borderRadius: SHAPE.radiusCardPx, padding: SP[1] }}
            onSubmit={(e) => {
              e.preventDefault();
              void proposeTrade();
            }}
          >
            <strong style={{ fontSize: T.scale.micro.sizePx }}>{TS.askTitle}</strong>
            <label style={{ display: 'grid', gap: SP[0], fontSize: T.scale.micro.sizePx }}>
              {TS.askItem}
              <select value={askKey} onChange={(e) => setAskKey(e.target.value)} style={{ ...btn, minHeight: SP[5], cursor: 'pointer', fontWeight: 400 }}>
                {TEACHER_STOCK.map((it) => (
                  <option key={it.key} value={it.key}>
                    {it.emoji} {it.label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: SP[1] }}>
              <select
                data-testid="teach-ask-sentence"
                value={askStar}
                onChange={(e) => setAskStar(Number(e.target.value))}
                aria-label={TS.askSentence}
                lang="en"
                style={{ ...btn, flex: '1 1 auto', minWidth: 0, fontWeight: 400, cursor: 'pointer', minHeight: SP[5] }}
              >
                {askOffers.map((o) => (
                  <option key={o.stars} value={o.stars}>
                    {TS.askStars(o.stars)} {o.text}
                  </option>
                ))}
              </select>
              <button type="submit" data-testid="teach-ask-send" style={btn} disabled={!askSentence}>
                {TS.askSend}
              </button>
            </div>
          </form>
          <div data-testid="teach-give" style={{ display: 'flex', flexWrap: 'wrap', gap: SP[0], marginTop: SP[1] }}>
            {TEACHER_STOCK.map((it) => (
              <button
                key={it.key}
                type="button"
                title={it.nameKo}
                style={{ ...btn, minHeight: SP[5], padding: `0 ${SP[1]}px` }}
                onClick={() =>
                  void post('/give', { item_key: it.key, client_id: actionId(Date.now()) }).then((ok) => {
                    if (ok) setMsg(TS.given(it.nameKo));
                  })
                }
              >
                {it.emoji} {it.label}
              </button>
            ))}
          </div>
          <ul data-testid="teach-trades" style={{ margin: `${SP[1]}px 0 0`, paddingLeft: SP[3], fontSize: T.scale.micro.sizePx }}>
            {(feed?.trades ?? []).length === 0 ? <li>{TS.noTrades}</li> : null}
            {(feed?.trades ?? []).slice(0, 6).map((t) => (
              <li key={t.client_id}>
                {t.kind === 'gift' ? '🎁' : t.ok ? '🤝' : '🔁'} {t.give_key ? `${t.give_key} → ` : ''}
                {t.get_key ?? ''} {typeof t.stars === 'number' && t.stars > 0 ? `⭐${t.stars} ` : ''}
                {t.transcript ? `“${t.transcript}”` : ''}{!t.ok && t.kind !== 'gift' && t.reason ? ` (${t.reason})` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {msg ? <div role="alert" style={{ fontSize: T.scale.micro.sizePx }}>{msg}</div> : null}
    </div>
  );
}

/**
 * R331 start mode (?teach=new): the teacher picks a student and opens the lesson from inside the world. On success the
 * page walks into the lesson room (`?teach=<id>`), where the panel above takes over.
 */
/** `?prep=<student id>` (the hub's '다음 수업 준비' card through /director): that student is picked first. */
export function teachPrepFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('prep') ?? '';
  return /^[\w-]{1,80}$/.test(id) ? id : null;
}

/** The start list's first pick: the prepared student when listed, else the first. */
export function teachStartPick(students: TeachStudent[], prefer: string | null): string {
  if (prefer && students.some((s) => s.player_id === prefer)) return prefer;
  return students[0]?.player_id ?? '';
}

export function TeachStart({ token, fetchImpl, prefer = null }: { token: string; fetchImpl: FetchLike; prefer?: string | null }): React.ReactElement {
  const [students, setStudents] = useState<TeachStudent[] | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let stop = false;
    void fetchImpl('/v1/admin/students', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!stop && Array.isArray(j)) {
          setStudents(j as TeachStudent[]);
          setPicked((p) => p || teachStartPick(j as TeachStudent[], prefer));
        }
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [token, fetchImpl, prefer]);
  const start = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetchImpl('/v1/admin/lessons/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ player_id: picked, presence: true })
      });
      if (!r.ok) {
        setFailed(true);
        return;
      }
      const j = (await r.json()) as { lesson_id?: string };
      if (!j.lesson_id) {
        setFailed(true);
        return;
      }
      setDone(true);
      location.assign(`/world/?teach=${encodeURIComponent(j.lesson_id)}`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const btn: React.CSSProperties = {
    pointerEvents: 'auto',
    border: `2px solid ${C['ink-900']}`,
    borderRadius: SHAPE.radiusCardPx,
    background: C['paper-50'],
    color: C['ink-900'],
    font: 'inherit',
    fontWeight: 700,
    padding: `${SP[0]}px ${SP[2]}px`,
    minHeight: SP[5] + SP[1],
    cursor: 'pointer'
  };
  if (students === null) return <span style={{ fontSize: T.scale.small.sizePx }}>…</span>;
  if (students.length === 0) return <span style={{ fontSize: T.scale.small.sizePx }}>{TS.startEmpty}</span>;
  return (
    <form
      data-testid="teach-start"
      style={{ display: 'grid', gap: SP[1] }}
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <label style={{ display: 'grid', gap: SP[0], fontSize: T.scale.small.sizePx }}>
        {TS.startPick}
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{ ...btn, cursor: 'pointer', fontWeight: 400 }}
        >
          {students.map((s) => (
            <option key={s.player_id} value={s.player_id}>
              {s.nickname}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" data-testid="teach-start-go" style={{ ...btn, background: C['leaf-d'], color: C['paper-0'] }} disabled={busy || !picked}>
        {done ? TS.startDone : busy ? TS.startStarting : TS.start}
      </button>
      {failed ? <div role="alert" style={{ fontSize: T.scale.micro.sizePx }}>{TS.failed}</div> : null}
    </form>
  );
}
