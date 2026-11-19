/**
 * One English line said into the microphone (or typed when there is no microphone) for a trade step (WP-509: both
 * sides speak before a trade goes through, Dan R326 ⑫). The server scores what was said; this only captures it.
 * Same microphone path as the read-aloud line (dialog/mic-controller, the dialog's speech engine).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MicController, type MicView } from '../../dialog/mic-controller.js';
import { createDialogSpeechEngine } from '../../dialog/server-stt.js';
import { micClosed, micCue, unlockDialogAudio } from '../../dialog/sound.js';
import type { SpeechEngine } from '../../dialog/speech.js';
import { say } from '../../world/lang.js';
import { SHOP_STRINGS as S } from '../shop-strings.js';

export interface Said {
  transcript: string;
  stt_source: string;
  confidence: number;
}

export function SayLine(props: { line: string; onSaid(s: Said): void; onCancel(): void; speech?: SpeechEngine; note?: string | null }): React.ReactElement {
  const { line, onSaid, onCancel, note } = props;
  const engine = useMemo(() => props.speech ?? createDialogSpeechEngine(), [props.speech]);
  const micOk = useMemo(() => engine.availability().ok, [engine]);
  const [mic, setMic] = useState<MicView>({ recording: false, interim: '', hangover: false, level: 0 });
  const [typed, setTyped] = useState('');
  /** Typing is always there too (no microphone, a noisy room, a child who would rather write). */
  const [typing, setTyping] = useState(false);
  const ctrl = useRef<MicController | null>(null);
  const latest = useRef(onSaid);
  latest.current = onSaid;

  useEffect(() => {
    const c = new MicController(engine, {
      onView: (v) => {
        setMic(v);
        if (!v.recording) micClosed();
      },
      onFinal: (r) => {
        if (r && r.transcript.trim()) latest.current({ transcript: r.transcript, stt_source: engine.source, confidence: r.confidence });
      },
      onIssue: () => undefined
    });
    ctrl.current = c;
    return () => {
      if (c.recording) micClosed();
      c.dispose();
    };
  }, [engine]);

  const tap = (): void => {
    unlockDialogAudio();
    const c = ctrl.current;
    if (!c) return;
    if (c.recording) {
      c.tap();
      return;
    }
    void micCue().then((ok) => {
      if (ok && ctrl.current === c && !c.recording) c.tap();
    });
  };

  return (
    <div className="lcw-sayline" role="group" aria-label={say(S.sayLine).text}>
      <span>{say(S.sayLine).text}</span>
      <strong lang="en">“{line}”</strong>
      {mic.recording && mic.interim ? <span lang="en">{mic.interim}</span> : null}
      {note ? <span role="status">{note}</span> : null}
      <div className="row">
        {micOk && !typing ? (
          <>
            <button type="button" className="btn pri" onClick={tap} data-on={mic.recording}>
              {mic.recording ? `⏹ ${say(S.sayDone).text}` : `🎤 ${say(S.sayMic).text}`}
            </button>
            <button type="button" className="btn" data-testid="sayline-type" onClick={() => setTyping(true)}>
              ⌨️ {say(S.sayType).text}
            </button>
          </>
        ) : (
          <>
            <input lang="en" aria-label={say(S.sayType).text} placeholder={say(S.sayType).text} value={typed} onChange={(e) => setTyped(e.target.value)} />
            <button type="button" className="btn pri" disabled={!typed.trim()} onClick={() => onSaid({ transcript: typed, stt_source: 'typed', confidence: 1 })}>
              {say(S.sayDone).text}
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          {say(S.cancelStep).text}
        </button>
      </div>
    </div>
  );
}
