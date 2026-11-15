/**
 * "아이 목소리로 다시 듣기" under a report (edge voice.ts, docs/02 §10). Shown only on a device where the child's
 * guardian is signed in (/family stored `lcw.guardianToken`): the server answers the clip list to that guardian only,
 * with signed URLs that live 15 minutes. Someone who got the forwarded link sees nothing here; the teacher's preview
 * never asks. When a URL has expired (page left open), the list is fetched again once.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createFamilyApi, loadGuardianToken, type ReportClips } from './familyApi.js';
import { LessonApiError } from './lessonApi.js';
import { kstLabel } from './lessonFlow.js';
import { border, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const P = PARENT_STRINGS_KO.report;
const C = TOKENS.colors;
const T = TOKENS.typography;
const px = (n: number) => `${n}px`;
const small: React.CSSProperties = { fontSize: px(T.scale.small.sizePx), lineHeight: px(T.scale.small.lineHeightPx), color: C['ink-700'] };

export type VoiceLoad = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: ReportClips } | { status: 'error' };

export interface VoiceClipsProps {
  /** Report share token (the /r/<token> part). */
  token: string;
  /** Test seams. */
  guardianToken?: string | null;
  load?: (g: string, token: string) => Promise<ReportClips>;
  initial?: VoiceLoad;
}

export function VoiceClips({ token, guardianToken, load, initial }: VoiceClipsProps): React.ReactElement | null {
  const g = guardianToken === undefined ? loadGuardianToken() : guardianToken;
  const loader = useRef(load ?? ((gt: string, t: string) => createFamilyApi().reportClips(gt, t)));
  const [state, setState] = useState<VoiceLoad>(initial ?? { status: g ? 'loading' : 'idle' });
  const refetched = useRef(false);

  const fetchClips = useCallback(async () => {
    if (!g) return;
    setState({ status: 'loading' });
    try {
      setState({ status: 'ok', data: await loader.current(g, token) });
    } catch (e) {
      // 401/404: not this family's report on this device (a forwarded link) — show nothing.
      const status = e instanceof LessonApiError ? e.status : 0;
      setState(status === 401 || status === 403 || status === 404 ? { status: 'idle' } : { status: 'error' });
    }
  }, [g, token]);

  useEffect(() => {
    if (!initial && g) void fetchClips();
  }, [fetchClips, initial, g]);

  if (!g || state.status === 'idle' || state.status === 'loading') return null;
  return (
    <section
      data-testid="report-voice"
      style={{
        backgroundColor: C['paper-0'],
        color: C['ink-900'],
        border,
        borderRadius: px(TOKENS.shape.radiusCardPx),
        boxShadow: TOKENS.shape.shadowDefault,
        padding: sp(4),
        borderTop: `${sp(1)} solid ${C.sky}`,
        minWidth: 0
      }}
    >
      <h2 style={{ margin: `0 0 ${sp(1)}`, fontSize: px(T.scale.h3.sizePx), lineHeight: px(T.scale.h3.lineHeightPx) }}>{P.voiceTitle}</h2>
      <p style={{ ...small, margin: `0 0 ${sp(3)}` }}>{P.voiceNote}</p>
      {state.status === 'error' ? (
        <div style={{ display: 'grid', gap: sp(2), justifyItems: 'start' }}>
          <p role="alert" style={{ margin: 0 }}>
            {P.voiceError}
          </p>
          <Button type="button" variant="paper" onClick={() => void fetchClips()}>
            {P.voiceRetry}
          </Button>
        </div>
      ) : !state.data.voice_store ? (
        <p data-testid="report-voice-off" style={{ margin: 0 }}>
          {P.voiceOff}
        </p>
      ) : state.data.clips.length === 0 ? (
        <p data-testid="report-voice-empty" style={{ margin: 0 }}>
          {P.voiceEmpty}
        </p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(3) }}>
          {state.data.clips.map((c) => (
            <li
              key={c.id}
              data-testid={`report-voice-${c.id}`}
              style={{
                borderLeft: `${sp(1)} solid ${C.sky}`,
                backgroundColor: C['paper-50'],
                borderRadius: `0 ${px(TOKENS.shape.radiusCardPx)} ${px(TOKENS.shape.radiusCardPx)} 0`,
                padding: `${sp(2)} ${sp(3)}`,
                display: 'grid',
                gap: sp(1),
                minWidth: 0
              }}
            >
              {c.text ? (
                <span lang="en" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                  “{c.text}”
                </span>
              ) : null}
              <span style={small}>{P.voiceAt(kstLabel(c.at))}</span>
              <audio
                controls
                preload="none"
                src={c.url}
                style={{ width: '100%', minHeight: px(TOKENS.shape.touchTargetMinPx) }}
                onError={() => {
                  // Signed URLs live 15 minutes: fetch fresh ones once when the page sat open longer.
                  if (refetched.current) return;
                  refetched.current = true;
                  void fetchClips();
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
