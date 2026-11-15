import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ECHO_TRANSITION_LINE, NPC_OPENING_LINES, UI_STRINGS_KO, glossKo } from '@lcw/content';
import { scoreUtterance, understandUtterance } from '@lcw/converse';
import {
  bankOffersFor,
  buildWordCards,
  chunkPhrases,
  convertMixedSpeech,
  distractorsFor,
  heardMask,
  listenAllowed,
  picturesFor,
  renderHintTokens,
  splitWords,
  spokenOffer,
  type MixedSpeech
} from './hints.js';
import { createMediaClipRecorder } from '@lcw/audio';
import { MicController, type MicView } from './mic-controller.js';
import { isKakaoInApp, kakaoOpenExternalUrl, type MicIssue, type SpeechEngine } from './speech.js';
import { createDialogSpeechEngine } from './server-stt.js';
import { cancelMicCue, micClosed, micCue, playAgain, playPass, playSfx, speakEnglish, stopSpeaking, unlockDialogAudio } from './sound.js';
import { DIALOG_CSS } from './styles.js';
import { newDialogId, SubmitError } from './submit.js';
import type { DialogOffer, DialogPanelProps, DialogResult, SttSource, UtteranceSubmit } from './types.js';

export type { DialogOffer, DialogPanelProps, DialogResult, NpcRef, UtteranceSubmit } from './types.js';
export { createLessonSubmit, createSoloSubmit, createSoloSubmitWith } from './submit.js';

const S = UI_STRINGS_KO.dialog;

/** docs/04 4.1: after 2 misses on the same sentence the missed words are underlined; the 3rd miss goes to ECHO. */
export const MISSES_BEFORE_HIGHLIGHT = 2;
export const MISSES_BEFORE_ECHO = 3;
/** docs/04 4.1: two failed captures in a row open the board. */
export const NO_SPEECH_BEFORE_BOARD = 2;
/** docs/08 8.2: "처리 중" turns into "거의 다 됐어요" after 1.5 s. */
export const SLOW_PROCESSING_MS = 1500;
/** Gloss stays this long after the finger lifts (docs/08 8.2: 0.5 s). */
export const GLOSS_LINGER_MS = 500;

type Phase = 'choose' | 'listening' | 'scoring' | 'result' | 'board' | 'keyboard' | 'echo';

const NPC_EMOJI: Record<string, string> = { cafe: '🧑‍🍳', trade_shop: '🧙', guide: '🦊', errand: '👧', exchange: '💰', makers_lab: '🛠️', boutique: '🧥' };

function micIssueText(issue: MicIssue): string {
  if (issue === 'in_app') return S.inAppBrowser;
  if (issue === 'denied') return S.micDenied;
  if (issue === 'no_speech') return S.noSpeech;
  if (issue === 'network') return S.networkError;
  return S.micUnsupported;
}

function starsText(n: number): string {
  return '★'.repeat(n);
}

/** One word of a target sentence as shown on an offer card or in the result. */
function OfferText(props: { offer: DialogOffer; hint: DialogPanelProps['hint']; missed?: ReadonlySet<string> }) {
  const { offer, hint, missed } = props;
  if (hint === 'picture') {
    return <span className="lcw-offer__pic" aria-label={offer.text}>{picturesFor(offer.text).join(' ')}</span>;
  }
  if (hint === 'none') return <span className="lcw-offer__text m">{S.hintLevel.none}</span>;
  const toks = renderHintTokens(offer.text, offer.hintTags, hint);
  return (
    <span className="lcw-offer__text">
      {toks.map((t, i) => {
        // Keywords are marked only when the sentence is reduced to them; on full sentences the tag chips do that job.
        const cls = [t.key && hint === 'keyword' ? 'k' : '', t.shown !== t.word ? 'm' : '', missed?.has(t.norm) ? 'miss' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <React.Fragment key={i}>
            <span className={cls || undefined}>{t.shown}</span>{' '}
          </React.Fragment>
        );
      })}
    </span>
  );
}

