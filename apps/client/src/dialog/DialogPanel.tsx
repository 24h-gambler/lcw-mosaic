import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ECHO_TRANSITION_LINE, NPC_OPENING_LINES, glossKo, npcCast, voiceForCtx } from '@lcw/content';
import { feedbackLine, helpKo, ko, live } from './strings.js';
import { helpKoOn, learnLang } from '../world/lang.js';
import { scoreUtterance, understandUtterance } from '@lcw/converse';
import {
  bankOffersFor,
  buildWordCards,
  chunkPhrases,
  convertMixedSpeech,
  distractorsFor,
  heardMask,
  itemFor,
  listenAllowed,
  picturesFor,
  renderHintTokens,
  splitWords,
  spokenOffer,
  type MixedSpeech
} from './hints.js';
import { createMediaClipRecorder } from '@lcw/audio';
import { MicController, type MicView } from './mic-controller.js';
import { noteTurnLost, noteTurnSent } from './mic-status.js';
import { isKakaoInApp, kakaoOpenExternalUrl, type MicIssue, type SpeechEngine } from './speech.js';
import { createDialogSpeechEngine } from './server-stt.js';
import { cancelMicCue, micClosed, micCue, playAgain, playPass, playSfx, speakEnglish, stopSpeaking, unlockDialogAudio } from './sound.js';
import { DIALOG_CSS } from './styles.js';
import { loadLine, neuralVoiceOn, neuralVoiceStatus, prefetchLines } from './neural-voice.js';

// Ask once per page whether the neural NPC voice is on, before the first dialog speaks (neural-voice.ts).
if (typeof window !== 'undefined') void neuralVoiceStatus();
import { newDialogId, SubmitError } from './submit.js';
import type { DialogOffer, DialogPanelProps, DialogResult, SttSource, UtteranceSubmit } from './types.js';
import { micHoldMode, syllableHints } from '../frame/settings.js';
import { syllabify } from '../frame/syllables.js';
import { FRAME_STRINGS } from '../frame/strings.js';

export type { DialogOffer, DialogPanelProps, DialogResult, NpcRef, UtteranceSubmit } from './types.js';
export { createLessonSubmit, createSoloSubmit, createSoloSubmitWith } from './submit.js';
export { noteSoloDone, soloTalkPlan } from './npc-lines.js';

const S = live('dialog');
const SK = ko('dialog');
/** Korean help (tag meanings, the Korean names, the echo line's meaning) shows unless the child learns English with the help off. */
const koShown = (): boolean => learnLang() !== 'en' || helpKoOn();

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
  if (issue === 'quota') return S.sttQuota;
  if (issue === 'stt_failed') return S.sttFailed;
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
  // G14 읽기: whole words shown in full get syllable marks (ta·ble); masked or blanked words stay as they are
  const syl = syllableHints();
  return (
    <span className="lcw-offer__text">
      {toks.map((t, i) => {
        // Keywords are marked only when the sentence is reduced to them; on full sentences the tag chips do that job.
        const cls = [t.key && hint === 'keyword' ? 'k' : '', t.shown !== t.word ? 'm' : '', missed?.has(t.norm) ? 'miss' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <React.Fragment key={i}>
            <span className={cls || undefined}>{syl && t.shown === t.word ? syllabify(t.shown) : t.shown}</span>{' '}
          </React.Fragment>
        );
      })}
    </span>
  );
}

