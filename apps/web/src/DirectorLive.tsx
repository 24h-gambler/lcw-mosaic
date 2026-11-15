/**
 * Live layer of the director console (WP-305, docs/18): what the student's screen shows, possession (speak as an
 * NPC), the six director events, the per-minute progress chart, what the platform is doing for the teacher, and the
 * next lesson. Built to be used with one hand during class: big buttons, digit and slash shortcuts.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import {
  LESSON_DIRECTOR_EVENTS,
  LESSON_NPCS,
  LESSON_PLANS,
  getLessonNpc,
  type LessonDirectorEvent,
  type LessonPlan,
  type LessonStage
} from '@lcw/content';
import { errorCodeOf, type LessonApi } from './lessonApi.js';
import {
  currentSilenceMinutes,
  eventForKey,
  progressBars,
  stageBands,
  type DirectorLiveView,
  type FeedMinute
} from './directorLiveState.js';
import { formatClock } from './lessonFlow.js';
import { Box, Notice, Stat, border, inputStyle, sp } from './lessonUi.js';
import { DIRECTOR_LIVE_STRINGS_KO as L } from './directorLiveStrings.js';

const C = TOKENS.colors;
const T = TOKENS.typography;

/* ---------- what the platform does right now ---------- */

export function HelpsStrip(p: { utterances: number; pins: number; minutes: number }): React.ReactElement {
  const items = [L.helps.record(p.utterances), L.helps.score, L.helps.pins(p.pins), L.helps.progress(p.minutes), L.helps.report];
  return (
    <div
      data-testid="director-helps"
      aria-label={L.helpsTitle}
      style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), alignItems: 'center', fontSize: `${T.scale.small.sizePx}px` }}
    >
      <strong style={{ marginRight: sp(1) }}>{L.helpsTitle}</strong>
      {items.map((t) => (
        <span key={t} style={{ border, borderRadius: 999, padding: `2px ${sp(2)}`, backgroundColor: C['paper-0'] }}>
          ✓ {t}
        </span>
      ))}
    </div>
  );
}

/* ---------- student screen summary ---------- */

