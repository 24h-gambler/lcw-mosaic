import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonWindowStatus } from '@lcw/schemas';
import type { LessonBookmark } from '@lcw/metrics';
import { Button, Card, GuestPassEndModal, Panel, TOKENS } from '@lcw/ui';
import {
  buildChromeIntentUrl,
  chooseOpenOutsideAction,
  detectInAppBrowser,
  type InAppDetection
} from './inapp.js';
import {
  TRY_ANALYSER_INTERVAL_MS,
  TRY_TARGET_SENTENCE,
  chooseTryPath,
  detectSpeechSupport,
  evaluateSpeechEnergy,
  isSentenceAssembled,
  rmsOfTimeDomain,
  sentenceWords,
  shuffleWords,
  type EnergySample,
  type SpeechSupport
} from './tryFlow.js';
import {
  claimGuestKeepsake,
  readGuestKeepsake,
  type GuestKeepsake,
  type KeyValueStore
} from './guestClaim.js';
import {
  LESSON_WINDOW_REFRESH_MS,
  buildLessonWindowView,
  demoLessonStatusAt,
  subscribeDemoLessonStatus
} from './lessonWindow.js';
import { resolvePossessionLook } from './director.js';
import { GUEST_ITEM_NAMES_KO, WEB_UX_STRINGS_KO as S, withSubjectParticle } from './strings.js';

const gap = (n: 1 | 2 | 3) => `${TOKENS.spacing[n]}px`;

/* ---------- /try: in-app banner and speech fallback ---------- */

export function InAppBrowserBanner({
  detection,
  pageUrl
}: {
  detection: InAppDetection;
  pageUrl: string;
}): React.ReactElement | null {
  const [copied, setCopied] = useState(false);
  const action = chooseOpenOutsideAction(detection);
  if (!action) return null;
  const intent = action === 'intent_link' ? buildChromeIntentUrl(pageUrl) : null;
  const copy = () => {
    void navigator.clipboard?.writeText(pageUrl).then(() => setCopied(true));
  };
  return React.createElement(
    'div',
    {
      role: 'alert',
      'data-testid': 'in-app-banner',
      style: {
        backgroundColor: TOKENS.colors.sun,
        color: TOKENS.colors['ink-900'],
        border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        padding: gap(2),
        marginBottom: gap(2),
        display: 'grid',
        gap: gap(1)
      }
    },
    React.createElement('strong', null, S.inApp.bannerTitle),
    React.createElement('span', null, detection.isIOS ? S.inApp.bannerBodyIos : S.inApp.bannerBodyAndroid),
    intent
      ? React.createElement(
          'a',
          { href: intent, style: { color: TOKENS.colors['ink-900'], fontWeight: 700 } },
          S.inApp.openChrome
        )
      : null,
    React.createElement(Button, { type: 'button', variant: 'paper', onClick: copy }, S.inApp.copyLink),
    copied ? React.createElement('span', { role: 'status' }, S.inApp.copied) : null
  );
}

export interface TryExperienceProps {
  userAgent?: string;
  support?: SpeechSupport;
  pageUrl?: string;
  targetSentence?: string;
  /** Called once the child has passed (cards assembled, plus loudness check when the mic is available). */
  onPassed?: (utterance: string) => void;
}

type RecState = 'idle' | 'recording' | 'done';

