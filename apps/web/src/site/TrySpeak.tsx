/**
 * The one spoken order of /try (docs/14 §8). Browser speech recognition when it exists; otherwise word cards and,
 * when the mic opens, a loudness check that plays the child's own recording back. Nothing leaves the tab.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  TRY_ANALYSER_INTERVAL_MS,
  TRY_SPEECH_RMS_THRESHOLD,
  bestOfferMatch,
  evaluateSpeechEnergy,
  isSentenceAssembled,
  rmsOfTimeDomain,
  sentenceWords,
  shuffleWords,
  wordHits,
  type EnergySample,
  type TryOffer,
  type TryPath
} from '../tryFlow.js';
import { TRY } from './tryCopy.js';
import { blip, sayEnglish } from './sound.js';
import { track } from './track.js';

/** Silence after speech that ends a take on its own (08 §7.1: 2.5 s). */
export const TRY_AUTO_STOP_SILENCE_MS = 2_500;
export const TRY_MAX_TAKE_MS = 12_000;

type RecLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  start(): void;
  stop(): void;
};

function MicIcon(): React.ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" shapeRendering="crispEdges">
      <rect x="9" y="3" width="6" height="11" />
      <rect x="6" y="10" width="2" height="4" />
      <rect x="16" y="10" width="2" height="4" />
      <rect x="7" y="14" width="10" height="2" />
      <rect x="11" y="16" width="2" height="3" />
      <rect x="8" y="19" width="8" height="2" />
    </svg>
  );
}

export interface TrySpeakProps {
  offers: readonly TryOffer[];
  aim: 1 | 2 | 3;
  path: TryPath;
  /** `recording` is a blob: URL of the child's own take (cards path); the caller owns and revokes it. */
  onDone: (stars: 1 | 2 | 3, text: string, recording: string | null) => void;
  onRepick: () => void;
}

