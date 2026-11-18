/**
 * Live layer of the director console (WP-305, docs/18): what the student's screen shows right now. The possession,
 * director-event, progress-chart, platform-help and next-lesson boxes were taken off the console in the R2625 trim
 * (no real lesson used them; Dan: "별도로 조종 안해도 됩니다"), see docs/18 §8.
 */
import React from 'react';
import { TOKENS } from '@lcw/ui';
import { getLessonNpc } from '@lcw/content';
import { type DirectorLiveView } from './directorLiveState.js';
import { formatClock } from './lessonFlow.js';
import { Box, Notice, Stat, sp } from './lessonUi.js';
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
  const mismatch = v && v.expected_scene_id && v.scene_id && v.scene_id !== v.expected_scene_id;
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
