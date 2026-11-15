/**
 * Parent lesson window (WP-307, docs/08 P04): status bar (place · situation), scene icon and goal sentence from the
 * 10-second text signal, the talk-density band (with a table view) and captions. Listen-only by construction: this
 * page never asks for a microphone or camera and renders no video element; audio, when a teacher stream exists, is
 * receive-only (`audio.direction = 'recvonly'` from the server).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import type { LessonWindowStatus } from '@lcw/schemas';
import {
  createFamilyApi,
  loadGuardianToken,
  type FamilyApi,
  type FamilyChild,
  type LessonWindowCaption,
  type LessonWindowPayload
} from './familyApi.js';
import { errorCodeOf } from './lessonApi.js';
import { Box, LessonStyle, Notice, border, sp } from './lessonUi.js';
import { LessonWindowBar } from './WebUx.js';
import { LessonListen } from './LessonListen.js';
import type { RtcEnv } from './lessonAudio.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const W = PARENT_STRINGS_KO.window;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };

/** Captions kept on screen across polls. */
export const WINDOW_CAPTIONS_KEPT = 30;

/** Merge new captions by id, oldest first, keeping the last `keep`. Pure for tests. */
export function mergeCaptions(prev: readonly LessonWindowCaption[], next: readonly LessonWindowCaption[], keep = WINDOW_CAPTIONS_KEPT): LessonWindowCaption[] {
  const by = new Map(prev.map((c) => [c.id, c]));
  for (const c of next) by.set(c.id, c);
  return [...by.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-keep);
}

/** Share of a minute spent talking, 0..1 (density band shade). */
export const minuteShare = (ms: number) => Math.max(0, Math.min(1, ms / 60_000));

export type WindowLoad =
  | { state: 'loading' }
  | { state: 'no_session' }
  | { state: 'no_child' }
  | { state: 'consent'; child: FamilyChild }
  | { state: 'ok'; child: FamilyChild; data: LessonWindowPayload; receivedAt: number }
  | { state: 'error'; child: FamilyChild | null };

