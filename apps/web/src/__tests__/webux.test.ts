import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { LessonWindowStatusSchema, type LessonWindowStatus } from '@lcw/schemas';
import { buildChromeIntentUrl, chooseOpenOutsideAction, detectInAppBrowser } from '../inapp.js';
import {
  TRY_SPEECH_MIN_MS,
  TRY_TARGET_SENTENCE,
  chooseTryPath,
  detectSpeechSupport,
  evaluateSpeechEnergy,
  isSentenceAssembled,
  rmsOfTimeDomain,
  sentenceWords,
  shuffleWords
} from '../tryFlow.js';
import {
  GUEST_CLAIM_KEY_STORAGE_KEY,
  GUEST_CLAIM_STORAGE_KEY,
  GUEST_CLAIM_TTL_MS,
  claimGuestKeepsake,
  fromBase64,
  isClaimExpired,
  readGuestKeepsake,
  saveGuestKeepsake,
  toBase64,
  type KeyValueStore
} from '../guestClaim.js';
import {
  LESSON_WINDOW_REFRESH_MS,
  LESSON_WINDOW_STALE_MS,
  buildLessonWindowView,
  demoLessonStatusAt
} from '../lessonWindow.js';
import {
  POSSESSION_NPC_MARKER,
  POSSESSION_TEACHER_AVATAR_STATE,
  bookmarkFromKey,
  handleDirectorKeydown,
  resolvePossessionLook
} from '../director.js';
import { withSubjectParticle } from '../strings.js';
import { App } from '../App.js';
import {
  GuestPassEndScreen,
  LessonWindowBar,
  ParentLessonWindowView,
  PossessionPanel,
  TryExperience
} from '../WebUx.js';

const UA_KAKAO_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 KAKAOTALK 10.4.0';
const UA_KAKAO_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0';
const UA_SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const UA_CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  };
}