function HintTag(props: { tag: string }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gloss = koShown() ? glossKo(props.tag) : null;
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
  // R2625: after the opening line's answer passes, the NPC asks `followUps` one by one in this window (turn 1..n).
  // A follow-up is answered in the child's own words, so it is free talk whatever the window's mode.
  const followUps = props.followUps;
  const [turn, setTurn] = useState(0);
  const followTurn = turn > 0;
  const followSubmit = props.followUpSubmit ?? submit;
  const freeTalk = (mode === 'free' && props.offers.length > 0) || followTurn;
  const needsUnderstand = !followTurn && mode === 'free' && offers.length === 0;

  const [selected, setSelected] = useState<1 | 2 | 3>(() => (initialOffers[0]?.stars ?? 1) as 1 | 2 | 3);
  const offer = offers.find((o) => o.stars === selected) ?? offers[0];
  // Audit G02: the preview shows what this sentence buys (the world's 3D of the item, or its picture) and its price,
  // and the NPC's face; without the world's renderPreview it falls back to pictures.
  const item = offer ? itemFor(offer.text) : null;
  const itemImg = usePreview(props.renderPreview, item ? { kind: 'item', itemKey: item.itemKey, ...(item.modifier ? { modifier: item.modifier } : {}) } : null, 160);
  const npcImg = usePreview(props.renderPreview, { kind: 'npc', npcId: npc.id }, 112);
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

  const openLine = props.npcLine ?? NPC_OPENING_LINES[npc.ctx] ?? NPC_OPENING_LINES.guide!;
  const npcLine = followTurn ? followUps?.[turn - 1] ?? openLine : openLine;

  // Voices from the cast pack: the NPC speaks in its own, the child's sentences are read in the model voice.
  const npcVoice = voiceForCtx(props.voiceCtx ?? npc.ctx);
  const modelVoice = npcCast().modelVoice;
  // NPC asks on open (docs/12: the mic only opens after the NPC line ends — a tap on the mic cuts the voice first).
  useEffect(() => {
    void speakEnglish(npcLine, level, npcVoice);
    return () => stopSpeaking();
    // npcVoice follows npc.ctx / voiceCtx
  }, [npcLine, level, npc.ctx, props.voiceCtx]);
  // The offers' model sentences are fetched once the NPC line is in (it goes first: four parallel new lines took
  // 1.2-1.7 s each against ~0.6 s alone, measured 11-16), so a 🔊 tap plays at once.
  useEffect(() => {
    const after = neuralVoiceOn() ? loadLine(npcVoice, npcLine) : Promise.resolve(null);
    void after.then(() => prefetchLines(offers.map((o) => ({ voice: modelVoice, text: o.text }))));
    // modelVoice is the pack's constant
  }, [offers]);

  const doSubmit = useCallback(
    async (u: UtteranceSubmit) => {
      setPending(u);
      setPhase('scoring');
      setSlow(false);
      setNotice(null);
      const slowTimer = setTimeout(() => setSlow(true), SLOW_PROCESSING_MS);
      // R2627: a spoken turn is counted sent once the server answered it, lost when the send failed for good.
      const spoken = u.stt_source !== 'board' && u.stt_source !== 'keyboard';
      try {
        const r = await (followTurn ? followSubmit : submit)({ ...u, dialogId: dialogId.current });
        if (spoken) noteTurnSent();
        setResult(r);
        onResultRef.current?.(r);
        setLastTarget(r.matchedText ?? u.target_text);
        setLastSpoken(u.transcript);
        setPending(null);
        const key = u.chosen_stars;
        if (r.pass && r.repeat) {
          // Said again: it already had its stars (lesson, R2627). No star sound, no new best; the card asks for new words.
          playAgain();
          setMissedWords(new Set());
          if (!bestPass.current) bestPass.current = r;
        } else if (r.pass && followTurn) {
          // A follow-up answer sells nothing: the window's best (the item the server granted) stays the opening's.
          playPass(Math.max(1, r.stars));
          setMissedWords(new Set());
        } else if (r.pass) {
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
            void speakEnglish(ECHO_TRANSITION_LINE.text, level, npcVoice);
            return;
          }
        }
        setPhase('result');
      } catch (err) {
        const auth = err instanceof SubmitError && err.kind === 'auth';
        const queued = err instanceof SubmitError && err.kind === 'queued';
        // Kept in the lesson outbox, it reaches the server later; anything else lost this turn (a resend is a new try).
        if (spoken) {
          if (queued) noteTurnSent();
          else noteTurnLost('submit_failed');
        }
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
    [submit, followSubmit, followTurn, misses, level, hint]
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
        if (issue === 'network' || issue === 'aborted' || issue === 'stt_failed') {
          setNotice(issue === 'stt_failed' ? S.sttFailed : S.networkError);
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

  const micDisabled = !!micIssue || phase === 'scoring' || !!mic.processing || (!followTurn && offers.length === 0 && !needsUnderstand);
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
    if (bestPass.current) {
      if (followUps) onDone(bestPass.current, { followUpsDone: false });
      else onDone(bestPass.current);
    } else onClose();
  }, [onDone, onClose, followUps]);

  // 완료 / "keep this one" / "next": the NPC asks its next follow-up in this window, or the window is finished.
  const finish = useCallback(
    (r: DialogResult) => {
      if (!followUps) {
        onDone(r);
        return;
      }
      if (turn < followUps.length && (bestPass.current || r.pass)) {
        setTurn(turn + 1);
        setResult(null);
        setNotice(null);
        setHeard(null);
        setEcho(null);
        setPending(null);
        setMisses({});
        setMissedWords(new Set());
        setCardsPicked([]);
        setTyped('');
        setLastTarget('');
        setLastSpoken('');
        noSpeechRun.current = 0;
        readyAt.current = Date.now();
        setPhase(micIssue ? 'keyboard' : 'choose');
        return;
      }
      onDone(bestPass.current ?? r, { followUpsDone: true });
    },
    [followUps, turn, onDone, micIssue]
  );
  const skipFollowUp = () => {
    unlockDialogAudio();
    playSfx('ui.click');
    finish(bestPass.current ?? result ?? { pass: false, stars: 0, feedbackKo: '' });
  };

  // Space toggles the mic inside the dialog (docs/08 7.1), Esc closes. The player's "hold" setting (G14, docs/08 11장
  // 누르고 있기 <-> 켜고 끄기) turns the mic button and Space into hold-to-talk: press starts, release ends.
  const hold = micHoldMode();
  const micLive = () => !!ctrl.current?.recording || micPending.current;
  const holdRelease = useCallback(() => {
    if (ctrl.current?.recording || micPending.current) toggleMic();
  }, [toggleMic]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && !micDisabled && (phase === 'choose' || phase === 'listening' || phase === 'echo')) {
        e.preventDefault();
        if (!hold) toggleMic();
        else if (!e.repeat && !ctrl.current?.recording && !micPending.current) toggleMic();
      } else if (e.key === 'Escape') closeWindow();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (hold && e.code === 'Space') holdRelease();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [micDisabled, phase, toggleMic, closeWindow, hold, holdRelease]);

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
    // a follow-up is free talk: no sentence to build on the board, so a child without a mic types
    setPhase(micIssue ? (offers.length > 0 && !followTurn ? 'board' : 'keyboard') : 'choose');
    setCardsPicked([]);
    readyAt.current = Date.now();
  };

  const tryHigher = () => {
    const up = offers.find((o) => o.stars === Math.min(3, (result?.stars ?? selected) + 1));
    if (up) setSelected(up.stars);
    retry();
  };

  const higherExists = !followTurn && !!result?.pass && offers.some((o) => o.stars > (result?.stars ?? 3));
  const resultWords = lastTarget ? splitWords(lastTarget) : [];
  const resultMask = lastTarget ? heardMask(lastTarget, lastSpoken) : [];
  // A review card from the 1-day box on shows the sentence without its voice (docs/03 D8).
  const listenOk = listenAllowed(hint) && props.listen !== false;
  const extUrl = typeof location !== 'undefined' ? kakaoOpenExternalUrl(location.href) : '#';
  // No prop: the window follows the player's text size setting (G14, `--lcw-fs` on <html>, read in styles.ts).
  const style = props.fontScale !== undefined ? ({ ['--fs' as string]: String(fontScale) } as React.CSSProperties) : undefined;
  const pictures = offer ? picturesFor(offer.text) : [];
  const priced = offers.filter((o) => (o.price ?? 0) > 0);
  const cheaper = offer?.price ? priced.filter((o) => o.stars > offer.stars && o.price! < offer.price!).sort((a, b) => a.price! - b.price!)[0] : undefined;
  // Recall ('initial') hides the chips: a tag like "can i have" would give the masked sentence away.
  const showTags = offer && (hint === 'full' || hint === 'keyword');

  const titleKey =
    phase === 'echo' ? 'echoTitle' : phase === 'board' ? 'boardTitle' : followTurn ? 'followUpHint' : freeTalk || needsUnderstand ? 'freePrompt' : 'chooseTitle';
  return (
    <div className="lcw-dlg" style={style} role="dialog" aria-modal="true" aria-label={`${learnLang() === 'en' ? npc.nameEn : npc.nameKo} ${S.chooseTitle}`}>
      <style>{DIALOG_CSS}</style>
      <div className="lcw-dlg__win">
        <section className="lcw-dlg__side">
          <div className="lcw-dlg__npc">
            <div className="lcw-dlg__avatar" aria-hidden="true">{npcImg ? <img src={npcImg} alt="" /> : NPC_EMOJI[props.voiceCtx ?? npc.ctx] ?? '🙂'}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="lcw-dlg__name">{learnLang() !== 'en' ? `${npc.nameKo} · ${npc.nameEn}` : helpKoOn() ? `${npc.nameEn} · ${npc.nameKo}` : npc.nameEn}</div>
              <div className="lcw-dlg__bubble" lang="en">
                {phase === 'echo' ? ECHO_TRANSITION_LINE.text : npcLine}
              </div>
              {phase === 'echo' && koShown() ? <div className="lcw-dlg__name" style={{ marginTop: 4 }}>{ECHO_TRANSITION_LINE.ko}</div> : null}
            </div>
            {listenOk ? (
              <button type="button" className="lcw-listen" aria-label={S.listenAgain} title={S.listenAgain} onClick={() => { unlockDialogAudio(); void speakEnglish(phase === 'echo' ? ECHO_TRANSITION_LINE.text : npcLine, level, npcVoice); }}>
                🔊
              </button>
            ) : null}
          </div>
          <div className="lcw-dlg__preview">
            {item ? (
              <>
                <div className="lcw-dlg__pics" aria-hidden="true">
                  {itemImg ? <img className="lcw-dlg__item3d" src={itemImg} alt="" /> : pictures.map((p, i) => <span key={i}>{p}</span>)}
                </div>
                <div className="lcw-dlg__pv">
                  <b>{koShown() ? item.nameKo : [item.modifier, item.itemKey.replace(/_/g, " ")].filter(Boolean).join(" ")}</b>
                  {offer?.price ? <span className="lcw-dlg__coin">{S.previewBuy.replace('{coins}', String(offer.price))}</span> : null}
                </div>
                {cheaper ? (
                  <div className="lcw-dlg__cheaper">{S.previewCheaper.replace('{stars}', starsText(cheaper.stars)).replace('{coins}', String(cheaper.price))}</div>
                ) : offer?.price && priced.length > 1 ? (
                  <div className="lcw-dlg__cheaper best">{S.previewBest}</div>
                ) : null}
              </>
            ) : (
              <div className="lcw-dlg__pics lcw-dlg__face" aria-hidden="true">
                {npcImg ? <img className="lcw-dlg__item3d" src={npcImg} alt="" /> : <span>{NPC_EMOJI[props.voiceCtx ?? npc.ctx] ?? '🙂'}</span>}
              </div>
            )}
          </div>
          {showTags && offer.hintTags.length > 0 ? (
            <div className="lcw-dlg__tags">
              {koShown() ? <span className="lcw-dlg__tagl">{S.tagHelp}</span> : null}
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
            <span>
              {S[titleKey]}
              {helpKo(SK[titleKey], S[titleKey]) ? <small className="lcw-dlg__help" style={{ display: 'block', fontWeight: 400, opacity: 0.75 }}>{SK[titleKey]}</small> : null}
            </span>
            <button type="button" className="lcw-dlg__x" aria-label={S.close} onClick={closeWindow}>✕</button>
          </div>

          {micIssue ? (
            <div className="lcw-note" role="status">
              {micIssueText(micIssue)}{' '}
              {micIssue === 'in_app' && isKakaoInApp(ua) ? <a href={extUrl}>{S.openExternal}</a> : null}
            </div>
          ) : null}
          {notice ? <div className="lcw-note" role="status">{notice}</div> : null}
          {mic.processing && phase === 'listening' ? (
            <div className="lcw-res" aria-live="polite" data-testid="dlg-processing">
              <span className="lcw-dots" aria-hidden="true"><i /><i /><i /></span>
              <div className="lcw-res__fb">{S.processing}</div>
            </div>
          ) : null}

          {phase === 'result' && result ? (
            <div className="lcw-res" aria-live="polite" data-repeat={result.repeat ? 'true' : undefined}>
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
              <div className="lcw-res__fb">{feedbackLine(result.feedbackKo, result.feedbackEn).text}</div>              {feedbackLine(result.feedbackKo, result.feedbackEn).help ? <div className="lcw-dlg__name">{feedbackLine(result.feedbackKo, result.feedbackEn).help}</div> : null}
              {!result.pass && missedWords.size > 0 ? <div className="lcw-dlg__name">{S.missedHint}</div> : null}
              {result.practice ? <div className="lcw-dlg__name">{S.practiceNote}</div> : null}
              {typeof result.coinsTotal === 'number' ? <div className="lcw-res__coins">🪙 {result.coinsTotal} {S.coins}</div> : null}
              <div className="lcw-row">
                {result.pass && result.repeat ? (
                  <>
                    <button type="button" className="lcw-cta lcw-cta--again" data-repeat="true" onClick={retry}>{S.retry}</button>
                    <button type="button" className="lcw-cta lcw-cta--go" onClick={() => finish(bestPass.current ?? result)}>{S.done}</button>
                  </>
                ) : result.pass ? (
                  <>
                    {higherExists ? <button type="button" className="lcw-cta lcw-cta--up" onClick={tryHigher}>{S.tryHigher}</button> : null}
                    <button type="button" className="lcw-cta lcw-cta--go" onClick={() => finish(result)}>{S.done}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="lcw-cta lcw-cta--again" onClick={retry}>{S.retry}</button>
                    {followTurn ? (
                      <button type="button" className="lcw-cta lcw-cta--go lcw-dlg__next" onClick={skipFollowUp}>{S.followUpSkip}</button>
                    ) : bestPass.current ? (
                      <button type="button" className="lcw-cta lcw-cta--go" onClick={() => finish(bestPass.current!)}>{S.keepBest}</button>
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
                <button type="button" className="lcw-listen" aria-label={S.listen} onClick={() => void speakEnglish(echo.chunks[echo.i]!, level, modelVoice)}>🔊</button>
              </div>
            </>
          ) : phase === 'board' && offer ? (
            <>
              <div className="lcw-dlg__offers">
                {offers.map((o) => (
                  <button key={o.stars} type="button" className="lcw-offer" data-s={o.stars} aria-pressed={o.stars === selected} onClick={() => pickOffer(o.stars)}>
                    <span className="lcw-offer__stars" aria-label={S.starsAria.replace('{n}', String(o.stars))}>
                    {starsText(o.stars)}
                    {o.price ? <small className="lcw-offer__price" aria-label={S.priceAria.replace('{coins}', String(o.price))}>🪙{o.price}</small> : null}
                  </span>
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
              {offer && !followTurn ? (
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
          ) : followTurn ? (
            <div className="lcw-row">
              <button type="button" className="lcw-alt lcw-dlg__next" onClick={skipFollowUp}>{S.followUpSkip} →</button>
            </div>
          ) : (
            <div className="lcw-dlg__offers">
              {freeTalk ? <div className="lcw-dlg__name lcw-dlg__ideas">{S.ideas}</div> : null}
              {offers.map((o) => (
                <button
                  key={o.stars}
                  type="button"
                  className="lcw-offer"
                  data-s={o.stars}
                  aria-pressed={!freeTalk && o.stars === selected}
                  onClick={() => pickOffer(o.stars)}
                >
                  <span className="lcw-offer__stars" aria-label={S.starsAria.replace('{n}', String(o.stars))}>
                    {starsText(o.stars)}
                    {o.price ? <small className="lcw-offer__price" aria-label={S.priceAria.replace('{coins}', String(o.price))}>🪙{o.price}</small> : null}
                  </span>
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
                        void speakEnglish(o.text, level, modelVoice);
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
                onClick={hold ? (e) => void (e.detail === 0 && toggleMic()) : toggleMic}
                onPointerDown={
                  hold
                    ? (e) => {
                        e.currentTarget.setPointerCapture?.(e.pointerId);
                        if (!micLive()) toggleMic();
                      }
                    : undefined
                }
                onPointerUp={hold ? holdRelease : undefined}
                onPointerCancel={hold ? holdRelease : undefined}
              >
                <span>{mic.recording ? '⏹' : '🎤'}</span>
              </button>
              <div className="lcw-mic-label">
                {mic.recording ? S.micListening : S.micStart}
                {mic.recording ? <small>{hold ? FRAME_STRINGS.micHoldRelease : mic.secondsLeft !== undefined ? S.timeLeft.replace('{n}', String(mic.secondsLeft)) : mic.hangover ? S.micHangover : S.micStop}</small> : <small className="kbd">Space</small>}
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

/** One world thumbnail (renderPreview); null until it arrives or when the world has none. */
function usePreview(render: DialogPanelProps['renderPreview'], req: import('./types.js').PreviewRequest | null, size: number): string | null {
  const key = req ? JSON.stringify(req) : '';
  const [img, setImg] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  useEffect(() => {
    if (!render || !req) return;
    let live = true;
    render(req, size)
      .then((url) => {
        if (live) setImg({ key, url });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // `key` stands for req (a new object every render)
  }, [render, key, size]);
  return img.key === key ? img.url : null;
}
