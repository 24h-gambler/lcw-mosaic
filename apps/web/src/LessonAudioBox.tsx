/**
 * Director console: "수업 소리 내보내기" (WP-307 publisher). The teacher sends the lesson sound one way to the
 * guardians who opened the lesson window: the teacher's mic, plus optionally a second input that carries the student
 * (a call app through a virtual audio cable, or a second mic) mixed into the same track (docs/12 §9). Nothing is
 * recorded; the box shows how many guardians are listening right now.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createFamilyApi } from './familyApi.js';
import { browserRtcEnv, publishLessonAudio, type Publisher, type PublishState, type RtcEnv } from './lessonAudio.js';
import { Box, inputStyle, sp } from './lessonUi.js';
import { LESSON_AUDIO_STRINGS_KO as A } from './lessonAudioStrings.js';

const C = TOKENS.colors;
const T = TOKENS.typography;
const small: React.CSSProperties = { fontSize: `${T.scale.small.sizePx}px`, lineHeight: `${T.scale.small.lineHeightPx}px`, color: C['ink-700'] };

export interface LessonAudioBoxProps {
  token: string;
  lessonId: string;
  /** Lesson ended: stop sending. */
  disabled: boolean;
  api?: Parameters<typeof publishLessonAudio>[0]['api'];
  env?: RtcEnv | null;
  listDevices?: () => Promise<MediaDeviceInfo[]>;
}

export function publishErrorText(code: string): string {
  if (code === 'mic_denied') return A.micDenied;
  if (code === 'no_microphone') return A.noMic;
  if (code === 'realtime_not_configured') return A.notConfigured;
  if (code === 'lesson_not_live') return A.lessonEnded;
  return A.failed;
}

const defaultList = async (): Promise<MediaDeviceInfo[]> => {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
};

export function LessonAudioBox(p: LessonAudioBoxProps): React.ReactElement {
  const env = p.env === undefined ? browserRtcEnv() : p.env;
  const api = useRef(p.api ?? createFamilyApi());
  const pub = useRef<Publisher | null>(null);
  const [st, setSt] = useState<PublishState>({ state: 'stopped' });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState('');
  const [second, setSecond] = useState('');
  const [level, setLevel] = useState(0);

  const refreshDevices = async () => setDevices(await (p.listDevices ?? defaultList)());
  useEffect(() => {
    void refreshDevices();
  }, []);

  const start = async () => {
    if (!env) return;
    await pub.current?.stop();
    pub.current = await publishLessonAudio({
      api: api.current,
      op: p.token,
      lessonId: p.lessonId,
      ...(mic ? { micId: mic } : {}),
      ...(second ? { secondId: second } : {}),
      env,
      onState: setSt
    });
    void refreshDevices();
  };
  const stop = async () => {
    await pub.current?.stop();
    pub.current = null;
  };

  useEffect(() => {
    if (p.disabled) void stop();
  }, [p.disabled]);
  useEffect(() => () => void pub.current?.stop(), []);
  useEffect(() => {
    if (st.state !== 'live') {
      setLevel(0);
      return undefined;
    }
    const id = setInterval(() => setLevel(pub.current?.level() ?? 0), 200);
    return () => clearInterval(id);
  }, [st.state]);

  const live = st.state === 'live';
  const busy = st.state === 'starting';
  const label = (d: MediaDeviceInfo, i: number) => d.label || A.micN(i + 1);

  return (
    <Box title={A.title} testId="director-audio">
      <div style={{ display: 'grid', gap: sp(2) }}>
        <p style={{ ...small, margin: 0 }}>{A.help}</p>
        {!env ? <p style={{ ...small, margin: 0 }}>{A.unsupported}</p> : null}
        <label style={{ display: 'grid', gap: sp(1), ...small }}>
          {A.micLabel}
          <select value={mic} onChange={(e) => setMic(e.target.value)} disabled={live || busy} style={inputStyle} data-testid="audio-mic">
            <option value="">{A.micDefault}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {label(d, i)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: sp(1), ...small }}>
          {A.secondLabel}
          <select value={second} onChange={(e) => setSecond(e.target.value)} disabled={live || busy} style={inputStyle} data-testid="audio-second">
            <option value="">{A.secondNone}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {label(d, i)}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
          {live || busy ? (
            <Button type="button" variant="paper" onClick={() => void stop()} data-testid="audio-stop">
              {A.stop}
            </Button>
          ) : (
            <Button type="button" variant="sky" disabled={p.disabled || !env} onClick={() => void start()} data-testid="audio-start">
              {A.start}
            </Button>
          )}
          {live ? (
            <span
              aria-hidden="true"
              data-testid="audio-meter"
              style={{ display: 'inline-block', width: '120px', height: '10px', borderRadius: '5px', background: C['paper-50'], overflow: 'hidden' }}
            >
              <span style={{ display: 'block', height: '100%', width: `${Math.round(level * 100)}%`, background: C['leaf-d'], transition: 'width 120ms linear' }} />
            </span>
          ) : null}
        </div>
        {busy ? <p style={{ ...small, margin: 0 }} role="status">{A.starting}</p> : null}
        {live ? (
          <p style={{ ...small, margin: 0, fontWeight: 700, color: C['ink-900'] }} role="status" data-testid="audio-live">
            {A.live(st.listeners)}
          </p>
        ) : null}
        {live && st.mixFallback ? <p style={{ ...small, margin: 0 }} data-testid="audio-mix-fallback">{A.mixFallback}</p> : null}
        {st.state === 'failed' ? (
          <p style={{ ...small, margin: 0, color: C['ink-900'] }} role="alert" data-testid="audio-failed">
            {publishErrorText(st.error)}
          </p>
        ) : null}
      </div>
    </Box>
  );
}