describe('item 1: /try in-app browser and speech fallback', () => {
  it('detects in-app browsers by UA', () => {
    expect(detectInAppBrowser(UA_KAKAO_ANDROID).kind).toBe('kakaotalk');
    expect(detectInAppBrowser('... Instagram 300.0 Android').kind).toBe('instagram');
    expect(detectInAppBrowser('[FBAN/FBIOS;FBAV/430.0]').kind).toBe('facebook');
    expect(detectInAppBrowser('Mozilla/5.0 Android NAVER(inapp; search; 1000; 12.0)').kind).toBe('naver');
    expect(detectInAppBrowser('Mozilla/5.0 Android Line/13.0.0').kind).toBe('line');
    expect(detectInAppBrowser('Mozilla/5.0 Android DaumApps/5.0').kind).toBe('daum');
  });

  it('detects iOS WKWebView (no Safari token) but not real Safari, Chrome iOS or desktop', () => {
    const webview =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    expect(detectInAppBrowser(webview).kind).toBe('ios_webview');
    expect(detectInAppBrowser(UA_SAFARI_IOS).kind).toBeNull();
    expect(
      detectInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
      ).kind
    ).toBeNull();
    expect(detectInAppBrowser(UA_CHROME_DESKTOP).kind).toBeNull();
  });

  it('offers a Chrome intent link on Android and a copy button on iOS', () => {
    expect(chooseOpenOutsideAction(detectInAppBrowser(UA_KAKAO_ANDROID))).toBe('intent_link');
    expect(chooseOpenOutsideAction(detectInAppBrowser(UA_KAKAO_IOS))).toBe('copy_link');
    expect(chooseOpenOutsideAction(detectInAppBrowser(UA_CHROME_DESKTOP))).toBeNull();
    expect(buildChromeIntentUrl('https://lcw.example/try?x=1')).toBe(
      'intent://lcw.example/try?x=1#Intent;scheme=https;package=com.android.chrome;end'
    );
    expect(buildChromeIntentUrl('javascript:alert(1)')).toBeNull();
    expect(buildChromeIntentUrl('not a url')).toBeNull();
  });

  it('picks the try path from speech support', () => {
    expect(chooseTryPath({ recognition: true, getUserMedia: true })).toBe('recognition');
    expect(chooseTryPath({ recognition: false, getUserMedia: true })).toBe('wordcards_with_loudness');
    expect(chooseTryPath({ recognition: false, getUserMedia: false })).toBe('wordcards_only');
    expect(detectSpeechSupport({ webkitSpeechRecognition: () => undefined })).toEqual({
      recognition: true,
      getUserMedia: false
    });
    expect(detectSpeechSupport({ navigator: { mediaDevices: { getUserMedia: () => undefined } } })).toEqual({
      recognition: false,
      getUserMedia: true
    });
  });

  it('passes only when speech-like energy lasted at least the minimum duration', () => {
    const loud = (from: number, to: number) =>
      Array.from({ length: Math.floor((to - from) / 50) + 1 }, (_, i) => ({ tMs: from + i * 50, rms: 0.2 }));
    expect(evaluateSpeechEnergy(loud(0, TRY_SPEECH_MIN_MS)).passed).toBe(true);
    expect(evaluateSpeechEnergy(loud(0, TRY_SPEECH_MIN_MS - 200)).passed).toBe(false);
    expect(
      evaluateSpeechEnergy([
        { tMs: 0, rms: 0.001 },
        { tMs: 3000, rms: 0.001 }
      ]).passed
    ).toBe(false);
    // A pause under the gap limit is bridged; a long pause splits two short bursts that each fail.
    expect(evaluateSpeechEnergy([...loud(0, 500), ...loud(800, 1300)]).passed).toBe(true);
    expect(evaluateSpeechEnergy([...loud(0, 500), ...loud(1500, 2000)]).passed).toBe(false);
  });

  it('computes RMS of time-domain bytes (128 = silence)', () => {
    expect(rmsOfTimeDomain(new Uint8Array(100).fill(128))).toBe(0);
    expect(rmsOfTimeDomain(Uint8Array.from([0, 255, 0, 255]))).toBeGreaterThan(0.9);
    expect(rmsOfTimeDomain([])).toBe(0);
  });

  it('assembles the target sentence from cards (case and trailing punctuation ignored)', () => {
    const words = sentenceWords(TRY_TARGET_SENTENCE);
    expect(isSentenceAssembled(words, TRY_TARGET_SENTENCE)).toBe(true);
    expect(isSentenceAssembled([...words].reverse(), TRY_TARGET_SENTENCE)).toBe(false);
    expect(isSentenceAssembled(words.slice(1), TRY_TARGET_SENTENCE)).toBe(false);
    const shuffled = shuffleWords(words, 7);
    expect([...shuffled].sort()).toEqual([...words].sort());
    expect(shuffleWords(words, 7)).toEqual(shuffled);
  });

  it('renders the banner and word cards inside KakaoTalk with no recognition, with no price copy', () => {
    const html = renderToStaticMarkup(
      React.createElement(TryExperience, {
        userAgent: UA_KAKAO_ANDROID,
        support: { recognition: false, getUserMedia: true },
        pageUrl: 'https://lcw.example/try'
      })
    );
    expect(html).toContain('크롬/사파리로 열기');
    expect(html).toContain('intent://lcw.example/try');
    expect(html).toContain('data-try-path="wordcards_with_loudness"');
    for (const w of sentenceWords(TRY_TARGET_SENTENCE)) expect(html).toContain(`>${w}<`);
    expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(html)).toBe(false);
  });

  it('forces word cards on iOS in-app browsers, and allows cards alone without a mic', () => {
    const ios = renderToStaticMarkup(
      React.createElement(TryExperience, {
        userAgent: UA_KAKAO_IOS,
        support: { recognition: true, getUserMedia: true },
        pageUrl: 'https://lcw.example/try'
      })
    );
    expect(ios).toContain('data-try-path="wordcards_with_loudness"');
    expect(ios).toContain('링크 복사');
    const noMic = renderToStaticMarkup(
      React.createElement(TryExperience, {
        userAgent: UA_CHROME_DESKTOP,
        support: { recognition: false, getUserMedia: false }
      })
    );
    expect(noMic).toContain('data-try-path="wordcards_only"');
    expect(noMic).not.toContain('in-app-banner');
  });

  it('shows no banner and no cards in normal Chrome with recognition', () => {
    const html = renderToStaticMarkup(
      React.createElement(TryExperience, {
        userAgent: UA_CHROME_DESKTOP,
        support: { recognition: true, getUserMedia: true }
      })
    );
    expect(html).toContain('data-try-path="recognition"');
    expect(html).not.toContain('in-app-banner');
    expect(html).not.toContain('assembled-sentence');
  });
});