export function TryExperience({
  userAgent,
  support,
  pageUrl,
  targetSentence = TRY_TARGET_SENTENCE,
  onPassed
}: TryExperienceProps): React.ReactElement {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const url = pageUrl ?? (typeof window !== 'undefined' ? window.location.href : 'https://example.invalid/try');
  const detection = detectInAppBrowser(ua);
  const rawSupport =
    support ??
    detectSpeechSupport(
      typeof window !== 'undefined'
        ? (window as unknown as Parameters<typeof detectSpeechSupport>[0])
        : {}
    );
  // iOS WebViews expose the constructor but the permission popup never appears (docs/14 section 8).
  const effective: SpeechSupport =
    detection.kind && detection.isIOS ? { ...rawSupport, recognition: false } : rawSupport;
  const path = chooseTryPath(effective);

  const words = useMemo(() => shuffleWords(sentenceWords(targetSentence), 7), [targetSentence]);
  const [picked, setPicked] = useState<number[]>([]);
  const pickedWords = picked.map((i) => words[i]!);
  const assembled = isSentenceAssembled(pickedWords, targetSentence);

  const [rec, setRec] = useState<RecState>('idle');
  const [heard, setHeard] = useState<boolean | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const handles = useRef<{
    stream?: MediaStream;
    ctx?: AudioContext;
    timer?: ReturnType<typeof setInterval>;
    recorder?: MediaRecorder;
    samples: EnergySample[];
  }>({ samples: [] });
  const passedRef = useRef(false);

  const loudnessNeeded = path === 'wordcards_with_loudness';
  const passed = assembled && (!loudnessNeeded || heard === true);
  useEffect(() => {
    if (passed && !passedRef.current) {
      passedRef.current = true;
      onPassed?.(targetSentence);
    }
  }, [passed, onPassed, targetSentence]);

  useEffect(
    () => () => {
      const h = handles.current;
      if (h.timer) clearInterval(h.timer);
      h.stream?.getTracks().forEach((t) => t.stop());
      void h.ctx?.close();
    },
    []
  );
  useEffect(() => () => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const t0 = performance.now();
      const h = handles.current;
      h.samples = [];
      h.stream = stream;
      h.ctx = ctx;
      h.timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        h.samples.push({ tMs: performance.now() - t0, rms: rmsOfTimeDomain(buf) });
      }, TRY_ANALYSER_INTERVAL_MS);
      if (typeof MediaRecorder !== 'undefined') {
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (ev) => chunks.push(ev.data);
        recorder.onstop = () => {
          if (chunks.length > 0) setPlaybackUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
        };
        recorder.start();
        h.recorder = recorder;
      }
      setRec('recording');
    } catch {
      // Permission denied or no device: continue with word cards alone.
      setHeard(true);
      setRec('done');
    }
  };

  const stopRecording = () => {
    const h = handles.current;
    if (h.timer) clearInterval(h.timer);
    if (h.recorder && h.recorder.state !== 'inactive') h.recorder.stop();
    h.stream?.getTracks().forEach((t) => t.stop());
    void h.ctx?.close();
    setHeard(evaluateSpeechEnergy(h.samples).passed);
    setRec('done');
  };

  return React.createElement(
    'div',
    { 'data-testid': 'try-experience', 'data-try-path': path },
    detection.kind ? React.createElement(InAppBrowserBanner, { detection, pageUrl: url }) : null,
    React.createElement('p', null, S.tryFlow.localOnly),
    path === 'recognition'
      ? null
      : React.createElement(
          Card,
          { title: S.tryFlow.cardsTitle },
          React.createElement('p', { style: { marginBottom: gap(1) } }, S.tryFlow.cardsHint),
          React.createElement(
            'div',
            {
              'data-testid': 'assembled-sentence',
              style: { minHeight: `${TOKENS.shape.touchTargetMinPx}px`, marginBottom: gap(1), fontWeight: 700 }
            },
            pickedWords.join(' ')
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: gap(1), marginBottom: gap(2) } },
            words.map((w, i) =>
              React.createElement(
                Button,
                {
                  key: `${w}-${i}`,
                  type: 'button',
                  variant: picked.includes(i) ? 'sky' : 'paper',
                  disabled: picked.includes(i),
                  onClick: () => setPicked((p) => [...p, i])
                },
                w
              )
            ),
            React.createElement(
              Button,
              { type: 'button', variant: 'paper', onClick: () => setPicked([]) },
              S.tryFlow.reset
            )
          ),
          assembled ? React.createElement('p', { role: 'status' }, S.tryFlow.assembled) : null,
          assembled && loudnessNeeded
            ? React.createElement(
                'div',
                { style: { display: 'grid', gap: gap(1) } },
                rec !== 'recording'
                  ? React.createElement(
                      Button,
                      { type: 'button', variant: 'brand', size: 'mic', onClick: () => void startRecording() },
                      S.tryFlow.startSpeak
                    )
                  : React.createElement(
                      Button,
                      { type: 'button', variant: 'leaf', size: 'game', onClick: stopRecording },
                      S.tryFlow.stopSpeak
                    ),
                rec === 'done'
                  ? React.createElement('p', { role: 'status' }, heard ? S.tryFlow.heardOk : S.tryFlow.heardShort)
                  : null,
                playbackUrl
                  ? React.createElement(
                      'div',
                      null,
                      React.createElement('p', null, S.tryFlow.playback),
                      React.createElement('audio', { controls: true, src: playbackUrl })
                    )
                  : null
              )
            : null,
          path === 'wordcards_only' ? React.createElement('p', null, S.tryFlow.noMicNote) : null
        )
  );
}

