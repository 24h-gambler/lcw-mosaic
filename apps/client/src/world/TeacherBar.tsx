/**
 * The teacher in the world (Dan 11-16 "평상시 1인칭으로 진행되는 것 아니었나요?"; docs/02 §11).
 *
 * The console (/director, "🧭 월드에서 1인칭으로") opens `/world/?teach=<lesson id>` in the same tab. With the console's
 * own sign-in (localStorage `lcw.operatorToken`, an `lcwop_` session or the ops key) this page joins the lesson's
 * multi room as role 'teacher' (operator ticket naming `lesson-<id>`), so the child sees the teacher's real avatar
 * walking instead of the visiting-teacher figure, and the teacher sees the child. While here the page keeps the
 * console's presence beat (source 'console', every 15 s) so "선생님과 함께" does not drop on the child's screen;
 * it never touches the child's world_seen_at. "콘솔로" goes back to /director, which resumes the running lesson.
 */
import React, { useEffect, useRef, useState } from 'react';
import { COLOR_TOKENS as C } from '@lcw/ui';
import type { WorldHandle } from './api.js';

export const OPERATOR_TOKEN_KEY = 'lcw.operatorToken';
export const TEACHER_NAME_KEY = 'lcw.teacherName';
/** Same cadence as the console (apps/web teacherPresence.ts TEACHER_BEAT_MS / TEACHER_RETRY_MS). */
export const TEACH_BEAT_MS = 15_000;
export const TEACH_RETRY_MS = 5_000;

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

export const TS = {
  title: '선생님 · 1인칭으로 수업 중',
  students: (n: number) => (n > 0 ? `학생 ${n}명이 같은 곳에 있어요` : '학생이 아직 월드에 없어요'),
  goNear: '학생 옆으로',
  /** R326 play fighting switch for the room (the label says what a press does) */
  pvpOff: '때리기 끄기',
  pvpOn: '때리기 켜기',
  console: '콘솔로',
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

export interface TeacherBarProps {
  world: WorldHandle;
  session: TeachSession;
  fetchImpl?: FetchLike;
  /** The multi room connection: another tab of this teacher taking the seat shows here with a way back. */
  room?: TeachRoom | null;
  /** Test seam: where "콘솔로" goes. */
  goConsole?: () => void;
}

export function TeacherBar({ world, session, room, fetchImpl, goConsole }: TeacherBarProps): React.ReactElement {
  const [peers, setPeers] = useState(0);
  const [state, setState] = useState<'live' | 'ended' | 'signin'>('live');
  const [replaced, setReplaced] = useState(room?.status === 'replaced');
  const [pvp, setPvp] = useState(() => world.roomPvp?.() ?? true);
  const autoWent = useRef(false);

  // Presence beat while the teacher is in the world (the console's tab is this one now).
  useEffect(() => {
    const f: FetchLike = fetchImpl ?? ((i, init) => globalThis.fetch(i, init));
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beat = async (): Promise<void> => {
      if (stop) return;
      let next = TEACH_BEAT_MS;
      try {
        const r = await f(`/v1/admin/lessons/${encodeURIComponent(session.lessonId)}/presence`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
          // the same beat as the console's, name included (the console sends the name it keeps in lcw.teacherName)
          body: JSON.stringify({ panel: 'open', source: 'console', ...(session.name ? { name: session.name } : {}) })
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
  }, [session.lessonId, session.token, session.name, fetchImpl]);

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

  const back = goConsole ?? (() => location.assign('/director'));
  const btn: React.CSSProperties = {
    pointerEvents: 'auto',
    border: `2px solid ${C['ink-900']}`,
    borderRadius: 10,
    background: C['paper-50'],
    color: C['ink-900'],
    font: 'inherit',
    fontWeight: 700,
    padding: '6px 12px',
    minHeight: 40,
    cursor: 'pointer'
  };
  const text =
    state === 'ended'
      ? TS.ended
      : state === 'signin'
        ? TS.signIn
        : replaced
          ? TS.replaced
          : `${TS.title} · ${TS.students(peers)}`;
  return (
    <div
      className="lcw-teachbar"
      role="status"
      style={{
        position: 'absolute',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'calc(100% - 32px)',
        padding: '6px 10px',
        borderRadius: 12,
        background: 'rgba(20,24,32,0.78)',
        color: '#fff',
        fontSize: 14
      }}
    >
      <span>{text}</span>
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
        <button type="button" style={btn} disabled={peers === 0} onClick={() => void world.goNearPeer?.('student')}>
          {TS.goNear}
        </button>
      ) : null}
      {state === 'live' && !replaced && world.setRoomPvp ? (
        <button
          type="button"
          style={btn}
          aria-pressed={!pvp}
          onClick={() => {
            world.setRoomPvp?.(!pvp);
            setPvp(!pvp);
          }}
        >
          {pvp ? TS.pvpOff : TS.pvpOn}
        </button>
      ) : null}
      <button type="button" style={btn} onClick={back}>
        {TS.console}
      </button>
    </div>
  );
}