describe('item 2: guest keepsake and parent claim', () => {
  const NOW = 1_800_000_000_000;
  const keepsake = { itemId: 'pumpkin_helmet', utterance: 'Can I have a pumpkin helmet please?' };

  it('round-trips through AES-GCM and stores nothing in plaintext', async () => {
    const store = memoryStore();
    const saved = await saveGuestKeepsake(store, globalThis.crypto, keepsake, NOW);
    expect(saved.deviceCode).toMatch(/^\d{6}$/);
    expect(saved.expiresAtMs).toBe(NOW + GUEST_CLAIM_TTL_MS);
    const raw = store.map.get(GUEST_CLAIM_STORAGE_KEY)!;
    expect(raw).not.toContain('pumpkin');
    expect(raw).not.toContain('helmet');
    expect(store.map.has(GUEST_CLAIM_KEY_STORAGE_KEY)).toBe(true);
    const read = await readGuestKeepsake(store, globalThis.crypto, NOW + 1000);
    expect(read).toMatchObject({ ok: true, keepsake });
  });

  it('expires exactly at 7 days', () => {
    expect(isClaimExpired(NOW + GUEST_CLAIM_TTL_MS, NOW + GUEST_CLAIM_TTL_MS - 1)).toBe(false);
    expect(isClaimExpired(NOW + GUEST_CLAIM_TTL_MS, NOW + GUEST_CLAIM_TTL_MS)).toBe(true);
  });

  it('refuses reads after expiry and removes the stored record', async () => {
    const store = memoryStore();
    await saveGuestKeepsake(store, globalThis.crypto, keepsake, NOW);
    const late = await readGuestKeepsake(store, globalThis.crypto, NOW + GUEST_CLAIM_TTL_MS + 1);
    expect(late).toEqual({ ok: false, reason: 'expired' });
    expect(store.map.has(GUEST_CLAIM_STORAGE_KEY)).toBe(false);
    expect(await readGuestKeepsake(store, globalThis.crypto, NOW)).toEqual({ ok: false, reason: 'none' });
  });

  it('detects a wrong key and garbage as corrupt', async () => {
    const store = memoryStore();
    await saveGuestKeepsake(store, globalThis.crypto, keepsake, NOW);
    store.map.set(GUEST_CLAIM_KEY_STORAGE_KEY, toBase64(new Uint8Array(32).fill(1)));
    expect(await readGuestKeepsake(store, globalThis.crypto, NOW)).toEqual({ ok: false, reason: 'corrupt' });
    store.map.set(GUEST_CLAIM_STORAGE_KEY, '{not json');
    expect(await readGuestKeepsake(store, globalThis.crypto, NOW)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('claims with the device code once, and rejects a wrong code without consuming', async () => {
    const store = memoryStore();
    const { deviceCode } = await saveGuestKeepsake(store, globalThis.crypto, keepsake, NOW);
    const wrong = deviceCode === '000000' ? '111111' : '000000';
    expect(await claimGuestKeepsake(store, globalThis.crypto, wrong, NOW)).toEqual({
      ok: false,
      reason: 'wrong_code'
    });
    expect(await claimGuestKeepsake(store, globalThis.crypto, ` ${deviceCode} `, NOW + 5)).toEqual({
      ok: true,
      keepsake
    });
    expect(await claimGuestKeepsake(store, globalThis.crypto, deviceCode, NOW + 6)).toEqual({
      ok: false,
      reason: 'none'
    });
  });

  it('round-trips base64', () => {
    const b = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
  });

  it('picks the right Korean subject particle', () => {
    expect(withSubjectParticle('호박 헬멧')).toBe('호박 헬멧이');
    expect(withSubjectParticle('꿀차')).toBe('꿀차가');
  });

  it('child end screen: names the item, one CTA, no price or deadline', () => {
    const html = renderToStaticMarkup(
      React.createElement(GuestPassEndScreen, {
        keepsake: { itemId: 'pumpkin_helmet', utterance: 'Pumpkin helmet please' },
        deviceCode: '123456'
      })
    );
    expect(html).toContain('방금 만든 호박 헬멧이 임시 보관함에 들어갔어!');
    expect(html).toContain('Pumpkin helmet please');
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('부모님께 소개 보내기');
    for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(html).not.toContain(p);
    expect(/[0-9,]+\s*원|결제|할인|구독|만료|7일/.test(html)).toBe(false);
  });

  it('is routed in the App as a child screen without the nav', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialRoute: '/guest-end' }));
    expect(html).toContain('부모님께 소개 보내기');
    expect(html).not.toContain('주요 메뉴');
  });
});

