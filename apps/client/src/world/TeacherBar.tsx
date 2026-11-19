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
import { TEACHER_STOCK, getLessonPlan, readWorldSetup, type WorldSetupChoice } from '@lcw/content';
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

/** `?teach=<lesson id>` plus a console sign-in on this browser, else null (a child's page never becomes a teacher's). */
export function teachFrom(search: string, store: Store | null): TeachSession | null {
  const id = new URLSearchParams(search).get('teach') ?? '';
  if (!/^les-[A-Za-z0-9-]{1,64}$/.test(id)) return null;
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

/** What the teacher's room ticket asks for: the lesson's room, under the teacher's name. */
export function teachTicketBody(s: TeachSession): { room: string; name: string } {
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
  following: '같이 걷는 중 · 멈추기',
  console: '콘솔로',
  say: '말하기',
  sayPlaceholder: '학생에게 영어로 한마디',
  sayMic: '🎤',
  sayQuick: '바로 쓰는 말',
  stage: (n: number, total: number, title: string) => `단계 ${n}/${total} · ${title}`,
  held: '선생님이 단계를 쥐고 있어요 (자동 넘김 멈춤)',
  ready: (why: string) => `이 단계 끝 — ${why === 'passes' ? '문장 다 함' : why === 'followups' ? '질문 다 함' : '시간 다 됨'}`,
  next: '다음 단계로 ▶',
  last: '마지막 단계예요',
  give: '물건 주기',
  given: (label: string) => `${label} 줬어요`,
  trades: '주고받기',
  noTrades: '아직 주고받은 것이 없어요',
  childSaid: '학생의 마지막 말',
  failed: '보내지 못했어요. 다시 눌러 주세요',
  ended: '수업이 끝났어요. 콘솔로 돌아가세요',
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
  lesson: { stage_id: string | null; plan_id?: string; ended_at: number | null };
  stage_hold?: { held: boolean; ready: string | null; next_stage_id: string | null };
  student_view?: { last_utterance: { transcript: string; target_text: string; pass: boolean } | null };
  trades?: Array<{ client_id: string; kind: string; get_key: string | null; give_key: string | null; transcript: string; ok: boolean }>;
  world_look?: unknown;
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

  // Presence beat while the teacher is in the world (the console's tab is this one now): source 'world' = the teacher
  // walks with the child, so the stages wait for the teacher (docs/18 §11).
  // Only a tab the teacher looks at, and not one replaced by another tab, holds the stages (review R326: a forgotten
  // background tab held them for good); otherwise the beat is a plain console beat and the auto rules run.
  const replacedRef = useRef(replaced);
  replacedRef.current = replaced;
  useEffect(() => {
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
  }, [session.lessonId, session.token, session.name]);

  // The lesson feed: stage and its hold, the child's newest sentence, trades, the child's world look.
  useEffect(() => {
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
  }, [session.lessonId, session.token]);

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
          <button type="button" style={btn} onClick={back}>
            {TS.console}
          </button>
        </div>
      ) : (
        <button type="button" style={btn} onClick={back}>
          {TS.console}
        </button>
      )}
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
      {state === 'live' ? (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            {TS.give} · {TS.trades} {feed?.trades?.length ? `(${feed.trades.length})` : ''}
          </summary>
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
                {t.get_key ?? ''} {t.transcript ? `“${t.transcript}”` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {msg ? <div role="alert" style={{ fontSize: T.scale.micro.sizePx }}>{msg}</div> : null}
    </div>
  );
}
