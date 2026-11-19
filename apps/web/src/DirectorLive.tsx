/**
 * Live layer of the director console (WP-305, docs/18): what the student's screen shows right now, and the teacher's
 * own hands in the lesson — speak as an NPC (possession), put a sentence of their own on the child's screen, and the
 * six director events. The R2625 trim (11-16) took those off the console; Dan 11-19 ("LCW 는 선생은 못하고 자유도도
 * 없앴다") brought them back, folded under 「선생님이 직접 하기」 so the console stays short when nobody steers
 * (docs/18 §8). The progress-chart, platform-help and next-lesson boxes stay off.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { LESSON_DIRECTOR_EVENTS, LESSON_NPCS, getLessonNpc, type LessonDirectorEvent, type LessonStage } from '@lcw/content';
import { errorCodeOf, type LessonApi } from './lessonApi.js';
import { eventForKey, type DirectorLiveView } from './directorLiveState.js';
import { formatClock } from './lessonFlow.js';
import { Box, Notice, Stat, border, inputStyle, sp } from './lessonUi.js';
import { DIRECTOR_LIVE_STRINGS_KO as L } from './directorLiveStrings.js';
import { P } from './presenceStrings.js';
import { micIssueLine } from './autoCloseStrings.js';

const C = TOKENS.colors;
const T = TOKENS.typography;

/* ---------- student screen summary ---------- */