export function StudentScreenBox(p: { live: DirectorLiveView; localNow: number; startedAt: number }): React.ReactElement {
  const v = p.live.studentView;
  const serverNow = p.localNow + p.live.clockSkewMs;
  const ago = v?.last_seen_at ? Math.max(0, Math.round((serverNow - v.last_seen_at) / 1000)) : null;
  const connected = Boolean(v?.connected) && ago !== null && ago <= 10;
  const sceneName = (id: string | null | undefined) => (id ? (L.sceneNames[id] ?? id) : '—');
  const mismatch = v && v.expected_scene_id && v.scene_id && v.scene_id !== v.expected_scene_id;
  const possessed = getLessonNpc(p.live.possessedNpcId);
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
          <Stat label={L.possessTitle.split(' · ')[0]!} value={possessed ? possessed.nameKo : '—'} />
        </div>
        {mismatch ? <Notice kind="info">{L.sceneMismatch(sceneName(v?.expected_scene_id))}</Notice> : null}
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
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
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
        <button
          type="button"
          data-testid="npc-say-script"
          disabled={p.disabled || busy}
          onClick={() => void say(p.stage!.teacherScriptEn)}
          style={{
            marginTop: sp(2),
            width: '100%',
            textAlign: 'left',
            border,
            borderStyle: 'dashed',
            borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
            backgroundColor: C['paper-50'],
            padding: `${sp(1)} ${sp(2)}`,
            cursor: 'pointer',
            minHeight: `${TOKENS.shape.touchTargetMinPx}px`,
            color: C['ink-900']
          }}
        >
          <span style={{ fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{L.sayScript} · </span>
          <span lang="en" style={{ fontFamily: T.fonts.target }}>
            “{p.stage.teacherScriptEn}”
          </span>
        </button>
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
      await p.api.pushStage(p.token, p.lessonId, { stage_id: p.stage.id, targets: [en] });
      setPutDone(true);
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
      setErr(L.eventFailed);
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

/* ---------- per-minute progress ---------- */

const STAGE_TONES = [C['sky'], C['sun'], C['leaf'], C['grape-l'], C['brand'], C['silver']] as const;

export function ProgressBox(p: { minutes: FeedMinute[]; live: DirectorLiveView; plan: LessonPlan; runningMinute: number | null }): React.ReactElement {
  const bars = progressBars(p.minutes, p.runningMinute);
  const bands = stageBands(p.minutes);
  const silence = currentSilenceMinutes(p.minutes, p.runningMinute);
  const pr = p.live.progress;
  const stageTitle = (id: string) => p.plan.stages.find((s) => s.id === id)?.titleKo ?? id;
  const stageTone = (id: string) => STAGE_TONES[Math.max(0, p.plan.stages.findIndex((s) => s.id === id)) % STAGE_TONES.length]!;
  const H = 56;
  const colW = bars.length > 60 ? 6 : bars.length > 30 ? 9 : 14;
  return (
    <Box title={L.progressTitle} testId="director-progress">
      {pr ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginBottom: sp(2) }}>
          <Stat label={L.progressStudent} value={formatClock(pr.student_ms)} testId="progress-student" />
          <Stat label={L.progressRatio} value={`${Math.round(pr.student_talk_ratio * 100)}%`} />
          <Stat label={L.progressExchanges} value={pr.exchanges} />
          <Stat label={L.progressSilence} value={pr.long_silence_minutes} />
        </div>
      ) : null}
      {silence >= 2 ? (
        <div style={{ marginBottom: sp(2) }}>
          <Notice kind="info" testId="silence-nudge">
            {L.silenceNudge(silence)}
          </Notice>
        </div>
      ) : null}
      {bars.length === 0 ? (
        <p style={{ margin: 0, color: C['ink-500'] }}>{L.progressEmpty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            role="img"
            aria-label={L.progressTitle}
            width={Math.max(bars.length * colW, 200)}
            height={H * 2 + 18}
            style={{ display: 'block' }}
          >
            {bands.map((b) => (
              <rect key={`${b.activity}-${b.from}`} x={b.from * colW} y={H * 2 + 6} width={(b.to - b.from + 1) * colW} height={10} fill={stageTone(b.activity)}>
                <title>{stageTitle(b.activity)}</title>
              </rect>
            ))}
            <line x1={0} x2={Math.max(bars.length * colW, 200)} y1={H} y2={H} stroke={C['ink-500']} strokeWidth={1} />
            {bars.map((b) => (
              <g key={b.minute}>
                <rect
                  x={b.minute * colW + 1}
                  y={H - (b.studentPct / 100) * H}
                  width={colW - 2}
                  height={Math.max(b.studentPct ? 2 : 0, (b.studentPct / 100) * H)}
                  fill={b.minute === p.runningMinute ? C['brand-d'] : C.brand}
                />
                <rect x={b.minute * colW + 1} y={H} width={colW - 2} height={(b.teacherPct / 100) * H} fill={C.sky} />
                {b.silent ? <rect x={b.minute * colW + 1} y={H - 3} width={colW - 2} height={3} fill={C['danger-d']} /> : null}
                <title>{`${b.minute + 1}분 · 학생 ${b.studentPct}% · 선생님 ${b.teacherPct}% · 주고받기 ${b.exchanges}`}</title>
              </g>
            ))}
          </svg>
          <div style={{ display: 'flex', gap: sp(3), fontSize: `${T.scale.small.sizePx}px`, marginTop: sp(1), flexWrap: 'wrap' }}>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, backgroundColor: C.brand, marginRight: 4 }} />
              {L.progressLegendStudent}
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, backgroundColor: C.sky, marginRight: 4 }} />
              {L.progressLegendTeacher}
            </span>
          </div>
          <details style={{ marginTop: sp(2) }}>
            <summary style={{ cursor: 'pointer' }}>{L.tableView}</summary>
            <table style={{ borderCollapse: 'collapse', fontSize: `${T.scale.small.sizePx}px`, marginTop: sp(1) }}>
              <thead>
                <tr>
                  {[L.colMinute, L.colStudent, L.colTeacher, L.colExchanges, L.colStage].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: `2px ${sp(2)}`, borderBottom: border }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.minutes.map((m) => (
                  <tr key={m.minute}>
                    <td style={{ padding: `2px ${sp(2)}` }}>{m.minute + 1}</td>
                    <td style={{ padding: `2px ${sp(2)}` }}>{Math.round(m.student_ms / 1000)}</td>
                    <td style={{ padding: `2px ${sp(2)}` }}>{Math.round(m.teacher_ms / 1000)}</td>
                    <td style={{ padding: `2px ${sp(2)}` }}>{m.exchanges}</td>
                    <td style={{ padding: `2px ${sp(2)}` }}>{stageTitle(m.activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Box>
  );
}

/* ---------- next lesson ---------- */

export function NextLessonBox(p: { plan: LessonPlan }): React.ReactElement {
  const idx = LESSON_PLANS.findIndex((x) => x.id === p.plan.id);
  const next = idx >= 0 ? LESSON_PLANS[idx + 1] : undefined;
  return (
    <Box title={L.nextLessonTitle} tone="tinted" testId="director-next-lesson">
      {next ? (
        <div>
          <strong>{next.titleKo}</strong>
          <ol style={{ margin: `${sp(1)} 0 0`, paddingLeft: sp(4) }}>
            {next.stages.slice(0, 3).map((s) => (
              <li key={s.id}>{s.titleKo}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p style={{ margin: 0 }}>{L.nextLessonNone}</p>
      )}
    </Box>
  );
}
