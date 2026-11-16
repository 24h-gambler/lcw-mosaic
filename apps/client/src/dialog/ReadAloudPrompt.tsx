import React, { useEffect, useMemo, useRef, useState } from 'react';
import { feedbackLine, live } from './strings.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { MicController, type MicView } from './mic-controller.js';
import { cancelMicCue, micClosed, micCue, playSfx, unlockDialogAudio } from './sound.js';
import type { SpeechEngine } from './speech.js';
import { createDialogSpeechEngine } from './server-stt.js';
import { readStudentToken, SubmitError, type SoloPlayerRef } from './submit.js';
import { noteSeatResponse } from '../world/seat.js';

/** The App loads this module lazily; the trade shop's furniture offers come with it (one slot, docs/19 3장). */
export { furnitureOffersFor } from './hints.js';

/**
 * docs/08 8.3 build screen line: the room check's missing-condition sentence with a [소리 내어 읽기] button
 * (docs/03 D13). The child reads it aloud; the server checks the reading and grants 10% off that furniture kind once
 * a day, spent automatically on the next purchase of that kind at the trade shop. Guests can read it for practice
 * but nothing is granted (no server record for them).
 */

const R = live('readAloud');
const D = live('dialog');

export type FurnitureKind = 'light' | 'rest' | 'flat';

export interface ReadAloudResultView {
  pass: boolean;
  discount_pct: number;
  already_claimed: boolean;
  feedback_ko: string;
}

type Fetch = typeof fetch;

export async function postReadAloud(opts: {
  token: string;
  kind: FurnitureKind;
  transcript: string;
  sttSource: string;
  confidence: number;
  durMs: number;
  baseUrl?: string;
  fetchImpl?: Fetch;
}): Promise<ReadAloudResultView> {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(`${opts.baseUrl ?? ''}/v1/furniture/read-aloud`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ kind: opts.kind, transcript: opts.transcript, stt_source: opts.sttSource, confidence: opts.confidence, dur_ms: opts.durMs })
    });
  } catch (err) {
    throw new SubmitError('network', err instanceof Error ? err.message : String(err));
  }
  // a paused seat is not an error: the shell shows the seat card (world/seat.ts)
  if (res.status === 403 && (await noteSeatResponse(res))) throw new SubmitError('auth', 'seat_inactive');
  if (res.status === 401 || res.status === 403) throw new SubmitError('auth', `status ${res.status}`);
  if (!res.ok) throw new SubmitError(res.status === 400 ? 'invalid' : 'server', `status ${res.status}`);
  const j = (await res.json()) as Partial<ReadAloudResultView>;
  return {
    pass: j.pass === true,
    discount_pct: typeof j.discount_pct === 'number' ? j.discount_pct : 0,
    already_claimed: j.already_claimed === true,
    feedback_ko: typeof j.feedback_ko === 'string' ? j.feedback_ko : ''
  };
}

export interface ReadAloudPromptProps {
  kind: FurnitureKind;
  /** The English sentence the world's room check shows (same table as the server, sim-core ROOM_MISSING_SENTENCES). */
  sentence: string;
  player?: SoloPlayerRef;
  speech?: SpeechEngine;
  baseUrl?: string;
  fetchImpl?: Fetch;
  onResult?: (r: ReadAloudResultView) => void;
}