/* ---------- Guest pass end (child) and claim (parent) ---------- */

export interface GuestPassEndScreenProps {
  keepsake?: GuestKeepsake | null;
  deviceCode?: string | null;
  shareUrl?: string;
  onSendToParent?: (url: string) => void;
}

export function GuestPassEndScreen({
  keepsake,
  deviceCode,
  shareUrl = '/report',
  onSendToParent
}: GuestPassEndScreenProps): React.ReactElement {
  const [loaded, setLoaded] = useState<{ keepsake: GuestKeepsake; deviceCode: string } | null>(
    keepsake ? { keepsake, deviceCode: deviceCode ?? '' } : null
  );
  useEffect(() => {
    if (keepsake || typeof localStorage === 'undefined' || typeof crypto === 'undefined') return;
    void readGuestKeepsake(localStorage, crypto, Date.now()).then((r) => {
      if (r.ok) setLoaded({ keepsake: r.keepsake, deviceCode: r.deviceCode });
    });
  }, [keepsake]);

  const itemName = loaded ? (GUEST_ITEM_NAMES_KO[loaded.keepsake.itemId] ?? S.guestEnd.fallbackItemName) : null;
  return React.createElement(
    'section',
    { 'data-testid': 'guest-pass-end', style: { display: 'grid', gap: gap(2) } },
    React.createElement(
      Card,
      { title: loaded ? S.guestEnd.firstWords : undefined },
      React.createElement(
        'p',
        { style: { fontWeight: 700 } },
        itemName ? S.guestEnd.stored(withSubjectParticle(itemName)) : S.guestEnd.storedNothing
      ),
      loaded
        ? React.createElement('p', { 'data-testid': 'first-utterance' }, `"${loaded.keepsake.utterance}"`)
        : null,
      loaded && loaded.deviceCode
        ? React.createElement('p', { 'data-testid': 'guardian-code' }, `${S.guestEnd.guardianCode} ${loaded.deviceCode}`)
        : null
    ),
    React.createElement(GuestPassEndModal, { shareUrl, onSendToParent })
  );
}

export function GuestClaimCard({
  store,
  onClaimed
}: {
  store?: KeyValueStore;
  onClaimed?: (k: GuestKeepsake) => void;
}): React.ReactElement {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const submit = async () => {
    const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s || typeof crypto === 'undefined') {
      setMessage(S.claim.none);
      return;
    }
    const r = await claimGuestKeepsake(s, crypto, code, Date.now());
    if (r.ok) {
      setMessage(S.claim.ok);
      onClaimed?.(r.keepsake);
    } else {
      setMessage(
        r.reason === 'wrong_code'
          ? S.claim.wrongCode
          : r.reason === 'expired'
            ? S.claim.expired
            : r.reason === 'corrupt'
              ? S.claim.corrupt
              : S.claim.none
      );
    }
  };
  return React.createElement(
    Card,
    { title: S.claim.title },
    React.createElement('p', { style: { marginBottom: gap(1) } }, S.claim.deviceNote),
    React.createElement(
      'label',
      { style: { display: 'grid', gap: gap(1), marginBottom: gap(1) } },
      S.claim.codeLabel,
      React.createElement('input', {
        inputMode: 'numeric',
        maxLength: 6,
        value: code,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value),
        style: { minHeight: `${TOKENS.shape.touchTargetMinPx}px` }
      })
    ),
    React.createElement(Button, { type: 'button', onClick: () => void submit() }, S.claim.submit),
    message ? React.createElement('p', { role: 'status' }, message) : null
  );
}

/* ---------- Parent lesson window (P04, WP-307) ---------- */