export function DensityBand({ minutes }: { minutes: LessonWindowPayload['minutes'] }): React.ReactElement {
  const [table, setTable] = useState(false);
  const cell = 4;
  const rowH = 18;
  const width = Math.max(1, minutes.length) * cell;
  return (
    <div data-testid="density-band" style={{ display: 'grid', gap: sp(2) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: px(T.scale.h3.sizePx) }}>{W.densityTitle}</h2>
        <Button type="button" variant="paper" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? W.showChart : W.showTable}
        </Button>
      </div>
      {minutes.length === 0 ? (
        <p style={{ ...small, margin: 0 }}>{W.densityEmpty}</p>
      ) : table ? (
        <div style={{ maxHeight: '240px', overflowY: 'auto', border, borderRadius: px(TOKENS.shape.radiusCardPx) }}>
          <table data-testid="density-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: px(T.scale.small.sizePx) }}>
            <thead>
              <tr>
                {[W.minuteCol, W.childCol, W.teacherCol].map((h) => (
                  <th key={h} scope="col" style={{ textAlign: 'left', padding: sp(1), borderBottom: border, position: 'sticky', top: 0, background: C['paper-50'] }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {minutes.map((m) => (
                <tr key={m.minute}>
                  <td style={{ padding: sp(1) }}>{m.minute + 1}</td>
                  <td style={{ padding: sp(1) }}>{Math.round(m.student_ms / 1000)}</td>
                  <td style={{ padding: sp(1) }}>{Math.round(m.teacher_ms / 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            role="img"
            aria-label={`${W.densityTitle}: ${minutes.length}분`}
            width={width}
            height={rowH * 2 + 2}
            viewBox={`0 0 ${width} ${rowH * 2 + 2}`}
            style={{ display: 'block', background: C['paper-0'] }}
          >
            {minutes.map((m, i) => (
              <g key={m.minute}>
                <rect x={i * cell} y={0} width={cell - 1} height={rowH} fill={C.brand} fillOpacity={0.12 + 0.88 * minuteShare(m.student_ms)} />
                <rect x={i * cell} y={rowH + 2} width={cell - 1} height={rowH} fill={C.sky} fillOpacity={0.12 + 0.88 * minuteShare(m.teacher_ms)} />
              </g>
            ))}
          </svg>
        </div>
      )}
      <div style={{ display: 'flex', gap: sp(3), flexWrap: 'wrap', ...small }}>
        <span>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, background: C.brand, marginRight: 4, verticalAlign: 'middle' }} />
          {W.densityLegendChild}
        </span>
        <span>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, background: C.sky, marginRight: 4, verticalAlign: 'middle' }} />
          {W.densityLegendTeacher}
        </span>
      </div>
      <p style={{ ...small, margin: 0 }}>{W.densityNote}</p>
    </div>
  );
}

export function Captions({ captions }: { captions: readonly LessonWindowCaption[] }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gap: sp(2) }}>
      <h2 style={{ margin: 0, fontSize: px(T.scale.h3.sizePx) }}>{W.captionsTitle}</h2>
      {captions.length === 0 ? (
        <p style={{ ...small, margin: 0 }}>{W.captionsEmpty}</p>
      ) : (
        <ol data-testid="captions" aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(2) }}>
          {captions.map((c) => (
            <li
              key={c.id}
              style={{
                borderLeft: `4px solid ${c.who === 'child' ? C.brand : C.sky}`,
                padding: `${sp(1)} ${sp(2)}`,
                background: c.who === 'child' ? C['paper-50'] : C['paper-0']
              }}
            >
              <div style={{ ...small, fontWeight: 700, color: C['ink-900'] }}>
                {c.speaker_ko}
                {c.who === 'child' ? <span style={{ fontWeight: 400, marginLeft: sp(2), color: c.pass ? C['leaf-d'] : C['ink-700'] }}>{c.pass ? W.passed(c.stars ?? 0) : W.notPassed}</span> : null}
              </div>
              <div lang="en" style={{ fontFamily: T.fonts.target, fontSize: px(T.scale.body.sizePx) }}>
                {c.text}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p style={{ ...small, margin: 0 }}>{W.captionsNote}</p>
    </div>
  );
}

export interface LessonWindowPageProps {
  api?: FamilyApi;
  initial?: WindowLoad;
  /** For tests: fixed clock. */
  nowMs?: number;
  /** For tests: WebRTC stand-ins (null = no WebRTC in this browser). */
  rtcEnv?: Pick<RtcEnv, 'RTCPeerConnection' | 'MediaStream'> | null;
}

const childFromQuery = () => {
  try {
    return new URLSearchParams(window.location.search).get('child');
  } catch {
    return null;
  }
};

export function LessonWindowPage({ api, initial, nowMs, rtcEnv }: LessonWindowPageProps): React.ReactElement {
  const apiRef = useRef<FamilyApi>(api ?? createFamilyApi());
  const [load, setLoad] = useState<WindowLoad>(initial ?? { state: 'loading' });
  const [captions, setCaptions] = useState<LessonWindowCaption[]>(initial?.state === 'ok' ? initial.data.captions : []);
  const [now, setNow] = useState(nowMs ?? Date.now());
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const lastAt = useRef(0);
  const listenerRef = useRef<string | null>(null);

  const poll = useCallback(async (child: FamilyChild) => {
    const g = tokenRef.current;
    if (!g) return;
    try {
      const data = await apiRef.current.lessonWindow(g, child.player_id, lastAt.current, listenerRef.current);
      if (!data.live) {
        lastAt.current = 0;
        setCaptions([]);
      } else {
        setCaptions((prev) => {
          const merged = mergeCaptions(prev, data.captions);
          lastAt.current = merged.length ? merged[merged.length - 1]!.at : lastAt.current;
          return merged;
        });
      }
      setLoad({ state: 'ok', child, data, receivedAt: Date.now() });
    } catch (e) {
      const code = errorCodeOf(e);
      if (code === 'lesson_window_consent_required') setLoad({ state: 'consent', child });
      else if (code === 'guardian_only') setLoad({ state: 'no_session' });
      else setLoad((prev) => (prev.state === 'ok' ? prev : { state: 'error', child }));
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const g = loadGuardianToken();
      tokenRef.current = g;
      if (!g) return setLoad({ state: 'no_session' });
      let me;
      try {
        me = await apiRef.current.me(g);
      } catch (e) {
        return setLoad(errorCodeOf(e) === 'guardian_only' ? { state: 'no_session' } : { state: 'error', child: null });
      }
      const want = childFromQuery();
      const child = me.children.find((k) => k.player_id === want) ?? me.children[0];
      if (!child) return setLoad({ state: 'no_child' });
      const loop = async () => {
        if (stop) return;
        await poll(child);
        timer = setTimeout(loop, 10_000);
      };
      void loop();
    })();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [initial, poll]);

  const child = 'child' in load ? load.child : null;
  // Staleness uses this device's clock: a status counts as sent when it arrived here.
  const status: LessonWindowStatus | null =
    load.state === 'ok' && load.data.status ? { ...load.data.status, sent_at: load.receivedAt } : null;

  return (
    <main
      className="lcw-lesson"
      data-testid="lesson-window-page"
      style={{ maxWidth: '760px', margin: '0 auto', display: 'grid', gap: sp(4), fontFamily: T.fonts.ui, wordBreak: 'keep-all', color: C['ink-900'] }}
    >
      <LessonStyle />
      <header style={{ display: 'grid', gap: sp(1) }}>
        <h1 style={{ margin: 0, fontSize: px(T.scale.h1.sizePx), lineHeight: px(T.scale.h1.lineHeightPx) }}>{child ? W.title(child.nickname) : W.titlePlain}</h1>
        <p style={{ ...small, margin: 0 }}>{W.lead}</p>
      </header>

      {load.state === 'loading' ? <Box><p style={{ margin: 0 }}>…</p></Box> : null}
      {load.state === 'no_session' ? (
        <Box testId="window-no-session">
          <p style={{ marginTop: 0 }}>{W.noSession}</p>
          <a href="/family">{W.goFamily}</a>
        </Box>
      ) : null}
      {load.state === 'no_child' ? <Box><p style={{ margin: 0 }}>{W.noChild}</p></Box> : null}
      {load.state === 'error' ? <Notice kind="error">{W.error}</Notice> : null}
      {load.state === 'consent' ? (
        <Box title={W.consentTitle} tone="tinted" testId="window-consent">
          <p style={{ marginTop: 0 }}>{W.consentBody}</p>
          <Button
            type="button"
            variant="brand"
            disabled={busy}
            onClick={async () => {
              const g = tokenRef.current;
              if (!g) return;
              setBusy(true);
              try {
                await apiRef.current.setConsent(g, load.child.player_id, 'lesson_window', true);
                await poll(load.child);
              } finally {
                setBusy(false);
              }
            }}
          >
            {W.consentOn}
          </Button>
        </Box>
      ) : null}

      {load.state === 'ok' && !load.data.live ? (
        <Box title={W.idleTitle} testId="window-idle">
          {load.data.next_lesson_at ? <p style={{ margin: 0, fontWeight: 700 }}>{W.nextLesson(load.data.next_lesson_at)}</p> : null}
        </Box>
      ) : null}

      {load.state === 'ok' && load.data.live ? (
        <>
          <LessonWindowBar status={status} nowMs={now} />
          {load.data.started_at ? (
            <p style={{ ...small, margin: 0 }} data-testid="window-elapsed">
              {W.elapsed(Math.max(0, Math.floor((load.data.server_now - load.data.started_at) / 60_000)))}
            </p>
          ) : null}
          <Box>
            <DensityBand minutes={load.data.minutes} />
          </Box>
          <Box>
            <Captions captions={captions} />
          </Box>
          {tokenRef.current ? (
            <LessonListen
              api={apiRef.current}
              guardian={tokenRef.current}
              playerId={load.child.player_id}
              audio={load.data.audio}
              onListener={(id) => {
                listenerRef.current = id;
              }}
              {...(rtcEnv !== undefined ? { env: rtcEnv } : {})}
            />
          ) : (
            <Box title={W.audioTitle} testId="window-audio">
              <p style={{ ...small, margin: 0 }}>{W.audioOff}</p>
            </Box>
          )}
        </>
      ) : null}
    </main>
  );
}