export function ReadAloudPrompt(props: ReadAloudPromptProps): React.ReactElement {
  const { kind, sentence, player, baseUrl, fetchImpl, onResult } = props;
  const engine = useMemo(() => props.speech ?? createDialogSpeechEngine(), [props.speech]);
  const ok = useMemo(() => engine.availability().ok, [engine]);
  const [mic, setMic] = useState<MicView>({ recording: false, interim: '', hangover: false, level: 0 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReadAloudResultView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ctrl = useRef<MicController | null>(null);
  const pending = useRef(false);
  // The shell re-renders often and passes fresh objects/callbacks; keep the mic controller alive across them.
  const latest = useRef({ player, baseUrl, fetchImpl, onResult });
  latest.current = { player, baseUrl, fetchImpl, onResult };
  const kindKo = R.kind[kind] ?? kind;

  useEffect(() => {
    const c = new MicController(engine, {
      onView: (v) => {
        setMic(v);
        if (!v.recording) micClosed();
      },
      onFinal: (r, durMs) => {
        playSfx('dlg.mic_off');
        if (!r) {
          setNote(D.noSpeech);
          return;
        }
        const { player, baseUrl, fetchImpl, onResult } = latest.current;
        const token = readStudentToken() || player?.deviceToken || '';
        if (!token) {
          setNote(D.practiceNote);
          return;
        }
        setBusy(true);
        void postReadAloud({ token, kind, transcript: r.transcript, sttSource: engine.source, confidence: r.confidence, durMs, baseUrl, fetchImpl })
          .then((res) => {
            setResult(res);
            setNote(null);
            if (res.discount_pct > 0) playSfx('coin.drop');
            else if (!res.pass) playSfx('ui.click');
            onResult?.(res);
          })
          .catch(() => setNote(D.networkError))
          .finally(() => setBusy(false));
      },
      onIssue: (issue) => setNote(issue === 'no_speech' ? D.noSpeech : D.micUnsupported)
    });
    ctrl.current = c;
    return () => {
      if (pending.current) cancelMicCue();
      pending.current = false;
      if (c.recording) micClosed();
      c.dispose();
    };
  }, [engine, kind]);

  const tap = () => {
    unlockDialogAudio();
    const c = ctrl.current;
    if (!c || busy) return;
    if (!c.recording) {
      if (pending.current) {
        pending.current = false;
        cancelMicCue();
        return;
      }
      setResult(null);
      setNote(null);
      // docs/12 3장: 150 ms, the rising cue, then record.
      pending.current = true;
      void micCue().then((ok) => {
        if (!pending.current) return;
        pending.current = false;
        if (ok && ctrl.current === c && !c.recording) c.tap();
      });
      return;
    }
    c.tap();
  };

  return (
    <div
      className="lcw-readaloud"
      role="group"
      aria-label={R.cta}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        background: C['paper-50'],
        color: C['ink-900'],
        border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
        borderRadius: S.radiusCardPx,
        boxShadow: S.shadowDefault,
        padding: '10px 14px',
        fontFamily: T.fonts.ui,
        pointerEvents: 'auto',
        maxWidth: 'min(720px, calc(100vw - 24px))'
      }}
    >
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div lang="en" style={{ fontFamily: T.fonts.target, fontSize: Math.max(22, T.scale.h3.sizePx), fontWeight: 800, lineHeight: 1.25 }}>
          “{sentence}”
        </div>
        <div style={{ fontSize: T.scale.small.sizePx, color: C['ink-700'], marginTop: 4 }} aria-live="polite">
          {mic.recording ? R.listening : result ? feedbackLine(result.feedback_ko).text : note ?? R.hint.replace('{kind}', kindKo)}
          {result && !mic.recording && feedbackLine(result.feedback_ko).help ? <div lang="ko">{feedbackLine(result.feedback_ko).help}</div> : null}
          {result && result.discount_pct > 0 ? <div style={{ fontWeight: 700, color: C['leaf-d'] }}>{R.where}</div> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={tap}
        disabled={!ok || busy}
        data-on={mic.recording}
        style={{
          minHeight: S.touchTargetMinPx,
          padding: '8px 16px',
          background: mic.recording ? C.danger : C['brand-d'],
          color: C['paper-0'],
          border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
          borderRadius: S.radiusButtonPx,
          boxShadow: S.shadowDefault,
          fontWeight: 800,
          fontSize: T.scale.body.sizePx,
          cursor: 'pointer'
        }}
      >
        {mic.recording ? `⏹ ${D.micStop}` : `🎤 ${R.cta}`}
      </button>
    </div>
  );
}
