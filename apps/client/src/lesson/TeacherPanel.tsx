/**
 * 1PC teacher panel (Dan 11-16): one PC for teacher and child. Over the child's own 3D screen, Ctrl+Shift+T (or the
 * small "선생님" button) opens a teacher panel after the lesson's lock number, checked on the server
 * (POST /v1/admin/lessons/:id/panel-unlock). It uses the operator sign-in this browser already holds from /director.
 *
 * While unlocked it beats teacher presence (panel 'open' or 'closed'), so the child's world shows the teacher; "선생님
 * 나가기" ends presence at once and locks again. Closed, the panel is not rendered at all: no script or answer stays in
 * the page (the child may read whatever the DOM holds). A reload locks it again.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LESSON_PLANS, getLessonPlan, type LessonStage } from '@lcw/content';
import { TOKENS } from '@lcw/ui';

export const OPERATOR_TOKEN_KEY = 'lcw.operatorToken';
export const PANEL_BEAT_MS = 15_000;
const C = TOKENS.colors;

export const PANEL_STRINGS_KO = {
  open: '선생님',
  title: '선생님 패널',
  pinLabel: '1PC 잠금 번호',
  unlock: '열기',
  cancel: '취소',
  close: '닫기 (Ctrl+Shift+T)',
  leave: '선생님 나가기',
  next: '다음 단계로',
  noSignIn: '이 PC 에서 먼저 /director 로 로그인하고 수업을 시작하세요.',
  noPin: '콘솔에서 1PC 잠금 번호를 먼저 정해 주세요.',
  wrongPin: '번호가 맞지 않아요.',
  tooMany: '여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.',
  failed: '연결이 안 돼요. 다시 눌러 주세요.',
  script: '대본',
  answers: '정답 문장',
  stage: (n: number, t: string) => `${n}단계 · ${t}`,
  lastStage: '마지막 단계예요.'
} as const;
const S = PANEL_STRINGS_KO;

export interface PanelApi {
  unlock(op: string, lessonId: string, pin: string): Promise<'ok' | 'wrong_pin' | 'no_pin' | 'too_many_attempts' | 'error'>;
  beat(op: string, lessonId: string, panel: 'open' | 'closed'): Promise<boolean>;
  leave(op: string, lessonId: string): Promise<boolean>;
  pushStage(op: string, lessonId: string, stage: LessonStage): Promise<boolean>;
}

export function createPanelApi(base = '', f: typeof fetch = (...a) => fetch(...a)): PanelApi {
  const post = async (op: string, path: string, body: unknown) =>
    f(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${op}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  const enc = encodeURIComponent;
  return {
    async unlock(op, lessonId, pin) {
      try {
        const r = await post(op, `/v1/admin/lessons/${enc(lessonId)}/panel-unlock`, { pin });
        if (r.ok) return 'ok';
        const e = ((await r.json().catch(() => ({}))) as { error?: string }).error;
        return e === 'wrong_pin' || e === 'no_pin' || e === 'too_many_attempts' ? e : 'error';
      } catch {
        return 'error';
      }
    },
    async beat(op, lessonId, panel) {
      try {
        return (await post(op, `/v1/admin/lessons/${enc(lessonId)}/presence`, { panel })).ok;
      } catch {
        return false;
      }
    },
    async leave(op, lessonId) {
      try {
        return (await post(op, `/v1/admin/lessons/${enc(lessonId)}/presence/leave`, {})).ok;
      } catch {
        return false;
      }
    },
    async pushStage(op, lessonId, stage) {
      try {
        return (await post(op, `/v1/admin/lessons/${enc(lessonId)}/stage`, { stage_id: stage.id, targets: stage.targets.map((t) => t.text) })).ok;
      } catch {
        return false;
      }
    }
  };
}

function readOperatorToken(): string | null {
  try {
    const v = globalThis.localStorage?.getItem(OPERATOR_TOKEN_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** The plan holding this stage: the server's plan id first, else the first plan that has the stage. */
export function stageContext(planId: string | null, stageId: string | null): { stage: LessonStage; next: LessonStage | null; index: number } | null {
  if (!stageId) return null;
  const plan = planId ? getLessonPlan(planId) : LESSON_PLANS.find((p) => p.stages.some((s) => s.id === stageId));
  if (!plan) return null;
  const i = plan.stages.findIndex((s) => s.id === stageId);
  if (i < 0) return null;
  return { stage: plan.stages[i]!, next: plan.stages[i + 1] ?? null, index: i };
}

type Phase = 'locked' | 'asking' | 'open' | 'closed';

