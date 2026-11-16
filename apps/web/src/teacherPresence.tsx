import React, { useEffect, useRef, useState } from 'react';
import { TEACHER_NAME_MAX, normalizeTeacherName } from '@lcw/content';
import { Button } from '@lcw/ui';
import type { LessonApi, TeacherPresence } from './lessonApi.js';
import { Box, inputStyle, labelStyle, sp } from './lessonUi.js';
import { P } from './presenceStrings.js';

/**
 * Teacher presence on the console side (edge lesson-mode.ts): while a lesson runs and this console shows it, beat
 * POST /v1/admin/lessons/:id/presence every TEACHER_BEAT_MS. The child's world is "with the teacher" while beats come
 * (45 s window) and switches to "혼자 놀기" when they stop (console closed, device asleep, teacher left).
 *
 * The beat runs on a tiny dedicated worker when one can be made: a hidden tab's own timers are throttled to once a
 * minute after five minutes (Chrome intensive throttling), which would flap the child to "alone" while the teacher is
 * still there with the console in a background tab. Worker timers are not throttled that way.
 */
export const TEACHER_BEAT_MS = 15_000;
/** A failed beat is sent again this soon (a blip must not cost the child the teacher at the 45 s mark). */
export const TEACHER_RETRY_MS = 5_000;
/** The name alone ("김민지"; the child sees "김민지 선생님"), kept per console browser. */
export const TEACHER_NAME_KEY = 'lcw.teacherName';
/** The name alone the server accepts (title dropped, 1-TEACHER_NAME_MAX chars, no control characters or <>), else null. */
export const cleanTeacherName = normalizeTeacherName;
function readTeacherName(): string | null {
  try {
    return cleanTeacherName(globalThis.localStorage?.getItem(TEACHER_NAME_KEY));
  } catch {
    return null;
  }
}

export interface Ticker {
  stop(): void;
}

/** A repeating tick from a worker when possible, else setInterval. Exposed for tests. */
export function startTicker(fn: () => void, ms: number, env: { Worker?: typeof Worker; URL?: typeof URL; Blob?: typeof Blob } = globalThis): Ticker {
  try {
    if (env.Worker && env.URL?.createObjectURL && env.Blob) {
      const src = `let id=null;onmessage=(e)=>{if(id!==null)clearInterval(id);id=e.data>0?setInterval(()=>postMessage(0),e.data):null;};`;
      const url = env.URL.createObjectURL(new env.Blob([src], { type: 'text/javascript' }));
      const w = new env.Worker(url);
      w.onmessage = () => fn();
      w.postMessage(ms);
      return {
        stop: () => {
          w.postMessage(0);
          w.terminate();
          env.URL?.revokeObjectURL?.(url);
        }
      };
    }
  } catch {
    /* CSP or no workers: fall back */
  }
  const id = setInterval(fn, ms);
  return { stop: () => clearInterval(id) };
}

/**
 * Beats for one lesson while `active`. Returns the server's latest view of the teacher (null before the first answer)
 * and whether the last beat failed. `panel` is the 1PC teacher panel state ('open' on the director console).
 */
export function useTeacherHeartbeat(o: {
  api: Pick<LessonApi, 'presence'> & Partial<Pick<LessonApi, 'leave'>>;
  token: string | null;
  lessonId: string | null;
  active: boolean;
  panel?: 'open' | 'closed';
  ticker?: typeof startTicker;
  retryMs?: number;
  /** Sent with each beat ('' clears it); null sends nothing about the name. The child sees teacherLabel(name). */
  name?: string | null;
}): { teacher: TeacherPresence | null; failing: boolean; left: boolean; resume: () => Promise<void>; leave: () => Promise<void> } {
  const [teacher, setTeacher] = useState<TeacherPresence | null>(null);
  const [failing, setFailing] = useState(false);
  // The teacher pressed "선생님 나가기" on the 1PC panel: this console's beats no longer count until resume.
  const [left, setLeft] = useState(false);
  const panelRef = useRef(o.panel ?? 'open');
  panelRef.current = o.panel ?? 'open';
  const nameRef = useRef<string | null>(o.name ?? null);
  nameRef.current = o.name ?? null;
  const { api, token, lessonId, active } = o;
  const ticker = o.ticker ?? startTicker;
  const retryMs = o.retryMs ?? TEACHER_RETRY_MS;
  useEffect(() => {
    if (!active || !token || !lessonId) return undefined;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const beat = async () => {
      if (retry !== null) clearTimeout(retry);
      retry = null;
      try {
        const r = await api.presence(token, lessonId, panelRef.current, false, nameRef.current);
        if (!live) return;
        setTeacher(r.teacher);
        setLeft(r.left === true);
        setFailing(false);
      } catch {
        if (!live) return;
        setFailing(true);
        retry = setTimeout(() => void beat(), retryMs);
      }
    };
    void beat();
    const t = ticker(() => void beat(), TEACHER_BEAT_MS);
    // Coming back to the tab beats at once (the child sees the teacher again without waiting for the next tick).
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void beat();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      if (retry !== null) clearTimeout(retry);
      t.stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, token, lessonId, active, ticker, retryMs]);
  const resume = async () => {
    if (!token || !lessonId) return;
    try {
      const r = await api.presence(token, lessonId, panelRef.current, true, nameRef.current);
      setTeacher(r.teacher);
      setLeft(r.left === true);
      setFailing(false);
    } catch {
      setFailing(true);
    }
  };
  const leave = async () => {
    if (!token || !lessonId || !api.leave) return;
    try {
      const r = await api.leave(token, lessonId);
      setTeacher(r.teacher);
      setLeft(true);
    } catch {
      setFailing(true);
    }
  };
  return { teacher, failing, left, resume, leave };
}