export function TrySpeak({ offers, aim, path: basePath, onDone, onRepick }: TrySpeakProps): React.ReactElement {
  const target = offers.find((o) => o.stars === aim) ?? offers[offers.length - 1]!;
  const [blocked, setBlocked] = useState(false);
  const [useCards, setUseCards] = useState(basePath !== 'recognition');
  const path: TryPath = basePath === 'recognition' && !blocked && !useCards ? 'recognition' : basePath === 'wordcards_only' ? 'wordcards_only' : 'wordcards_with_loudness';
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [passed, setPassed] = useState<1 | 2 | 3 | null>(null);
  const recording = useRef<string | null>(null);
  const recRef = useRef<RecLike | null>(null);
  const micTracked = useRef(false);

  const hits = useMemo(() => (heard === null ? null : wordHits(heard, target.text)), [heard, target.text]);

  useEffect(() => () => recRef.current?.stop(), []);
  useEffect(() => {
    if (passed === null) return undefined;
    const id = setTimeout(() => onDone(passed, (offers.find((o) => o.stars === passed) ?? target).text, recording.current), 1_300);
    return () => clearTimeout(id);
  }, [passed, onDone, offers, target]);

  const finish = (stars: 1 | 2 | 3, rec: string | null = null) => {
    recording.current = rec;
    blip('star');
    setPassed(stars);
  };

  const startRecognition = () => {
    const w = window as unknown as { SpeechRecognition?: new () => RecLike; webkitSpeechRecognition?: new () => RecLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setBlocked(true);
      return;
    }
    const r = new Ctor();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.continuous = false;
    r.onaudiostart = () => {
      if (!micTracked.current) {
        micTracked.current = true;
        track('mic_allowed');
      }
    };
    r.onresult = (e) => {
      const alts = Array.from(e.results[0] ?? []).map((a) => a.transcript);
      let best = bestOfferMatch(alts[0] ?? '', offers);
      let bestText = alts[0] ?? '';
      for (const t of alts.slice(1)) {
        const m = bestOfferMatch(t, offers);
        if (m.stars > best.stars || (m.stars === best.stars && m.ratio > best.ratio)) {
          best = m;
          bestText = t;
        }
      }
      setHeard(bestText);
      if (best.stars > 0) finish(best.stars as 1 | 2 | 3);
      else setMisses((m) => m + 1);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network' || e.error === 'audio-capture') setBlocked(true);
      else if (e.error === 'no-speech') setMisses((m) => m + 1);
    };
    r.onend = () => setListening(false);
    try {
      r.start();
      recRef.current = r;
      setListening(true);
      setHeard(null);
    } catch {
      setBlocked(true);
    }
  };

  return (
    <div className="s-stack" data-testid="try-speak" data-try-path={path}>
      <div className="s-stack" style={{ gap: 6 }}>
        <span className="s-small">{TRY.sayThis}</span>
        <p className="s-target s-paper" lang="en" data-testid="try-target">
          {sentenceWords(target.text).map((w, i) => (
            <React.Fragment key={i}>
              <span className="s-word" data-st={hits ? (hits[i] ? 'ok' : 'miss') : passed ? 'ok' : ''}>
                {w}
              </span>{' '}
            </React.Fragment>
          ))}
        </p>
        <div className="s-row" style={{ gap: 8 }}>
          <button type="button" className="s-listen" onClick={() => sayEnglish(target.text, { force: true, rate: 0.85 })}>
            ▶ {TRY.listen}
          </button>
          <button type="button" className="s-btn s-btn-ghost" onClick={onRepick}>
            {TRY.repick}
          </button>
        </div>
      </div>

      {passed ? (
        <div className="s-note s-ok s-popin" role="status" style={{ fontSize: 18, lineHeight: '28px', fontWeight: 800 }}>
          {'★'.repeat(passed)} {TRY.passed}
        </div>
      ) : path === 'recognition' ? (
        <div className="s-stack" style={{ gap: 10 }}>
          <div className="s-mic">
            <button
              type="button"
              className={`s-btn s-btn-mic ${listening ? 's-btn-sun' : 's-btn-brand'}`}
              onClick={listening ? () => recRef.current?.stop() : startRecognition}
              aria-pressed={listening}
            >
              <MicIcon /> {listening ? TRY.listening : misses > 0 ? TRY.again : TRY.speak}
            </button>
            {listening ? (
              <span className="s-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
          {heard !== null && !passed ? (
            <p className="s-note" role="status" data-testid="heard-text">
              {TRY.heard} <span lang="en">“{heard}”</span> — {TRY.missHint}
            </p>
          ) : null}
          {misses >= 2 ? (
            <button type="button" className="s-btn" onClick={() => setUseCards(true)}>
              {TRY.toCards}
            </button>
          ) : null}
          {blocked ? <p className="s-note s-warn">{TRY.blocked}</p> : null}
        </div>
      ) : (
        <WordCards target={target} withLoudness={path === 'wordcards_with_loudness'} onPassed={(rec) => finish(target.stars, rec)} />
      )}
    </div>
  );
}

function WordCards({
  target,
  withLoudness,
  onPassed
}: {
  target: TryOffer;
  withLoudness: boolean;
  onPassed: (recording: string | null) => void;
}): React.ReactElement {
  const words = useMemo(() => shuffleWords(sentenceWords(target.text), 7), [target.text]);
  const [picked, setPicked] = useState<number[]>([]);
  const assembled = isSentenceAssembled(picked.map((i) => words[i]!), target.text);
  const [rec, setRec] = useState<'idle' | 'on' | 'done'>('idle');
  const [loudOk, setLoudOk] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const [playback, setPlayback] = useState<string | null>(null);
  const h = useRef<{ stream?: MediaStream; ctx?: AudioContext; timer?: ReturnType<typeof setInterval>; recorder?: MediaRecorder; samples: EnergySample[] }>({ samples: [] });
  const done = useRef(false);

  useEffect(() => {
    if (!assembled || done.current) return;
    if (!withLoudness) {
      done.current = true;
      onPassed(null);
    }
  }, [assembled, withLoudness, onPassed]);
  useEffect(() => {
    if (!loudOk || done.current) return undefined;
    // Wait briefly for the recorder to hand over the take so the child can hear themselves afterwards.
    if (h.current.recorder && !playback) {
      const id = setTimeout(() => {
        if (done.current) return;
        done.current = true;
        onPassed(null);
      }, 1_000);
      return () => clearTimeout(id);
    }
    done.current = true;
    onPassed(playback);
    return undefined;
  }, [loudOk, playback, onPassed]);
  useEffect(
    () => () => {
      const x = h.current;
      if (x.timer) clearInterval(x.timer);
      x.stream?.getTracks().forEach((t) => t.stop());
      void x.ctx?.close();
    },
    []
  );

  const stop = () => {
    const x = h.current;
    if (x.timer) clearInterval(x.timer);
    if (x.recorder && x.recorder.state !== 'inactive') x.recorder.stop();
    x.stream?.getTracks().forEach((t) => t.stop());
    void x.ctx?.close();
    setLevel(0);
    setRec('done');
    setLoudOk(evaluateSpeechEnergy(x.samples).passed);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      track('mic_allowed');
      const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const t0 = performance.now();
      const x = h.current;
      x.samples = [];
      x.stream = stream;
      x.ctx = ctx;
      let lastLoud = -1;
      x.timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        const rms = rmsOfTimeDomain(buf);
        const t = performance.now() - t0;
        x.samples.push({ tMs: t, rms });
        setLevel(Math.min(1, rms / (TRY_SPEECH_RMS_THRESHOLD * 4)));
        if (rms >= TRY_SPEECH_RMS_THRESHOLD) lastLoud = t;
        const spoke = evaluateSpeechEnergy(x.samples).passed;
        if ((spoke && lastLoud >= 0 && t - lastLoud > TRY_AUTO_STOP_SILENCE_MS) || t > TRY_MAX_TAKE_MS) stop();
      }, TRY_ANALYSER_INTERVAL_MS);
      if (typeof MediaRecorder !== 'undefined') {
        const chunks: Blob[] = [];
        const r = new MediaRecorder(stream);
        r.ondataavailable = (ev) => chunks.push(ev.data);
        r.onstop = () => {
          if (chunks.length) setPlayback(URL.createObjectURL(new Blob(chunks, { type: r.mimeType })));
        };
        r.start();
        x.recorder = r;
      }
      setRec('on');
    } catch {
      // Mic refused: the cards alone complete the order.
      setLoudOk(true);
    }
  };

  return (
    <div className="s-stack" style={{ gap: 10 }}>
      <span className="s-small">{TRY.cardsHint}</span>
      <div className="s-assembled" lang="en" aria-live="polite" data-testid="assembled-sentence">
        {picked.map((i) => words[i]).join(' ') || ' '}
      </div>
      <div className="s-cards">
        {words.map((w, i) => (
          <button
            key={`${w}-${i}`}
            type="button"
            className="s-wcard"
            lang="en"
            disabled={picked.includes(i) || assembled}
            onClick={() => {
              blip('tap');
              const next = [...picked, i];
              const expect = sentenceWords(target.text)[picked.length]?.toLowerCase().replace(/[.,!?]+$/, '');
              // A wrong card bounces back so the child never ends up with a full but wrong line.
              if (w.toLowerCase().replace(/[.,!?]+$/, '') !== expect) return;
              setPicked(next);
            }}
          >
            {w}
          </button>
        ))}
      </div>
      {assembled && withLoudness && !loudOk ? (
        <div className="s-mic">
          {rec !== 'on' ? (
            <button type="button" className="s-btn s-btn-mic s-btn-brand" onClick={() => void start()}>
              <MicIcon /> {rec === 'done' ? TRY.again : TRY.speakCards}
            </button>
          ) : (
            <button type="button" className="s-btn s-btn-mic s-btn-leaf" onClick={stop}>
              {TRY.stop}
            </button>
          )}
          {rec === 'on' ? (
            <span className="s-level" aria-hidden="true">
              {[0.3, 0.6, 1, 0.6, 0.3].map((f, i) => (
                <i key={i} style={{ height: `${Math.max(4, level * f * 28)}px` }} />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      {rec === 'done' && loudOk === false ? <p className="s-note" role="status">{TRY.louder}</p> : null}
    </div>
  );
}