describe('item 3: parent lesson window status bar', () => {
  const NOW = 1_800_000_000_000;

  it('schema accepts the status and rejects extra fields', () => {
    const ok: LessonWindowStatus = { ...demoLessonStatusAt(0, NOW) };
    expect(LessonWindowStatusSchema.safeParse(ok).success).toBe(true);
    expect(LessonWindowStatusSchema.safeParse({ ...ok, video_url: 'x' }).success).toBe(false);
    expect(LessonWindowStatusSchema.safeParse({ ...ok, scene_icon: 'unknown' }).success).toBe(false);
  });

  it('builds a live view, goes stale after three missed refreshes, and idles without status', () => {
    expect(LESSON_WINDOW_REFRESH_MS).toBe(10_000);
    const s = demoLessonStatusAt(0, NOW);
    expect(buildLessonWindowView(s, NOW + 5000)).toMatchObject({
      state: 'live',
      line: '런던 카페 · 선생님이 카페 주인 역할 중'
    });
    expect(buildLessonWindowView(s, NOW + LESSON_WINDOW_STALE_MS + 1).state).toBe('stale');
    expect(buildLessonWindowView(null, NOW).state).toBe('idle');
  });

  it('renders place, situation and the target sentence from text signals only', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonWindowBar, { status: demoLessonStatusAt(0, NOW), nowMs: NOW })
    );
    expect(html).toContain('런던 카페 · 선생님이 카페 주인 역할 중');
    expect(html).toContain('Can I have a warm honey tea so I stay warm?');
    expect(html).toContain('scene-icon');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('<audio');
  });

  it('renders the parent window route with the refresh note', () => {
    const html = renderToStaticMarkup(React.createElement(ParentLessonWindowView, { nowMs: NOW }));
    expect(html).toContain('수업 창문');
    expect(html).toContain('10초마다');
    const app = renderToStaticMarkup(React.createElement(App, { initialRoute: '/window' }));
    expect(app).toContain('lesson-window-bar');
  });
});

describe('item 4 and 5: director hotkeys and possession look', () => {
  it('maps F1/F2 to timestamp-only bookmarks and ignores other keys', () => {
    expect(bookmarkFromKey('F1', 1234)).toEqual({ kind: 'coaching', at_ms: 1234 });
    expect(bookmarkFromKey('F2', 99)).toEqual({ kind: 'expression', at_ms: 99 });
    expect(bookmarkFromKey('F3', 0)).toBeNull();
    expect(bookmarkFromKey('a', 0)).toBeNull();
  });

  it('calls preventDefault only for handled hotkeys', () => {
    const pushed: unknown[] = [];
    let prevented = 0;
    const mk = (key: string) => ({ key, preventDefault: () => void prevented++ });
    expect(handleDirectorKeydown(mk('F1'), 10, (b) => pushed.push(b))).toBe(true);
    expect(handleDirectorKeydown(mk('F2'), 20, (b) => pushed.push(b))).toBe(true);
    expect(handleDirectorKeydown(mk('Enter'), 30, (b) => pushed.push(b))).toBe(false);
    expect(prevented).toBe(2);
    expect(pushed).toEqual([
      { kind: 'coaching', at_ms: 10 },
      { kind: 'expression', at_ms: 20 }
    ]);
  });

  it('possessing an NPC seats the teacher avatar and sparkles only that NPC', () => {
    const ids = ['cafe', 'boutique', 'makers_lab'];
    const look = resolvePossessionLook('cafe', ids);
    expect(look.teacherAvatar).toBe(POSSESSION_TEACHER_AVATAR_STATE);
    expect(look.teacherAvatar).toBe('sitting_reading_map');
    expect(look.npcMarkers).toEqual({ cafe: POSSESSION_NPC_MARKER, boutique: 'none', makers_lab: 'none' });
    const free = resolvePossessionLook(null, ids);
    expect(free.teacherAvatar).toBe('active');
    expect(Object.values(free.npcMarkers).every((m) => m === 'none')).toBe(true);
  });

  it('renders the possession panel, and the director console includes hotkey hint and panel', () => {
    const panel = renderToStaticMarkup(
      React.createElement(PossessionPanel, {
        possessedNpc: 'cafe',
        npcIds: ['cafe', 'boutique'],
        npcLabels: { cafe: '카페 주인', boutique: '옷가게 주인' }
      })
    );
    expect(panel).toContain('벤치에 앉아 지도를 읽는 중');
    expect(panel.match(/data-marker="sparkle"/g)?.length).toBe(1);
    const director = renderToStaticMarkup(React.createElement(App, { initialRoute: '/director' }));
    expect(director).toContain('F1 코칭 순간');
    expect(director).toContain('possession-panel');
  });
});