/** One line on the console: what the child's screen says about the teacher right now. */
export function TeacherStatus({ teacher, failing, left = false }: { teacher: TeacherPresence | null; failing: boolean; left?: boolean }): React.ReactElement {
  const text = failing
    ? P.consoleBeatFailing
    : !teacher
      ? P.consoleBeatStarting
      : teacher.present
        ? P.consolePresent
        : left
          ? P.consoleLeft
          : P.consoleAbsent;
  return (
    <p
      data-testid="teacher-status"
      data-present={teacher?.present ? '1' : '0'}
      role="status"
      style={{ margin: 0, fontWeight: 700 }}
    >
      {text}
    </p>
  );
}

/**
 * The console's teacher box during a lesson: beats, shows what the child's world says about the teacher, sets the 1PC
 * lock number, and holds the 1PC/2PC help sheet.
 */
export function TeacherPresenceBox({
  api,
  token,
  lessonId,
  ended
}: {
  api: Pick<LessonApi, 'presence' | 'leave' | 'setPanelPin' | 'panelPinState'>;
  token: string;
  lessonId: string;
  ended: boolean;
}): React.ReactElement {
  const [name, setName] = useState<string>(() => readTeacherName() ?? '');
  const cleanName = cleanTeacherName(name);
  // Always says the name: an emptied field goes back to the account's name or "선생님" (review #80).
  const { teacher, failing, left, resume, leave } = useTeacherHeartbeat({ api, token, lessonId, active: !ended, name: cleanName ?? '' });
  const saveName = (v: string) => {
    setName(v);
    try {
      const c = cleanTeacherName(v);
      if (c) globalThis.localStorage?.setItem(TEACHER_NAME_KEY, c);
      else globalThis.localStorage?.removeItem(TEACHER_NAME_KEY);
    } catch {
      /* private mode: the name still goes with this tab's beats */
    }
  };
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .panelPinState(token, lessonId)
      .then((r) => live && setPinSet(r.set))
      .catch(() => live && setPinSet(null));
    return () => {
      live = false;
    };
  }, [api, token, lessonId]);
  const savePin = async () => {
    if (!/^\d{4,6}$/.test(pin)) return setPinMsg(P.pinInvalid);
    try {
      await api.setPanelPin(token, lessonId, pin);
      setPin('');
      setPinSet(true);
      setPinMsg(P.pinSaved);
    } catch {
      setPinMsg(P.pinFailed);
    }
  };
  return (
    <Box title={P.boxTitle} testId="teacher-presence-box">
      <div style={{ display: 'grid', gap: sp(2) }}>
        {ended ? null : <TeacherStatus teacher={teacher} failing={failing} left={left} />}
        <label style={{ ...labelStyle, maxWidth: 320 }}>
          {P.nameLabel}
          <input
            data-testid="teacher-name-input"
            type="text"
            autoComplete="off"
            maxLength={TEACHER_NAME_MAX}
            placeholder={P.namePlaceholder}
            value={name}
            onChange={(e) => saveName(e.target.value)}
            style={inputStyle}
          />
        </label>
        {ended ? null : left && !teacher?.present ? (
          <div>
            <Button type="button" variant="brand" data-testid="teacher-resume" onClick={() => void resume()}>
              {P.consoleResume}
            </Button>
          </div>
        ) : (
          <div>
            <Button type="button" variant="paper" data-testid="teacher-leave" onClick={() => void leave()}>
              {P.consoleLeave}
            </Button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePin();
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}
        >
          <label style={{ ...labelStyle, flex: '0 1 200px' }}>
            {pinSet ? P.pinChange : P.pinLabel}
            <input
              data-testid="panel-pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D+/g, ''))}
              style={inputStyle}
            />
          </label>
          <Button type="submit" variant="paper">
            {P.pinSave}
          </Button>
          <span data-testid="panel-pin-state" style={{ fontSize: 14 }}>
            {pinMsg ?? (pinSet ? P.pinIsSet : pinSet === false ? P.pinNotSet : '')}
          </span>
        </form>
        <TeacherModeHelp />
      </div>
    </Box>
  );
}

/** The in-console sheet "1PC 로 할 때 / 2PC 로 할 때". */
export function TeacherModeHelp(): React.ReactElement {
  return (
    <details data-testid="teacher-mode-help">
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{P.helpSummary}</summary>
      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        <section>
          <h4 style={{ margin: '0 0 4px' }}>{P.help2pcTitle}</h4>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {P.help2pc.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </section>
        <section>
          <h4 style={{ margin: '0 0 4px' }}>{P.help1pcTitle}</h4>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {P.help1pc.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </section>
        <p style={{ margin: 0 }}>{P.helpAlone}</p>
      </div>
    </details>
  );
}