function HintTag(props: { tag: string }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gloss = glossKo(props.tag);
  const down = () => {
    if (timer.current) clearTimeout(timer.current);
    setShow(true);
  };
  const up = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), GLOSS_LINGER_MS);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <span
      className="lcw-dlg__tag"
      role="button"
      tabIndex={0}
      aria-label={gloss ? `${props.tag}: ${gloss}` : props.tag}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.tag}
      {show && gloss ? <span className="lcw-dlg__gloss">{gloss}</span> : null}
    </span>
  );
}

export function DialogPanel(props: DialogPanelProps): React.ReactElement {
  const { npc, level, mode, hint, submit, onDone, onClose } = props;
  const onResultRef = useRef(props.onResult);
  onResultRef.current = props.onResult;
  const fontScale = Math.max(1, Math.min(1.5, props.fontScale ?? 1));
  const engine: SpeechEngine = useMemo(() => props.speech ?? createDialogSpeechEngine(), [props.speech]);
  const availability = useMemo(() => engine.availability(), [engine]);
  // voice_store on (the world says so): record the spoken turn for the guardian's replay (clip-recorder.ts).
  const recordClip = props.recordClip === true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  // Offers: from the caller, else the bank for this NPC (docs/19 3). In free mode with nothing given, the first
  // utterance is understood locally into offers (docs/04 4.1 CAPTURE → UNDERSTAND → OFFER).
  const initialOffers = useMemo(
    () => (props.offers.length > 0 ? props.offers : mode === 'free' ? [] : bankOffersFor(npc, level)),
    [props.offers, mode, npc, level]
  );
  const [offers, setOffers] = useState<DialogOffer[]>(initialOffers);
  useEffect(() => setOffers(initialOffers), [initialOffers]);
  const freeTalk = mode === 'free' && props.offers.length > 0;
  const needsUnderstand = mode === 'free' && offers.length === 0;

  const [selected, setSelected] = useState<1 | 2 | 3>(() => (initialOffers[0]?.stars ?? 1) as 1 | 2 | 3);
  const offer = offers.find((o) => o.stars === selected) ?? offers[0];
  const [phase, setPhase] = useState<Phase>(availability.ok ? 'choose' : initialOffers.length > 0 ? 'board' : 'keyboard');
  const [micIssue, setMicIssue] = useState<MicIssue | null>(availability.ok ? null : availability.issue);
  const [notice, setNotice] = useState<string | null>(null);
  const [mic, setMic] = useState<MicView>({ recording: false, interim: '', hangover: false, level: 0 });
  const [heard, setHeard] = useState<MixedSpeech | null>(null);
  const [result, setResult] = useState<DialogResult | null>(null);
  const [lastTarget, setLastTarget] = useState<string>('');
  const [lastSpoken, setLastSpoken] = useState<string>('');
  const [misses, setMisses] = useState<Record<number, number>>({});
  const [missedWords, setMissedWords] = useState<Set<string>>(new Set());
  const [slow, setSlow] = useState(false);
  const [pending, setPending] = useState<UtteranceSubmit | null>(null);
  const [cardsPicked, setCardsPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [echo, setEcho] = useState<{ chunks: string[]; i: number; said: string[]; tries: number } | null>(null);
  const [authLost, setAuthLost] = useState(false);
  // One server-side purchase per opened window: "one more star" and resends after a network error reuse this id.
  const dialogId = useRef(newDialogId());
  // The best passed result of this window. A failed "one more star" try or closing the window still hands the
  // world the item the server already granted and charged for.
  const bestPass = useRef<DialogResult | null>(null);
  const noSpeechRun = useRef(0);
  const readyAt = useRef(Date.now());
  const micStartAt = useRef(0);
  const ctrl = useRef<MicController | null>(null);
  /** Between the tap and the end of the mic cue (recording has not started yet). */
  const micPending = useRef(false);
  const echoRef = useRef(echo);
  echoRef.current = echo;

  const npcLine = props.npcLine ?? NPC_OPENING_LINES[npc.ctx] ?? NPC_OPENING_LINES.guide!;

  // NPC asks on open (docs/12: the mic only opens after the NPC line ends — a tap on the mic cuts the voice first).
  useEffect(() => {
    void speakEnglish(npcLine, level);
    return () => stopSpeaking();
  }, [npcLine, level]);

  const doSubmit = useCallback(
    async (u: UtteranceSubmit) => {
      setPending(u);
      setPhase('scoring');
      setSlow(false);
      setNotice(null);
      const slowTimer = setTimeout(() => setSlow(true), SLOW_PROCESSING_MS);
      try {
        const r = await submit({ ...u, dialogId: dialogId.current });
        setResult(r);
        onResultRef.current?.(r);
        setLastTarget(r.matchedText ?? u.target_text);
        setLastSpoken(u.transcript);
        setPending(null);
        const key = u.chosen_stars;
        if (r.pass) {
          const prev = bestPass.current;
          bestPass.current =
            !prev || r.stars >= prev.stars
              ? { ...r, itemKey: r.itemKey ?? prev?.itemKey, askedKey: r.askedKey ?? prev?.askedKey }
              : { ...prev, coinsTotal: r.coinsTotal ?? prev.coinsTotal, itemKey: prev.itemKey ?? r.itemKey };
          playPass(Math.max(1, r.stars));
          setMisses((m) => ({ ...m, [key]: 0 }));
          setMissedWords(new Set());
        } else {
          playAgain();
          const n = (misses[key] ?? 0) + 1;
          setMisses((m) => ({ ...m, [key]: n }));
          const missed =
            r.missed ??
            (u.target_text
              ? scoreUtterance({ targetText: u.target_text, spokenTranscript: u.transcript, level, hintLevel: hint }).missed
              : []);
          if (n >= MISSES_BEFORE_HIGHLIGHT) setMissedWords(new Set(missed));
          // ECHO needs a voice; card/keyboard attempts simply try again with the misses underlined.
          const voiced = u.stt_source !== 'board' && u.stt_source !== 'keyboard';
          if (n >= MISSES_BEFORE_ECHO && u.target_text && !u.echo && voiced) {
            setEcho({ chunks: chunkPhrases(u.target_text), i: 0, said: [], tries: 0 });
            setPhase('echo');
            void speakEnglish(ECHO_TRANSITION_LINE.text, level);
            return;
          }
        }
        setPhase('result');
      } catch (err) {
        const auth = err instanceof SubmitError && err.kind === 'auth';
        const queued = err instanceof SubmitError && err.kind === 'queued';
        setAuthLost(auth);
        // Kept on the device (lesson outbox): no "try again" — a second send would be a second answer.
        if (queued) setPending(null);
        setNotice(
          auth ? S.sessionEnded : queued ? S.savedOffline : err instanceof SubmitError && err.kind === 'network' ? S.networkError : S.submitError
        );
        setPhase('result');
        setResult(null);
      } finally {
        clearTimeout(slowTimer);
      }
    },
    [submit, misses, level, hint]
  );

  const sendSpoken = useCallback(
    (transcript: string, source: SttSource, confidence: number, durMs: number, clip?: Promise<Blob | null>) => {
      const ech = echoRef.current;
      if (ech) {
        // ECHO: each phrase is checked locally only to move on (never to reward); after two tries it moves on anyway.
        const chunk = ech.chunks[ech.i]!;
        const ok = scoreUtterance({ targetText: chunk, spokenTranscript: transcript, level, hintLevel: 'full' }).pass;
        if (!ok && ech.tries + 1 < 2) {
          playAgain();
          setEcho({ ...ech, tries: ech.tries + 1 });
          setPhase('echo');
          return;
        }
        const said = [...ech.said, transcript];
        if (ech.i + 1 < ech.chunks.length) {
          playSfx('word.hit', ech.i * 2);
          setEcho({ ...ech, i: ech.i + 1, said, tries: 0 });
          setPhase('echo');
          return;
        }
        setEcho(null);
        void doSubmit({
          target_text: lastTarget || offer?.text || '',
          transcript: said.join(' '),
          chosen_stars: selected,
          hint_level: 'full',
          latency_ms: 0,
          dur_ms: durMs,
          stt_source: source,
          confidence,
          echo: true,
          attempt: (misses[selected] ?? 0) + 1
        });
        return;
      }
      if (needsUnderstand) {
        // Free talk with no offers: understand into bank offers, then the child picks one (docs/04 4.1).
        const u = understandUtterance({ ctx: npc.ctx, level, transcript });
        const next = u.offers.map((o) => ({
          stars: o.stars,
          text: o.text,
          hintTags: u.hint_tags.filter((t) => o.text.toLowerCase().includes(t.toLowerCase()))
        }));
        setOffers(next);
        setSelected(1);
        setPhase('choose');
        playSfx('word.hit', 4);
        return;
      }
      // Voice picks the sentence too: a child who reads another sentence on screen is scored on that one.
      const picked = freeTalk || source === 'board' ? offer : spokenOffer(offers, selected, transcript, level, hint);
      const stars = (picked?.stars ?? selected) as 1 | 2 | 3;
      if (!freeTalk && picked && stars !== selected) setSelected(stars);
      void doSubmit({
        target_text: freeTalk ? '' : picked?.text ?? '',
        transcript,
        chosen_stars: freeTalk ? 1 : stars,
        hint_level: hint,
        latency_ms: Math.max(0, Math.round(micStartAt.current - readyAt.current)),
        dur_ms: durMs,
        stt_source: source,
        confidence,
        ...(clip ? { clip } : {}),
        attempt: (misses[stars] ?? 0) + 1
      });
    },
    [doSubmit, freeTalk, hint, lastTarget, level, misses, needsUnderstand, npc.ctx, offer, offers, selected]
  );

  // Mic controller lives for the panel's lifetime; it reaches the latest sendSpoken through this ref.
  const sendRef = useRef(sendSpoken);
  sendRef.current = sendSpoken;
  const fallbackRef = useRef<Phase>('board');
  fallbackRef.current = offers.length > 0 ? 'board' : 'keyboard';
  useEffect(() => {
    const recorder = recordClip && engine.source !== 'workers_ai' ? createMediaClipRecorder() : null;
    const c = new MicController(engine, {
      onView: (v) => {
        setMic(v);
        if (!v.recording) micClosed();
      },
      onFinal: (r, durMs, clip) => {
        playSfx('dlg.mic_off');
        if (!r) {
          noSpeechRun.current += 1;
          setHeard(null);
          setNotice(S.noSpeech);
          if (noSpeechRun.current >= NO_SPEECH_BEFORE_BOARD) {
            // The board builds a whole sentence, so a half-done ECHO ends here (cards never count as ECHO).
            setEcho(null);
            setPhase(fallbackRef.current);
            return;
          }
          setPhase(echoRef.current ? 'echo' : 'choose');
          return;
        }
        noSpeechRun.current = 0;
        setHeard(convertMixedSpeech(r.transcript));
        sendRef.current(r.transcript, engine.source, r.confidence, durMs, clip);
      },
      onIssue: (issue) => {
        playSfx('dlg.mic_off');
        if (issue === 'no_speech') {
          noSpeechRun.current += 1;
          setNotice(S.noSpeech);
          if (noSpeechRun.current >= NO_SPEECH_BEFORE_BOARD) {
            setEcho(null);
            setPhase(fallbackRef.current);
            return;
          }
          setPhase(echoRef.current ? 'echo' : 'choose');
          return;
        }
        if (issue === 'network' || issue === 'aborted') {
          setNotice(S.networkError);
          setPhase(echoRef.current ? 'echo' : 'choose');
          return;
        }
        setMicIssue(issue);
        setEcho(null);
        setPhase(fallbackRef.current);
      }
    }, undefined, recorder);
    ctrl.current = c;
    return () => {
      // Only this window's own pending cue / open mic (the audio runtime is shared by the page).
      if (micPending.current) cancelMicCue();
      micPending.current = false;
      if (c.recording) micClosed();
      c.dispose();
    };
  }, [engine, recordClip]);

  const micDisabled = !!micIssue || phase === 'scoring' || (offers.length === 0 && !needsUnderstand);
  const toggleMic = useCallback(() => {
    unlockDialogAudio();
    if (micIssue) return;
    const c = ctrl.current;
    if (!c) return;
    if (!c.recording) {
      // A second tap while the cue is still coming cancels the start.
      if (micPending.current) {
        micPending.current = false;
        cancelMicCue();
        setPhase((p) => (p === 'echo' ? 'echo' : 'choose'));
        return;
      }
      micStartAt.current = Date.now();
      setNotice(null);
      setHeard(null);
      setPhase((p) => (p === 'echo' ? 'echo' : 'listening'));
      // docs/12 3장: cut the NPC voice, 150 ms, the rising cue, then record (the cue never lands in recognition).
      micPending.current = true;
      void micCue().then((ok) => {
        if (!micPending.current) return;
        micPending.current = false;
        if (ok && ctrl.current === c && !c.recording) {
          micStartAt.current = Date.now();
          c.tap();
        }
      });
      return;
    }
    c.tap();
  }, [micIssue]);

  // Closing after a pass still finishes the order: the server already granted (and charged for) the item.
  const closeWindow = useCallback(() => {
    if (bestPass.current) onDone(bestPass.current);
    else onClose();
  }, [onDone, onClose]);

  // Space toggles the mic inside the dialog (docs/08 7.1), Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && !micDisabled && (phase === 'choose' || phase === 'listening' || phase === 'echo')) {
        e.preventDefault();
        toggleMic();
      } else if (e.key === 'Escape') closeWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [micDisabled, phase, toggleMic, closeWindow]);

  const cards = useMemo(() => (offer ? buildWordCards(offer.text, distractorsFor(offer.text)) : []), [offer]);
  const usedCards = new Set(cardsPicked);
  const answer = cardsPicked.map((id) => cards.find((c) => c.id === id)?.word ?? '').join(' ');

  const pickOffer = (s: 1 | 2 | 3) => {
    unlockDialogAudio();
    playSfx('ui.click');
    setSelected(s);
    setCardsPicked([]);
    setMissedWords(new Set());
    readyAt.current = Date.now();
  };

  const retry = () => {
    setResult(null);
    setNotice(null);
    setPhase(micIssue ? (offers.length > 0 ? 'board' : 'keyboard') : 'choose');
    setCardsPicked([]);
    readyAt.current = Date.now();
  };

  const tryHigher = () => {
    const up = offers.find((o) => o.stars === Math.min(3, (result?.stars ?? selected) + 1));
    if (up) setSelected(up.stars);
    retry();
  };

  const higherExists = !!result?.pass && offers.some((o) => o.stars > (result?.stars ?? 3));
  const resultWords = lastTarget ? splitWords(lastTarget) : [];
  const resultMask = lastTarget ? heardMask(lastTarget, lastSpoken) : [];
  // A review card from the 1-day box on shows the sentence without its voice (docs/03 D8).
  const listenOk = listenAllowed(hint) && props.listen !== false;
  const extUrl = typeof location !== 'undefined' ? kakaoOpenExternalUrl(location.href) : '#';
  const style = { ['--fs' as string]: String(fontScale) } as React.CSSProperties;
  const pictures = offer ? picturesFor(offer.text) : ['💬'];
  // Recall ('initial') hides the chips: a tag like "can i have" would give the masked sentence away.
  const showTags = offer && (hint === 'full' || hint === 'keyword');

  return (
    <div className="lcw-dlg" style={style} role="dialog" aria-modal="true" aria-label={`${npc.nameKo} ${S.chooseTitle}`}>
      <style>{DIALOG_CSS}</style>
      <div className="lcw-dlg__win">
        <section className="lcw-dlg__side">
          <div className="lcw-dlg__npc">
            <div className="lcw-dlg__avatar" aria-hidden="true">{NPC_EMOJI[npc.ctx] ?? '🙂'}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="lcw-dlg__name">{npc.nameKo} · {npc.nameEn}</div>
              <div className="lcw-dlg__bubble" lang="en">
                {phase === 'echo' ? ECHO_TRANSITION_LINE.text : npcLine}
              </div>
              {phase === 'echo' ? <div className="lcw-dlg__name" style={{ marginTop: 4 }}>{ECHO_TRANSITION_LINE.ko}</div> : null}
            </div>
            {listenOk ? (
              <button type="button" className="lcw-listen" aria-label={S.listenAgain} title={S.listenAgain} onClick={() => { unlockDialogAudio(); void speakEnglish(phase === 'echo' ? ECHO_TRANSITION_LINE.text : npcLine, level); }}>
                🔊
              </button>
            ) : null}
          </div>
          <div className="lcw-dlg__preview" aria-hidden="true">
            {pictures.map((p, i) => <span key={i}>{p}</span>)}
          </div>
          {showTags && offer.hintTags.length > 0 ? (
            <div className="lcw-dlg__tags">
              <span className="lcw-dlg__tagl">{S.tagHelp}</span>
              {offer.hintTags.map((t) => <HintTag key={t} tag={t} />)}
            </div>
          ) : null}
          {(heard || mic.recording) && phase !== 'board' && phase !== 'keyboard' ? (
            <div className="lcw-dlg__me" aria-live="polite">
              <b>{S.mySpeech}:</b> “{mic.recording ? mic.interim || '…' : heard?.raw}”
              {!mic.recording && heard?.converted ? (
                <>
                  {' '}→ <span className="to" lang="en">“{heard.converted}”</span>
                  <div className="lcw-dlg__name">{S.converted}</div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="lcw-dlg__main">
          <div className="lcw-dlg__title">
            <span>{phase === 'echo' ? S.echoTitle : phase === 'board' ? S.boardTitle : freeTalk || needsUnderstand ? S.freePrompt : S.chooseTitle}</span>
            <button type="button" className="lcw-dlg__x" aria-label={S.close} onClick={closeWindow}>✕</button>
          </div>

          {micIssue ? (
            <div className="lcw-note" role="status">
              {micIssueText(micIssue)}{' '}
              {micIssue === 'in_app' && isKakaoInApp(ua) ? <a href={extUrl}>{S.openExternal}</a> : null}
            </div>
          ) : null}
          {notice ? <div className="lcw-note" role="status">{notice}</div> : null}

          {phase === 'result' && result ? (
            <div className="lcw-res" aria-live="polite">
              <div className="lcw-res__stars" aria-label={S.starsAria.replace('{n}', String(result.stars))}>
                {[1, 2, 3].map((n) => <span key={n} className={n <= result.stars ? '' : 'off'}>★</span>)}
              </div>
              {resultWords.length > 0 ? (
                <div className="lcw-res__words" lang="en">
                  {resultWords.map((w, i) => (
                    <span key={i} className={resultMask[i] ? 'hit' : 'miss'} style={{ animationDelay: `${i * 70}ms` }}>{w}</span>
                  ))}
                </div>
              ) : null}
              <div className="lcw-res__fb">{result.feedbackKo}</div>
              {!result.pass && missedWords.size > 0 ? <div className="lcw-dlg__name">{S.missedHint}</div> : null}
              {result.practice ? <div className="lcw-dlg__name">{S.practiceNote}</div> : null}
              {typeof result.coinsTotal === 'number' ? <div className="lcw-res__coins">🪙 {result.coinsTotal} {S.coins}</div> : null}
              <div className="lcw-row">
                {result.pass ? (
                  <>
                    {higherExists ? <button type="button" className="lcw-cta lcw-cta--up" onClick={tryHigher}>{S.tryHigher}</button> : null}
                    <button type="button" className="lcw-cta lcw-cta--go" onClick={() => onDone(result)}>{S.done}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="lcw-cta lcw-cta--again" onClick={retry}>{S.retry}</button>
                    {bestPass.current ? (
                      <button type="button" className="lcw-cta lcw-cta--go" onClick={() => onDone(bestPass.current!)}>{S.keepBest}</button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : phase === 'result' && !result ? (
            <div className="lcw-row">
              {pending && !authLost ? <button type="button" className="lcw-cta lcw-cta--again" onClick={() => void doSubmit(pending)}>{S.retry}</button> : null}
              {authLost ? (
                <button type="button" className="lcw-cta lcw-cta--again" onClick={closeWindow}>{S.close}</button>
              ) : (
                <button type="button" className="lcw-cta lcw-cta--again" onClick={retry}>{S.close}</button>
              )}
            </div>
          ) : phase === 'echo' && echo ? (
            <>
              <div className="lcw-echo" lang="en">
                {echo.chunks.map((c, i) => <span key={i} className={i === echo.i ? 'now' : i < echo.i ? 'done' : undefined}>{c}</span>)}
              </div>
              <div className="lcw-dlg__name">{S.echoStep.replace('{i}', String(echo.i + 1)).replace('{n}', String(echo.chunks.length))}</div>
              <div className="lcw-row">
                <button type="button" className="lcw-listen" aria-label={S.listen} onClick={() => void speakEnglish(echo.chunks[echo.i]!, level)}>🔊</button>
              </div>
            </>
          ) : phase === 'board' && offer ? (
            <>
              <div className="lcw-dlg__offers">
                {offers.map((o) => (
                  <button key={o.stars} type="button" className="lcw-offer" data-s={o.stars} aria-pressed={o.stars === selected} onClick={() => pickOffer(o.stars)}>
                    <span className="lcw-offer__stars" aria-label={S.starsAria.replace('{n}', String(o.stars))}>{starsText(o.stars)}</span>
                    <OfferText offer={o} hint={hint} />
                    <span />
                  </button>
                ))}
              </div>
              <div className="lcw-answer" lang="en" aria-live="polite">{answer || ' '}</div>
              <div className="lcw-cards">
                {cards.map((c) => (
                  <button key={c.id} type="button" className="lcw-card" disabled={usedCards.has(c.id)} onClick={() => { playSfx('word.hit', cardsPicked.length); setCardsPicked((p) => [...p, c.id]); }}>
                    {c.word}
                  </button>
                ))}
              </div>
              <div className="lcw-row">
                <button type="button" className="lcw-alt" onClick={() => setCardsPicked((p) => p.slice(0, -1))} disabled={cardsPicked.length === 0}>{S.boardUndo}</button>
                <button type="button" className="lcw-alt" onClick={() => setCardsPicked([])} disabled={cardsPicked.length === 0}>{S.boardClear}</button>
                <button
                  type="button"
                  className="lcw-cta lcw-cta--go"
                  disabled={cardsPicked.length === 0}
                  onClick={() => sendSpoken(answer, 'board', 1, 0)}
                >
                  {S.boardSubmit}
                </button>
              </div>
            </>
          ) : phase === 'keyboard' ? (
            <form
              className="lcw-dlg__offers"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) sendSpoken(typed.trim(), 'keyboard', 1, 0);
              }}
            >
              {offer ? (
                <div className="lcw-offer" data-s={offer.stars} aria-pressed="true">
                  <span className="lcw-offer__stars">{starsText(offer.stars)}</span>
                  <OfferText offer={offer} hint={hint} />
                  <span />
                </div>
              ) : null}
              <input className="lcw-input" lang="en" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={S.keyboardPlaceholder} autoCapitalize="sentences" />
              <div className="lcw-row">
                <button type="submit" className="lcw-cta lcw-cta--go" disabled={!typed.trim()}>{S.keyboardSubmit}</button>
              </div>
            </form>
          ) : phase === 'scoring' ? (
            <div className="lcw-res" aria-live="polite">
              <span className="lcw-dots" aria-hidden="true"><i /><i /><i /></span>
              <div className="lcw-res__fb">{slow ? S.processingSlow : S.processing}</div>
            </div>
          ) : (
            <div className="lcw-dlg__offers">
              {freeTalk ? <div className="lcw-dlg__name">{S.ideas}</div> : null}
              {offers.map((o) => (
                <button
                  key={o.stars}
                  type="button"
                  className="lcw-offer"
                  data-s={o.stars}
                  aria-pressed={!freeTalk && o.stars === selected}
                  onClick={() => pickOffer(o.stars)}
                >
                  <span className="lcw-offer__stars" aria-label={S.starsAria.replace('{n}', String(o.stars))}>{starsText(o.stars)}</span>
                  <OfferText offer={o} hint={hint} missed={o.stars === selected ? missedWords : undefined} />
                  {listenOk ? (
                    <span
                      className="lcw-listen"
                      role="button"
                      tabIndex={0}
                      aria-label={S.listen}
                      style={{ display: 'grid', placeItems: 'center' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        unlockDialogAudio();
                        void speakEnglish(o.text, level);
                      }}
                    >
                      🔊
                    </span>
                  ) : <span />}
                </button>
              ))}
            </div>
          )}

          {phase === 'choose' || phase === 'listening' || phase === 'echo' ? (
            <div className="lcw-dlg__bar">
              <button
                type="button"
                className="lcw-mic"
                data-on={mic.recording}
                disabled={micDisabled}
                style={{ ['--lvl' as string]: String(mic.recording ? Math.max(0.2, mic.level) : 0) } as React.CSSProperties}
                aria-label={mic.recording ? S.micStop : S.micStart}
                onClick={toggleMic}
              >
                <span>{mic.recording ? '⏹' : '🎤'}</span>
              </button>
              <div className="lcw-mic-label">
                {mic.recording ? S.micListening : S.micStart}
                {mic.recording ? <small>{mic.hangover ? S.micHangover : S.micStop}</small> : <small className="kbd">Space</small>}
              </div>
              {phase !== 'echo' ? (
                <>
                  <button type="button" className="lcw-alt" data-hot={noSpeechRun.current > 0} onClick={() => { setPhase('board'); setCardsPicked([]); }} disabled={!offer || freeTalk}>
                    🧩 {S.boardOpen}
                  </button>
                  <button type="button" className="lcw-alt" onClick={() => { setPhase('keyboard'); setTyped(''); }}>⌨️ {S.keyboardOpen}</button>
                </>
              ) : null}
            </div>
          ) : phase === 'board' || phase === 'keyboard' ? (
            <div className="lcw-dlg__bar">
              {!micIssue ? <button type="button" className="lcw-alt" onClick={() => setPhase('choose')}>🎤 {S.micOpen}</button> : null}
              {phase === 'board' ? (
                <button type="button" className="lcw-alt" onClick={() => { setPhase('keyboard'); setTyped(''); }}>⌨️ {S.keyboardOpen}</button>
              ) : (
                <button type="button" className="lcw-alt" onClick={() => { setPhase('board'); setCardsPicked([]); }} disabled={!offer || freeTalk}>🧩 {S.boardOpen}</button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
