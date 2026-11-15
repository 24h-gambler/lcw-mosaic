/**
 * "소리 듣기" box of the parent lesson window (WP-307). Receive-only: one tap starts listening to the sound the
 * teacher's console publishes; this component never asks for a microphone (lessonAudio.ts listenLessonAudio).
 * It reconnects by itself when the window poll says the stream changed (teacher republished) or the server hung
 * this listener up, and stops when the stream is gone.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import type { FamilyApi, LessonWindowPayload } from './familyApi.js';
import { browserRtcEnv, listenLessonAudio, primeAudio, type Listener, type ListenState, type RtcEnv } from './lessonAudio.js';
import { Box, sp } from './lessonUi.js';
import { PARENT_STRINGS_KO } from './parentStrings.js';

const W = PARENT_STRINGS_KO.window;
const C = TOKENS.colors;
const T = TOKENS.typography;
const small: React.CSSProperties = { fontSize: `${T.scale.small.sizePx}px`, lineHeight: `${T.scale.small.lineHeightPx}px`, color: C['ink-700'] };

export interface LessonListenProps {
  api: FamilyApi;
  guardian: string;
  playerId: string;
  audio: LessonWindowPayload['audio'];
  /** The window poll sends this id so the server counts this guardian as listening. */
  onListener: (id: string | null) => void;
  env?: Pick<RtcEnv, 'RTCPeerConnection' | 'MediaStream'> | null;
}

export function listenErrorText(code: string): string {
  if (code === 'no_teacher_stream') return W.audioNoStream;
  if (code === 'too_many_listeners') return W.audioTooMany;
  if (code === 'lesson_window_consent_required') return W.audioConsent;
  return W.audioFailed;
}

export function LessonListen(p: LessonListenProps): React.ReactElement {
  const env = p.env === undefined ? browserRtcEnv() : p.env;
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const listener = useRef<Listener | null>(null);
  const want = useRef(false);
  const streamRef = useRef<string | null>(null);
  const [st, setSt] = useState<ListenState>({ state: 'stopped' });
  const [volume, setVolume] = useState(1);

  const connect = useCallback(async () => {
    if (!env || !audioEl.current) return;
    await listener.current?.stop();
    listener.current = null;
    p.onListener(null);
    const l = await listenLessonAudio({
      api: p.api,
      guardian: p.guardian,
      playerId: p.playerId,
      audio: audioEl.current,
      env,
      onState: (s) => {
        setSt(s);
        if (s.state === 'listening') {
          streamRef.current = s.streamId;
          p.onListener(s.listenerId);
        }
        if (s.state === 'failed') p.onListener(null);
      }
    });
    listener.current = l;
  }, [env, p.api, p.guardian, p.playerId]);

  const stop = useCallback(async () => {
    want.current = false;
    p.onListener(null);
    await listener.current?.stop();
    listener.current = null;
    setSt({ state: 'stopped' });
  }, []);

  // Follow the window poll: stream gone → stop; new stream or this listener hung up → reconnect once.
  useEffect(() => {
    if (!want.current) return;
    if (!p.audio.available) {
      p.onListener(null);
      void listener.current?.stop();
      listener.current = null;
      setSt({ state: 'stopped' });
      return;
    }
    const changed = p.audio.stream_id && streamRef.current && p.audio.stream_id !== streamRef.current;
    if (changed || p.audio.listener === 'closed') void connect();
  }, [p.audio.available, p.audio.stream_id, p.audio.listener]);

  useEffect(() => {
    // Closing the tab: hang up at once (keepalive survives the unload) so the teacher's count drops now,
    // not 35 s later when the listener goes stale.
    const onHide = () => {
      const id = listener.current?.listenerId;
      if (!id || typeof fetch !== 'function') return;
      void fetch(`/v1/family/children/${encodeURIComponent(p.playerId)}/lesson-window/audio/${id}`, {
        method: 'DELETE',
        keepalive: true,
        headers: { authorization: `Bearer ${p.guardian}` }
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      want.current = false;
      void listener.current?.stop();
    };
  }, [p.playerId, p.guardian]);

  useEffect(() => {
    if (audioEl.current) audioEl.current.volume = volume;
  }, [volume]);

  const live = st.state === 'listening';
  const note = !p.audio.available
    ? p.audio.reason === 'realtime_not_configured'
      ? W.audioOff
      : W.audioNoStream
    : !env
      ? W.audioUnsupported
      : null;

  return (
    <Box title={W.audioTitle} testId="window-audio">
      <div style={{ display: 'grid', gap: sp(2) }}>
        {/* Sound only: no controls, never a video element. */}
        <audio ref={audioEl} data-testid="window-audio-el" />
        {note ? <p style={{ ...small, margin: 0 }}>{note}</p> : null}
        {p.audio.available && env ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
            {live || st.state === 'connecting' ? (
              <Button type="button" variant="paper" onClick={() => void stop()} data-testid="listen-stop">
                {W.audioStop}
              </Button>
            ) : (
              <Button
                type="button"
                variant="brand"
                data-testid="listen-start"
                onClick={() => {
                  want.current = true;
                  // Inside the tap: iOS allows later playback only if play() started here.
                  if (audioEl.current && env) primeAudio(audioEl.current, env);
                  void connect();
                }}
              >
                {W.audioStart}
              </Button>
            )}
            {live ? (
              <label style={{ ...small, display: 'flex', alignItems: 'center', gap: sp(1) }}>
                {W.audioVolume}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  data-testid="listen-volume"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {st.state === 'connecting' ? <p style={{ ...small, margin: 0 }} role="status">{W.audioConnecting}</p> : null}
        {live ? (
          <p style={{ ...small, margin: 0, color: C['leaf-d'], fontWeight: 700 }} role="status" data-testid="listen-live">
            {W.audioListening}
          </p>
        ) : null}
        {st.state === 'failed' ? (
          <p style={{ ...small, margin: 0, color: C['ink-900'] }} role="alert" data-testid="listen-failed">
            {listenErrorText(st.error)}
          </p>
        ) : null}
        <p style={{ ...small, margin: 0 }}>{W.audioPrivacy}</p>
      </div>
    </Box>
  );
}