export function LessonWindowBar({
  status,
  nowMs
}: {
  status: LessonWindowStatus | null;
  nowMs: number;
}): React.ReactElement {
  const view = buildLessonWindowView(status, nowMs);
  return React.createElement(
    'div',
    {
      role: 'status',
      'aria-live': 'polite',
      'data-testid': 'lesson-window-bar',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: gap(2),
        flexWrap: 'wrap',
        backgroundColor: TOKENS.colors['paper-100'],
        border: `${TOKENS.shape.borderWidthPx}px solid ${TOKENS.colors['ink-900']}`,
        borderRadius: `${TOKENS.shape.radiusCardPx}px`,
        padding: gap(2)
      }
    },
    view.state === 'live'
      ? [
          React.createElement(
            'span',
            {
              key: 'icon',
              'data-testid': 'scene-icon',
              style: {
                backgroundColor: TOKENS.colors.sky,
                color: TOKENS.colors['ink-900'],
                borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
                padding: `2px ${TOKENS.spacing[1]}px`,
                fontWeight: 700
              }
            },
            view.icon
          ),
          React.createElement('span', { key: 'line', 'data-testid': 'status-line' }, view.line),
          view.targetSentence
            ? React.createElement(
                'span',
                { key: 'target', 'data-testid': 'target-sentence', style: { fontWeight: 700 } },
                `${S.lessonWindow.targetLabel}: ${view.targetSentence}`
              )
            : null
        ]
      : React.createElement('span', null, view.state === 'idle' ? S.lessonWindow.idle : S.lessonWindow.stale)
  );
}

export interface ParentLessonWindowViewProps {
  /** Feed of status messages; the real one will wrap the LessonDO socket. Returns an unsubscribe function. */
  subscribe?: (push: (s: LessonWindowStatus) => void) => () => void;
  /** Fixed clock for tests/SSR. */
  nowMs?: number;
}

export function ParentLessonWindowView({
  subscribe = subscribeDemoLessonStatus,
  nowMs
}: ParentLessonWindowViewProps): React.ReactElement {
  const initialNow = nowMs ?? Date.now();
  const [status, setStatus] = useState<LessonWindowStatus | null>(() => demoLessonStatusAt(0, initialNow));
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const unsub = subscribe((s) => {
      setStatus(s);
      setNow(Date.now());
    });
    const clock = setInterval(() => setNow(Date.now()), LESSON_WINDOW_REFRESH_MS);
    return () => {
      unsub();
      clearInterval(clock);
    };
  }, [subscribe]);
  return React.createElement(
    Panel,
    null,
    React.createElement('h2', null, S.lessonWindow.title),
    React.createElement(LessonWindowBar, { status, nowMs: now }),
    React.createElement('p', null, S.lessonWindow.refreshNote)
  );
}

/* ---------- Director console additions ---------- */

export function DirectorBookmarkPanel({
  bookmarks
}: {
  bookmarks: readonly LessonBookmark[];
}): React.ReactElement {
  return React.createElement(
    Card,
    { title: S.director.hotkeyHint },
    React.createElement('p', { 'data-testid': 'bookmark-count' }, S.director.bookmarkCount(bookmarks.length)),
    React.createElement(
      'ul',
      null,
      bookmarks.map((b, i) =>
        React.createElement(
          'li',
          { key: `${b.kind}-${b.at_ms}-${i}` },
          `${b.kind === 'coaching' ? S.director.coaching : S.director.expression} · ${Math.round(b.at_ms / 1000)}s`
        )
      )
    )
  );
}

export function PossessionPanel({
  possessedNpc,
  npcIds,
  npcLabels,
  onRelease
}: {
  possessedNpc: string | null;
  npcIds: readonly string[];
  npcLabels: Readonly<Record<string, string>>;
  onRelease?: () => void;
}): React.ReactElement {
  const look = resolvePossessionLook(possessedNpc, npcIds);
  return React.createElement(
    'div',
    { 'data-testid': 'possession-panel', style: { display: 'grid', gap: gap(1), marginBottom: gap(2) } },
    React.createElement(
      'span',
      { 'data-testid': 'teacher-avatar-state', 'data-state': look.teacherAvatar },
      look.teacherAvatar === 'sitting_reading_map' ? S.director.avatarSitting : S.director.avatarActive
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: gap(1), flexWrap: 'wrap' } },
      npcIds.map((id) =>
        React.createElement(
          'span',
          { key: id, 'data-testid': `npc-${id}`, 'data-marker': look.npcMarkers[id] },
          `${npcLabels[id] ?? id}${look.npcMarkers[id] === 'sparkle' ? ` (${S.director.sparkle})` : ''}`
        )
      )
    ),
    possessedNpc && onRelease
      ? React.createElement(Button, { type: 'button', variant: 'paper', onClick: onRelease }, S.director.release)
      : null
  );
}