export function TeacherPanel({
  lessonId,
  planId,
  stageId,
  api,
  operatorToken
}: {
  lessonId: string | null;
  planId: string | null;
  stageId: string | null;
  api?: PanelApi;
  /** Tests pass one; else read from this browser's /director sign-in. */
  operatorToken?: string | null;
}): React.ReactElement | null {
  const apiRef = useRef<PanelApi>(api ?? createPanelApi());
  const [phase, setPhase] = useState<Phase>('locked');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const op = operatorToken !== undefined ? operatorToken : readOperatorToken();
  const unlocked = phase === 'open' || phase === 'closed';

  const toggle = useCallback(() => {
    setMsg(null);
    setPhase((p) => (p === 'locked' ? 'asking' : p === 'asking' ? 'locked' : p === 'open' ? 'closed' : 'open'));
    setPin('');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // While unlocked, this panel is the teacher's heartbeat (open or folded away).
  useEffect(() => {
    if (!unlocked || !op || !lessonId) return undefined;
    const panel = phase === 'open' ? 'open' : 'closed';
    void apiRef.current.beat(op, lessonId, panel);
    const id = setInterval(() => void apiRef.current.beat(op, lessonId, panel), PANEL_BEAT_MS);
    return () => clearInterval(id);
  }, [unlocked, phase, op, lessonId]);

  const submit = async () => {
    if (!op || !lessonId) return setMsg(S.noSignIn);
    const r = await apiRef.current.unlock(op, lessonId, pin);
    setPin('');
    if (r === 'ok') {
      setMsg(null);
      setPhase('open');
    } else setMsg(r === 'wrong_pin' ? S.wrongPin : r === 'no_pin' ? S.noPin : r === 'too_many_attempts' ? S.tooMany : S.failed);
  };
  const leave = async () => {
    if (op && lessonId) await apiRef.current.leave(op, lessonId);
    setPhase('locked');
  };

  const box: React.CSSProperties = {
    position: 'fixed',
    top: 100,
    right: 12,
    zIndex: 70,
    width: 'min(420px, calc(100vw - 24px))',
    maxHeight: 'calc(100vh - 124px)',
    overflowY: 'auto',
    background: C['paper-0'],
    color: C['ink-900'],
    border: `3px solid ${C['ink-900']}`,
    borderRadius: 12,
    padding: 12,
    boxShadow: '0 6px 24px rgba(0,0,0,.3)',
    pointerEvents: 'auto',
    fontSize: 15
  };
  const btn: React.CSSProperties = { minHeight: 40, padding: '6px 12px', borderRadius: 8, border: `2px solid ${C['ink-900']}`, background: C['paper-100'], fontWeight: 700, cursor: 'pointer' };

  const ctx = phase === 'open' ? stageContext(planId, stageId) : null;
  return (
    <>
      {/* Small and plain on purpose: a child tapping it only meets the lock number. */}
      <button
        type="button"
        data-testid="teacher-panel-toggle"
        aria-label={S.title}
        onClick={toggle}
        style={{ position: 'fixed', top: 60, right: 12, zIndex: 70, ...btn, minHeight: 32, padding: '2px 8px', fontSize: 12, opacity: 0.75, pointerEvents: 'auto' }}
      >
        {S.open}
      </button>
      {phase === 'asking' ? (
        <form
          data-testid="teacher-panel-lock"
          style={box}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label style={{ display: 'grid', gap: 6, fontWeight: 700 }}>
            {S.pinLabel}
            <input
              data-testid="teacher-panel-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D+/g, ''))}
              style={{ fontSize: 20, padding: 8, borderRadius: 8, border: `2px solid ${C['ink-900']}` }}
            />
          </label>
          {msg ? (
            <p role="alert" style={{ margin: '8px 0 0' }}>
              {msg}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" style={btn}>
              {S.unlock}
            </button>
            <button type="button" style={btn} onClick={() => setPhase('locked')}>
              {S.cancel}
            </button>
          </div>
        </form>
      ) : null}
      {phase === 'open' ? (
        <section data-testid="teacher-panel" style={box} aria-label={S.title}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{S.title}</h2>
          {ctx ? (
            <>
              <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{S.stage(ctx.index + 1, ctx.stage.titleKo)}</p>
              <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{S.script}</p>
              <p lang="en" data-testid="teacher-panel-script" style={{ margin: '0 0 8px' }}>
                {ctx.stage.teacherScriptEn}
              </p>
              <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{S.answers}</p>
              <ul lang="en" data-testid="teacher-panel-answers" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {ctx.stage.targets.map((t) => (
                  <li key={t.text}>{t.text}</li>
                ))}
              </ul>
            </>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ctx?.next ? (
              <button
                type="button"
                style={btn}
                data-testid="teacher-panel-next"
                onClick={() => void (op && lessonId && ctx.next ? apiRef.current.pushStage(op, lessonId, ctx.next) : undefined)}
              >
                {S.next}
              </button>
            ) : ctx ? (
              <span>{S.lastStage}</span>
            ) : null}
            <button type="button" style={btn} data-testid="teacher-panel-close" onClick={() => setPhase('closed')}>
              {S.close}
            </button>
            <button type="button" style={btn} data-testid="teacher-panel-leave" onClick={() => void leave()}>
              {S.leave}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