/** `startedAt` is the lesson start on the server clock: the last utterance's `at` is server-stamped. */
export function StudentScreenBox(p: { live: DirectorLiveView; localNow: number; startedAt: number }): React.ReactElement {
  const v = p.live.studentView;
  const serverNow = p.localNow + p.live.clockSkewMs;
  const ago = v?.last_seen_at ? Math.max(0, Math.round((serverNow - v.last_seen_at) / 1000)) : null;
  const connected = Boolean(v?.connected) && ago !== null && ago <= 10;
  const sceneName = (id: string | null | undefined) => (id ? (L.sceneNames[id] ?? id) : '—');
  // On /adventure/ the child is not on the way to the stage scene: say where they are instead (docs/22 수업 유지).
  const onAdventure = v?.scene_id === 'adventure';
  const mismatch = v && v.expected_scene_id && v.scene_id && v.scene_id !== v.expected_scene_id && !onAdventure;
  const possessed = getLessonNpc(p.live.possessedNpcId);
  // The child's last mic error with what to do, until a turn hears words again (talk lane PR 122 sets mic 'ok' then).
  const micLine = v?.mic_issue && v.mic !== 'ok' ? micIssueLine(v.mic_issue.issue, v.mic_issue.raw) : null;
  return (
    <Box
      title={L.screenTitle}
      testId="director-student-screen"
      right={
        <span
          data-testid="student-connection"
          style={{ display: 'inline-flex', alignItems: 'center', gap: sp(1), fontWeight: 700, color: connected ? C['leaf-d'] : C['danger-d'] }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: connected ? C.leaf : C.danger, display: 'inline-block' }} />
          {connected ? L.connected(ago ?? 0) : L.disconnected(ago)}
          {v?.ui ? ` · ${v.ui === 'cards' ? L.uiCards : L.ui3d}` : ''}
        </span>
      }
    >
      <div style={{ display: 'grid', gap: sp(2) }}>
        <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
          <Stat label={L.scene} value={sceneName(v?.scene_id ?? v?.expected_scene_id)} testId="student-scene" />
          <span data-testid="student-mic" style={{ fontWeight: 700, alignSelf: 'center' }}>
            {P.mic(v?.mic ?? null)}
          </span>
          <Stat label={L.possessTitle.split(' · ')[0]!} value={possessed ? possessed.nameKo : '—'} />
        </div>
        {micLine ? (
          <div role="status" data-testid="student-mic-issue" style={{ fontWeight: 700, color: C['danger-d'] }}>
            {micLine}
          </div>
        ) : null}
        {mismatch ? <Notice kind="info">{L.sceneMismatch(sceneName(v?.expected_scene_id))}</Notice> : null}
        {onAdventure ? <Notice kind="info">{L.onAdventure}</Notice> : null}
        {v?.goal_ko ? (
          <div>
            <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.goal}</span>
            <div style={{ fontWeight: 700 }}>{v.goal_ko}</div>
          </div>
        ) : null}
        {v?.targets?.length ? (
          <div>
            <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.onScreen}</span>
            <ul lang="en" style={{ margin: 0, paddingLeft: sp(4), fontFamily: T.fonts.target }}>
              {v.targets.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div data-testid="student-last-said">
          <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.lastSaid}</span>
          {v?.last_utterance ? (
            <div style={{ display: 'flex', gap: sp(2), alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: C['ink-500'] }}>{formatClock(v.last_utterance.at - p.startedAt)}</span>
              <span style={{ color: C['sun-d'], fontWeight: 700 }}>{'★'.repeat(v.last_utterance.stars) || '·'}</span>
              <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px`, fontWeight: 700 }}>
                {v.last_utterance.transcript}
              </span>
            </div>
          ) : (
            <div style={{ color: C['ink-500'] }}>{L.nothingSaidYet}</div>
          )}
        </div>
      </div>
    </Box>
  );
}

/* ---------- possession ---------- */

export function PossessBox(p: {
  api: LessonApi;
  token: string;
  lessonId: string;
  stage: LessonStage | undefined;
  live: DirectorLiveView;
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [npcId, setNpcId] = useState<string>(p.stage?.npcId ?? 'guide');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stageNpc = p.stage?.npcId;
  useEffect(() => {
    // follow the stage's NPC when the teacher moves on (still changeable by hand)
    if (stageNpc) setNpcId(stageNpc);
  }, [stageNpc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !el?.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const say = async (line: string) => {
    const t = line.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await p.api.npcSay(p.token, p.lessonId, { npc_id: npcId, text: t.slice(0, 200) });
      setText('');
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
      setErr(L.sayFailed);
    } finally {
      setBusy(false);
    }
  };
  const release = async () => {
    try {
      await p.api.possess(p.token, p.lessonId, null);
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
    }
  };
  const possessed = getLessonNpc(p.live.possessedNpcId);
  const recent = p.live.npcLines.slice(-4).reverse();
  return (
    <Box
      title={L.possessTitle}
      testId="director-possess"
      right={
        <span style={{ fontWeight: 700, color: possessed ? C['grape-d'] : C['ink-500'] }}>
          {possessed ? `✨ ${L.possessing(possessed.nameKo)}` : L.notPossessing}
        </span>
      }
    >
      <p style={{ margin: `0 0 ${sp(2)}`, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.possessHelp}</p>
      <div role="radiogroup" aria-label={L.possessTitle} style={{ display: 'flex', gap: sp(1), flexWrap: 'wrap', marginBottom: sp(2) }}>
        {LESSON_NPCS.map((n) => (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={npcId === n.id}
            data-testid={`npc-${n.id}`}
            onClick={() => setNpcId(n.id)}
            style={{
              minHeight: `${TOKENS.shape.gameButtonMinPx}px`,
              padding: `${sp(1)} ${sp(3)}`,
              border: npcId === n.id ? `3px solid ${C['grape-d']}` : border,
              backgroundColor: npcId === n.id ? C['grape-l'] : C['paper-0'],
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              fontWeight: 700,
              fontSize: `${T.scale.body.sizePx}px`,
              cursor: 'pointer',
              color: C['ink-900']
            }}
          >
            {p.live.possessedNpcId === n.id ? '✨ ' : ''}
            {n.nameKo}
          </button>
        ))}
        {possessed ? (
          <Button type="button" variant="paper" disabled={p.disabled} onClick={() => void release()}>
            {L.release}
          </Button>
        ) : null}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void say(text);
        }}
        style={{ display: 'flex', gap: sp(1) }}
      >
        <input
          ref={inputRef}
          // Enter that only finishes Korean composition must not send a half line. Only isComposing: Android Gboard
          // reports keyCode 229 for English too, and blocking that would leave a tablet with no Enter at all.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
          data-testid="npc-say-input"
          lang="en"
          value={text}
          maxLength={200}
          disabled={p.disabled}
          placeholder={L.sayPlaceholder}
          aria-label={L.sayPlaceholder}
          onChange={(e) => setText(e.target.value)}
          style={{ ...inputStyle, flex: 1, minHeight: `${TOKENS.shape.gameButtonMinPx}px`, fontSize: `${T.scale['body-l'].sizePx}px` }}
        />
        <Button type="submit" variant="brand" size="game" disabled={p.disabled || busy || !text.trim()}>
          {busy ? L.sending : L.say}
        </Button>
      </form>
      {p.stage?.teacherScriptEn ? (
        <div style={{ display: 'grid', gap: sp(1), marginTop: sp(2) }}>
          {[p.stage.teacherScriptEn, ...(p.stage.followUpsEn ?? [])].map((line, i) => (
            <button
              key={`${i}:${line}`}
              type="button"
              data-testid={i === 0 ? 'npc-say-script' : `npc-say-followup-${i}`}
              disabled={p.disabled || busy}
              onClick={() => void say(line)}
              style={{
                width: '100%',
                textAlign: 'left',
                border,
                borderStyle: 'dashed',
                borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                backgroundColor: i === 0 ? C['paper-50'] : C['paper-0'],
                padding: `${sp(1)} ${sp(2)}`,
                cursor: 'pointer',
                minHeight: `${TOKENS.shape.touchTargetMinPx}px`,
                color: C['ink-900']
              }}
            >
              <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{i === 0 ? L.sayScript : L.sayFollowUp} · </span>
              <span lang="en" style={{ fontFamily: T.fonts.target }}>
                “{line}”
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {err ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice>{err}</Notice>
        </div>
      ) : null}
      {recent.length ? (
        <div style={{ marginTop: sp(2) }}>
          <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.recentLines}</span>
          <ul style={{ margin: 0, paddingLeft: sp(4) }}>
            {recent.map((l) => (
              <li key={l.id}>
                <strong>{getLessonNpc(l.npc_id)?.nameKo ?? l.npc_id}</strong>{' '}
                <span lang="en">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Box>
  );
}

/* ---------- director events ---------- */

export function EventsBox(p: {
  api: LessonApi;
  token: string;
  lessonId: string;
  stage: LessonStage | undefined;
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [last, setLast] = useState<LessonDirectorEvent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [putDone, setPutDone] = useState(false);
  const busy = useRef(false);
  const fire = async (ev: LessonDirectorEvent) => {
    if (busy.current || p.disabled) return;
    busy.current = true;
    setErr(null);
    setPutDone(false);
    try {
      await p.api.fireEvent(p.token, p.lessonId, { kind: ev.kind });
      setLast(ev);
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
      setErr(L.eventFailed);
    } finally {
      busy.current = false;
    }
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return; // a held key fires one event, not a burst
      const ev = eventForKey(e.key, e.target as HTMLElement | null);
      if (!ev) return;
      e.preventDefault();
      void fireRef.current(ev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const putTarget = async (en: string) => {
    if (!p.stage) return;
    try {
      await p.api.pushStage(p.token, p.lessonId, { stage_id: p.stage.id, targets: [en], only_if_stage: true });
      setPutDone(true);
      p.onSent();
    } catch (e) {
      const code = errorCodeOf(e);
      p.onAuthError(code);
      setErr(code === 'stage_moved' ? L.ownTargetMoved : L.eventFailed);
      if (code === 'stage_moved') p.onSent();
    }
  };
  return (
    <Box title={L.eventsTitle} testId="director-events">
      <p style={{ margin: `0 0 ${sp(2)}`, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.eventsHelp}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: sp(2) }}>
        {LESSON_DIRECTOR_EVENTS.map((ev) => (
          <button
            key={ev.kind}
            type="button"
            data-testid={`event-${ev.kind}`}
            disabled={p.disabled}
            onClick={() => void fire(ev)}
            style={{
              minHeight: 76,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              alignItems: 'center',
              gap: sp(1),
              textAlign: 'left',
              padding: `${sp(1)} ${sp(2)}`,
              border,
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              boxShadow: TOKENS.shape.shadowDefault,
              backgroundColor: last?.kind === ev.kind ? C.sun : C['paper-0'],
              cursor: p.disabled ? 'not-allowed' : 'pointer',
              color: C['ink-900'],
              fontFamily: T.fonts.ui
            }}
          >
            <span aria-hidden style={{ fontSize: 30 }}>
              {ev.icon}
            </span>
            <span>
              <strong style={{ display: 'block', fontSize: `${T.scale.body.sizePx}px` }}>{ev.labelKo}</strong>
              <kbd style={{ fontSize: `${T.scale.micro.sizePx}px`, border, borderRadius: 4, padding: '0 4px', backgroundColor: C['paper-50'] }}>{ev.hotkey}</kbd>
            </span>
          </button>
        ))}
      </div>
      {last ? (
        <div role="status" style={{ marginTop: sp(2), border, borderRadius: `${TOKENS.shape.radiusButtonPx}px`, padding: sp(2), backgroundColor: C['paper-50'] }}>
          <strong>{L.eventSent(last.labelKo)}</strong>
          <div style={{ fontSize: `${T.scale.small.sizePx}px`, marginTop: sp(1) }}>{last.teacherTipKo}</div>
          <button
            type="button"
            onClick={() => void putTarget(last.suggestedTargetEn)}
            disabled={p.disabled || !p.stage}
            style={{ marginTop: sp(2), border, borderRadius: `${TOKENS.shape.radiusButtonPx}px`, padding: `${sp(1)} ${sp(2)}`, backgroundColor: C['paper-0'], cursor: 'pointer', minHeight: `${TOKENS.shape.touchTargetMinPx}px`, color: C['ink-900'] }}
          >
            <span lang="en">{L.putTarget(last.suggestedTargetEn)}</span>
          </button>
          {putDone ? <span style={{ marginLeft: sp(2), color: C['leaf-d'], fontWeight: 700 }}>{L.targetPut}</span> : null}
        </div>
      ) : null}
      {err ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice>{err}</Notice>
        </div>
      ) : null}
    </Box>
  );
}

/* ---------- the teacher's own sentence on the child's screen ---------- */

export function OwnTargetBox(p: {
  api: LessonApi;
  token: string;
  lessonId: string;
  stageId: string | null;
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    const t = text.trim().slice(0, 200);
    if (!t || busy || !p.stageId) return;
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      // only_if_stage: the console's stage can be up to one poll behind an auto move; never send the child back
      await p.api.pushStage(p.token, p.lessonId, { stage_id: p.stageId, targets: [t], only_if_stage: true });
      setDone(t);
      setText('');
      p.onSent();
    } catch (e) {
      const code = errorCodeOf(e);
      p.onAuthError(code);
      setErr(code === 'stage_moved' ? L.ownTargetMoved : L.ownTargetFailed);
      // catch up with the server's stage at once, so the next press goes to the new stage
      if (code === 'stage_moved') p.onSent();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box title={L.ownTargetTitle} testId="director-own-target">
      <p style={{ margin: `0 0 ${sp(2)}`, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.ownTargetHelp}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        style={{ display: 'flex', gap: sp(1) }}
      >
        <input
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
          data-testid="own-target-input"
          lang="en"
          value={text}
          maxLength={200}
          disabled={p.disabled || !p.stageId}
          placeholder={L.ownTargetPlaceholder}
          aria-label={L.ownTargetPlaceholder}
          onChange={(e) => setText(e.target.value)}
          style={{ ...inputStyle, flex: 1, minHeight: `${TOKENS.shape.gameButtonMinPx}px`, fontSize: `${T.scale['body-l'].sizePx}px` }}
        />
        <Button type="submit" variant="brand" size="game" disabled={p.disabled || busy || !p.stageId || !text.trim()}>
          {busy ? L.sending : L.ownTargetSend}
        </Button>
      </form>
      {done ? (
        <div role="status" style={{ marginTop: sp(2), color: C['leaf-d'], fontWeight: 700 }}>
          {L.targetPut}: <span lang="en">{done}</span>
        </div>
      ) : null}
      {err ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice>{err}</Notice>
        </div>
      ) : null}
    </Box>
  );
}

/* ---------- the teacher's hands, folded ---------- */

export const TEACH_MORE_OPEN_KEY = 'lcw.director.teachOpen';

function readTeachOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(TEACH_MORE_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 「선생님이 직접 하기」: possession, the teacher's own sentence and the director events under one fold. The boxes mount
 * only while it is open, so the event hotkeys (1–6) and the "/" shortcut do nothing on a folded console. The fold
 * remembers its state on this browser.
 */
export function TeachHands(p: {
  api: LessonApi;
  token: string;
  lessonId: string;
  stage: LessonStage | undefined;
  live: DirectorLiveView;
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(readTeachOpen);
  return (
    <details
      data-testid="director-teach-more"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        try {
          globalThis.localStorage?.setItem(TEACH_MORE_OPEN_KEY, now ? '1' : '0');
        } catch {
          /* private window: the fold just does not remember */
        }
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{L.teachMore}</summary>
      {open ? (
        <div style={{ display: 'grid', gap: sp(3), marginTop: sp(2) }}>
          <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.teachMoreHelp}</p>
          <PossessBox {...p} />
          <OwnTargetBox
            api={p.api}
            token={p.token}
            lessonId={p.lessonId}
            stageId={p.stage?.id ?? null}
            disabled={p.disabled}
            onSent={p.onSent}
            onAuthError={p.onAuthError}
          />
          <EventsBox api={p.api} token={p.token} lessonId={p.lessonId} stage={p.stage} disabled={p.disabled} onSent={p.onSent} onAuthError={p.onAuthError} />
        </div>
      ) : null}
    </details>
  );
}
