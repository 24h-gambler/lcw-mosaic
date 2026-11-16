import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { CAFE_MENU, CAFE_MODIFIERS, CAFE_DRINKS, lookupPhraseBank, PHRASE_BANK } from '@lcw/content';
import { AUDIO_LIMITS } from '@lcw/audio';
import { DialogPanel } from '../dialog/DialogPanel.js';
import {
  bankOffersFor,
  buildWordCards,
  chunkPhrases,
  convertMixedSpeech,
  heardMask,
  listenAllowed,
  picturesFor,
  renderHintTokens,
  spokenOffer
} from '../dialog/hints.js';
import { FIRST_SPEECH_WAIT_MS, MAX_TURN_MS, MIC_FRAME_MS, MicController, STOP_GRACE_MS, type Clock, type MicView } from '../dialog/mic-controller.js';
import {
  createBrowserSpeechEngine,
  createScriptedSpeechEngine,
  isInAppBrowser,
  kakaoOpenExternalUrl,
  mapRecognitionError,
  type SpeechCallbacks,
  type SpeechEngine
} from '../dialog/speech.js';
import { SubmitError, createLessonSubmit, createPracticeSubmit, createSoloSubmit, createSoloSubmitWith, lessonBody } from '../dialog/submit.js';
import { DIALOG_CSS } from '../dialog/styles.js';
import type { DialogPanelProps, NpcRef, UtteranceSubmit } from '../dialog/types.js';

const cafe: NpcRef = { id: 'cafe_owner', ctx: 'cafe', nameKo: '꿀벌 카페 주인', nameEn: 'Honey' };
const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 KAKAOTALK 10.9.0';

function fakeClock(): Clock & { advance(ms: number): void } {
  let t = 0;
  const timers: Array<{ every: number; next: number; fn: () => void; on: boolean }> = [];
  return {
    now: () => t,
    every(ms, fn) {
      const h = { every: ms, next: t + ms, fn, on: true };
      timers.push(h);
      return () => void (h.on = false);
    },
    advance(ms) {
      const end = t + ms;
      while (t < end) {
        t += 10;
        for (const h of timers) if (h.on && t >= h.next) {
          h.next += h.every;
          h.fn();
        }
      }
    }
  };
}

/** Engine whose callbacks the test drives by hand. */
function manualEngine() {
  let cb: SpeechCallbacks | null = null;
  const stopped: string[] = [];
  const engine: SpeechEngine = {
    source: 'browser',
    availability: () => ({ ok: true }),
    start(c) {
      cb = c;
      return { stop: () => { stopped.push('stop'); cb?.onEnd({ transcript: 'heard', confidence: 0.9 }); }, abort: () => stopped.push('abort') };
    },
  };
  return { engine, cb: () => cb!, stopped };
}

describe('dialog hints (WP-109, docs/08 8.2)', () => {
  const text = 'Can I get a cold smoothie because I am thirsty?';
  const tags = ['smoothie', 'cold', 'because'];
  it('shrinks the sentence keyword → initial → picture, and hides listening above full', () => {
    expect(renderHintTokens(text, tags, 'full').map((t) => t.shown).join(' ')).toBe(text);
    const kw = renderHintTokens(text, tags, 'keyword').map((t) => t.shown).join(' ');
    expect(kw).toContain('cold smoothie because');
    expect(kw).not.toContain('thirsty');
    expect(renderHintTokens(text, tags, 'initial').map((t) => t.shown)[0]).toBe('C__');
    expect(renderHintTokens(text, tags, 'picture').every((t) => t.shown === '')).toBe(true);
    expect(picturesFor(text)).toEqual(['🧊', '🥤', '💬']);
    expect(listenAllowed('full')).toBe(true);
    expect(listenAllowed('keyword')).toBe(false);
  });

  it('cuts ECHO phrases of 2~3 words at connectors and punctuation, never leaving a lone word', () => {
    expect(chunkPhrases('Can I have cold water, please?')).toEqual(['Can I have', 'cold water, please?']);
    const c = chunkPhrases(text);
    expect(c.join(' ')).toBe(text);
    expect(c.every((x) => x.split(' ').length >= 2)).toBe(true);
    expect(c.some((x) => x.startsWith('because'))).toBe(true);
  });

  it('word cards hold every target word, are shuffled, and are stable for one sentence', () => {
    const a = buildWordCards('Can I have cold water, please?', ['warm', 'is']);
    const words = a.map((c) => c.word);
    for (const w of ['Can', 'I', 'have', 'cold', 'water', 'please']) expect(words).toContain(w);
    expect(words.slice(0, 6).join(' ')).not.toBe('Can I have cold water please');
    expect(buildWordCards('Can I have cold water, please?', ['warm', 'is'])).toEqual(a);
  });

  it('shows Korean-mixed speech converted to English (docs/04 4.4) and colours heard words', () => {
    expect(convertMixedSpeech('Can I have 차가운 water please').converted).toBe('Can I have cold water please');
    expect(convertMixedSpeech('Can I have cold water').converted).toBeNull();
    expect(heardMask("I'd like a cold milk, please.", 'I would like cold milk')).toEqual([true, true, false, true, true, false]);
    // near words count like on the server (lenient match): "code" for cold, "smoothies" for smoothie
    expect(heardMask('Cold water, please.', 'Code water please')).toEqual([true, true, true]);
    expect(heardMask('Smoothie, please.', 'smoothies')).toEqual([true, false]);
  });

  it('the sentence the child says is the one scored, the selected one first (KakaoTalk run 2026-11-16)', () => {
    const offers = [
      { stars: 1 as const, text: 'Okay, I can go.', hintTags: [] },
      { stars: 2 as const, text: 'Yes, I can help you.', hintTags: [] },
      { stars: 3 as const, text: 'Yes, I can help you. I will go now.', hintTags: [] }
    ];
    expect(spokenOffer(offers, 1, 'Yes, I can help you.', 'L1', 'full')?.stars).toBe(2);
    expect(spokenOffer(offers, 1, 'yes I can help you I will go now', 'L1', 'full')?.stars).toBe(3);
    expect(spokenOffer(offers, 1, 'okay I can go', 'L1', 'full')?.stars).toBe(1);
    // the closest passing sentence wins ("Okay, I can go." also passes the 3-star reading at 0.6); a tie goes to
    // the longer sentence; nothing that passes keeps the selection (and its misses)
    expect(spokenOffer(offers, 3, 'Yes, I can help you.', 'L1', 'full')?.stars).toBe(2);
    expect(spokenOffer(offers, 2, 'Yes, I can help you. I will go now.', 'L1', 'full')?.stars).toBe(3);
    expect(spokenOffer(offers, 3, 'Yes, I can help you. I will go now.', 'L1', 'full')?.stars).toBe(3);
    expect(spokenOffer(offers, 2, 'banana', 'L1', 'full')?.stars).toBe(2);
    expect(spokenOffer(offers, 2, '', 'L1', 'full')?.stars).toBe(2);
  });

  it('finds offers for an NPC from the bank when the caller passes none, at the right level', () => {
    const l2 = bankOffersFor(cafe, 'L2');
    expect(l2).toHaveLength(3);
    expect(l2[2]!.text).toMatch(/because/);
    expect(l2[2]!.hintTags).toContain('because');
    const shop = bankOffersFor({ ...cafe, ctx: 'trade_shop' }, 'L1');
    expect(shop[2]!.text).toMatch(/trade/);
  });
});

describe('cafe bank never teaches clashing drinks (WP-107)', () => {
  it('every 12 x 6 request answers with a natural sentence set', () => {
    expect(CAFE_DRINKS).toHaveLength(12);
    for (const level of ['L1', 'L2', 'L3'] as const)
      for (const d of CAFE_DRINKS)
        for (const m of CAFE_MODIFIERS) {
          const e = lookupPhraseBank({ ctx: 'cafe', level, item: d.key, modifiers: [m] })!;
          expect(e.level).toBe(level);
          const t = e.offers.map((o) => o.text.toLowerCase()).join(' ');
          expect(t).toContain(d.label);
          expect(t).not.toMatch(/cold hot chocolate|warm iced tea|cold iced tea|warm smoothie|warm lemonade|warm juice/);
        }
    const honey = CAFE_MENU.find((d) => d.key === 'honey_tea')!;
    expect(lookupPhraseBank({ ctx: 'cafe', level: 'L1', item: honey.key, modifiers: ['warm'] })!.offers[1].text).toBe('Warm honey tea, please.');
    expect(PHRASE_BANK.filter((e) => e.ctx === 'trade_shop' && e.intent !== 'buy_furniture')).toHaveLength(24);
    // docs/03 D13: Toby also sells 9 furniture goods at each of 3 levels.
    expect(PHRASE_BANK.filter((e) => e.ctx === 'trade_shop' && e.intent === 'buy_furniture')).toHaveLength(27);
  });
});

describe('dialog microphone (docs/08 7.1, docs/12 9)', () => {
  it('tap starts, tap finishes and delivers', () => {
    const clock = fakeClock();
    const m = manualEngine();
    const finals: Array<string | null> = [];
    const c = new MicController(m.engine, { onView: () => {}, onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c.tap();
    expect(c.recording).toBe(true);
    m.cb().onInterim('can i');
    clock.advance(300);
    c.tap();
    expect(finals).toEqual(['heard']);
    expect(c.recording).toBe(false);
  });

  it('auto-stops 2.5 s after the child stops speaking, shows the 1.5 s hangover nudge first', () => {
    const clock = fakeClock();
    const m = manualEngine();
    const views: MicView[] = [];
    const finals: Array<string | null> = [];
    const c = new MicController(m.engine, { onView: (v) => views.push(v), onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c.tap();
    clock.advance(1000); // child thinking — no auto-stop yet
    m.cb().onInterim('can i have');
    clock.advance(MIC_FRAME_MS);
    clock.advance(1600);
    expect(views.at(-1)!.hangover).toBe(true);
    expect(finals).toEqual([]);
    clock.advance(AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS);
    expect(finals).toEqual(['heard']);
  });

  it('an engine that never answers after stop is given up on, keeping what was heard live', () => {
    const clock = fakeClock();
    let cb: SpeechCallbacks | null = null;
    const silent: SpeechEngine = { source: 'browser', availability: () => ({ ok: true }), start: (c) => ((cb = c), { stop() {}, abort() {} }) };
    const finals: Array<string | null> = [];
    const c = new MicController(silent, { onView: () => {}, onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c.tap();
    cb!.onInterim('cold water please');
    clock.advance(300);
    c.tap();
    expect(finals).toEqual([]);
    clock.advance(STOP_GRACE_MS + 20);
    expect(finals).toEqual(['cold water please']);
    c.tap();
    expect(c.recording).toBe(true);
  });

  it('a recognition error turns the recording view off before reporting the issue', () => {
    const clock = fakeClock();
    const m = manualEngine();
    const views: MicView[] = [];
    const issues: string[] = [];
    const c = new MicController(m.engine, { onView: (v) => views.push(v), onFinal: () => {}, onIssue: (i) => issues.push(i) }, clock);
    c.tap();
    expect(views.at(-1)!.recording).toBe(true);
    m.cb().onError('no_speech');
    expect(views.at(-1)!.recording).toBe(false);
    expect(issues).toEqual(['no_speech']);
    expect(c.recording).toBe(false);
  });

  it('ends the turn after 6 s of nothing and never runs past 12 s', () => {
    const clock = fakeClock();
    const m = manualEngine();
    const finals: Array<string | null> = [];
    const c = new MicController(m.engine, { onView: () => {}, onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c.tap();
    clock.advance(FIRST_SPEECH_WAIT_MS + MIC_FRAME_MS);
    expect(m.stopped).toContain('stop');
    const c2 = new MicController(m.engine, { onView: () => {}, onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c2.tap();
    for (let i = 0; i < 200; i++) {
      m.cb().onInterim(`word ${i}`);
      clock.advance(MIC_FRAME_MS);
    }
    expect(finals.length).toBe(2);
    expect(MAX_TURN_MS).toBe(12_000);
  });

  it('a tap while the stopped session is still finishing is ignored; a late old result never kills the new session', () => {
    const clock = fakeClock();
    const sessions: SpeechCallbacks[] = [];
    // Like the browser: stop() returns at once, onend arrives later.
    const engine: SpeechEngine = {
      source: 'browser',
      availability: () => ({ ok: true }),
      start(c) {
        sessions.push(c);
        return { stop: () => {}, abort: () => {} };
      }
    };
    const finals: Array<string | null> = [];
    const c = new MicController(engine, { onView: () => {}, onFinal: (r) => finals.push(r?.transcript ?? null), onIssue: () => {} }, clock);
    c.tap();
    sessions[0]!.onInterim('water');
    clock.advance(300);
    c.tap(); // stop sent, result not here yet
    c.tap(); // impatient second tap: must not open a second session
    expect(sessions).toHaveLength(1);
    sessions[0]!.onEnd({ transcript: 'water please', confidence: 0.9 });
    expect(finals).toEqual(['water please']);
    // Next turn works, and a duplicate late event from the first session is ignored.
    c.tap();
    expect(sessions).toHaveLength(2);
    sessions[0]!.onEnd({ transcript: 'stale', confidence: 0.9 });
    expect(finals).toEqual(['water please']);
    sessions[0]!.onError('network');
    expect(c.recording).toBe(true);
    sessions[1]!.onInterim('milk');
    clock.advance(300);
    c.tap();
    sessions[1]!.onEnd({ transcript: 'milk please', confidence: 0.9 });
    expect(finals).toEqual(['water please', 'milk please']);
  });

  it('sends in-app browsers, insecure pages and missing APIs to the word cards', () => {
    expect(isInAppBrowser(KAKAO_UA)).toBe(true);
    expect(kakaoOpenExternalUrl('https://lcw.worldwidesomething.com/world/?code=1')).toBe(
      'kakaotalk://web/openExternal?url=https%3A%2F%2Flcw.worldwidesomething.com%2Fworld%2F%3Fcode%3D1'
    );
    expect(createBrowserSpeechEngine({ userAgent: KAKAO_UA, isSecureContext: true }).availability()).toEqual({ ok: false, issue: 'in_app' });
    expect(createBrowserSpeechEngine({ userAgent: 'Chrome', isSecureContext: true, SpeechRecognition: undefined }).availability()).toEqual({
      ok: false,
      issue: 'unsupported'
    });
    expect(createBrowserSpeechEngine({ userAgent: 'Chrome', isSecureContext: false }).availability()).toEqual({ ok: false, issue: 'insecure' });
    expect(mapRecognitionError('not-allowed')).toBe('denied');
    expect(mapRecognitionError('no-speech')).toBe('no_speech');
  });
});

describe('submit paths are server-scored (docs/19 3, AGENTS 4.7)', () => {
  const u: UtteranceSubmit = {
    target_text: 'Can I have cold water, please?',
    transcript: 'can I have cold water please',
    chosen_stars: 3,
    hint_level: 'full',
    latency_ms: 900,
    dur_ms: 2100,
    stt_source: 'browser',
    confidence: 0.9,
    echo: false,
    attempt: 1
  };

  it('lesson submit posts the strict /v1/lesson/utterance body (no echo/attempt) and maps the reply', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(Object.keys(body).sort()).toEqual(
        ['chosen_stars', 'confidence', 'dur_ms', 'hint_level', 'latency_ms', 'stt_source', 'target_text', 'transcript'].sort()
      );
      return new Response(JSON.stringify({ pass: true, score: 1, stars: 3, feedback_ko: '완벽해요! 별 3개!', coins_total: 30, utterances_today: 1 }));
    });
    const r = await createLessonSubmit({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch })(u);
    expect(fetchImpl.mock.calls[0]![0]).toBe('/v1/lesson/utterance');
    expect(r).toEqual({ pass: true, stars: 3, feedbackKo: '완벽해요! 별 3개!', coinsTotal: 30 });
    expect(lessonBody(u)).not.toHaveProperty('echo');
    expect(lessonBody({ ...u, dialogId: 'd' })).not.toHaveProperty('dialogId');
  });

  it('solo submit sends the panel dialog id, allows free talk (empty target) and maps asked_key / matched sentence', async () => {
    const sent: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Response(
        JSON.stringify({ pass: true, score: 0.9, stars: 2, missed: [], feedback_ko: 'ok', granted: null, memory_card: null, asked_key: 'cafe', target_text: 'Where is the cafe?' })
      );
    });
    const submit = createSoloSubmitWith({ token: 'tok', npc: cafe, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await submit({ ...u, target_text: '', dialogId: 'dlg-panel-1' });
    expect(sent[0]!.dialog_id).toBe('dlg-panel-1');
    expect(sent[0]!.target_text).toBe('');
    expect(r).toMatchObject({ pass: true, stars: 2, askedKey: 'cafe', matchedText: 'Where is the cafe?' });
    expect(r.itemKey).toBeUndefined();
  });

  it('a guest (no lesson, no linked device) practices on the device: real bank check, nothing granted', async () => {
    const practice = createPracticeSubmit(cafe, 'L1');
    const ok = await practice({ ...u, target_text: 'Can I have some cold water, please?', transcript: 'can I have some cold water please' });
    expect(ok).toMatchObject({ pass: true, stars: 3, practice: true });
    expect(ok.itemKey).toBeUndefined();
    expect(ok.coinsTotal).toBeUndefined();
    const made = await practice({ ...u, target_text: 'hi', transcript: 'hi' });
    expect(made.pass).toBe(false);
    const typed = await practice({ ...u, target_text: 'Can I have some cold water, please?', transcript: 'Can I have some cold water please', stt_source: 'keyboard' });
    expect(typed.stars).toBe(2);
    // createSoloSubmit with no token at all falls back to practice instead of an error the child cannot pass.
    const guest = await createSoloSubmit(cafe)({ ...u, target_text: 'Water, please.', transcript: 'water please', chosen_stars: 1 });
    expect(guest).toMatchObject({ pass: true, practice: true });
  });

  it('solo play at home sends the linked device token when there is no lesson token', async () => {
    const auths: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      auths.push((init!.headers as Record<string, string>).authorization ?? '');
      return new Response(JSON.stringify({ pass: true, score: 1, stars: 1, missed: [], feedback_ko: 'ok', granted: null, memory_card: null }));
    }) as typeof fetch;
    try {
      const r = await createSoloSubmit(cafe, { deviceToken: 'dev-token-0123456789abcdef0123456789' })(u);
      expect(r.practice).toBeUndefined();
      expect(auths).toEqual(['Bearer dev-token-0123456789abcdef0123456789']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('an expired lesson token is an auth error and a bad request is not retried as a network error', async () => {
    const gone = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(createSoloSubmitWith({ token: 'old', npc: cafe, fetchImpl: gone as unknown as typeof fetch })(u)).rejects.toMatchObject({ kind: 'auth' });
    const bad = vi.fn(async () => new Response('{}', { status: 400 }));
    await expect(createSoloSubmitWith({ token: 't', npc: cafe, fetchImpl: bad as unknown as typeof fetch })(u)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('solo submit posts to /v1/converse/score with no price/item/player and returns the server item', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body).not.toHaveProperty('price');
      expect(body).not.toHaveProperty('item_id');
      expect(body).not.toHaveProperty('player_id');
      expect(body.npc_ctx).toBe('cafe');
      expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
      return new Response(
        JSON.stringify({ pass: true, score: 1, stars: 3, missed: [], feedback_ko: 'ok', coins_total: 190, granted: { item_id: 'water', slot_or_socket: 'RightHand_Socket', coins_delta: -10 }, memory_card: null })
      );
    });
    const r = await createSoloSubmitWith({ token: 'tok', npc: cafe, fetchImpl: fetchImpl as unknown as typeof fetch, dialogId: 'd' })(u);
    expect(r).toMatchObject({ pass: true, stars: 3, coinsTotal: 190, itemKey: 'water' });
  });

  it('no token or a failed network is an error the panel can retry, never a made-up result', async () => {
    await expect(createSoloSubmitWith({ token: '', npc: cafe })(u)).rejects.toBeInstanceOf(SubmitError);
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createLessonSubmit({ token: 't', fetchImpl: down as unknown as typeof fetch })(u)).rejects.toMatchObject({ kind: 'network' });
  });
});

/** Visible text of server-rendered markup (offer words are separate spans). */
const textOf = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

describe('DialogPanel render (WP-109)', () => {
  const base: DialogPanelProps = {
    npc: cafe,
    level: 'L1',
    mode: 'guided',
    offers: [],
    hint: 'full',
    submit: async () => ({ pass: true, stars: 1, feedbackKo: '' }),
    onDone: () => {},
    onClose: () => {},
    speech: createScriptedSpeechEngine(['Water, please.'])
  };

  it('renders the bank offers, the NPC question, a 72px mic and the fallbacks, with no forbidden words or prices', () => {
    const html = renderToStaticMarkup(<DialogPanel {...base} />);
    const text = textOf(html);
    expect(html).toContain('Welcome to the honey cafe!');
    expect(text).toContain('Can I have some cold water, please?');
    expect(html).toContain('단어 카드');
    expect(html).toContain('글자로 쓰기');
    expect(html).toContain('lcw-mic');
    expect(DIALOG_CSS).toContain('width:72px;height:72px');
    for (const bad of FORBIDDEN_PLAYER_UI_PATTERNS) expect(html).not.toContain(bad);
    expect(html).not.toMatch(/₩|원\b|결제|가격/);
  });

  it('a phone without speech recognition opens on the word cards with a warm notice', () => {
    const noMic: SpeechEngine = { source: 'browser', availability: () => ({ ok: false, issue: 'in_app' }), start: () => ({ stop() {}, abort() {} }) };
    const html = renderToStaticMarkup(<DialogPanel {...base} speech={noMic} />);
    expect(html).toContain('카카오톡 안에서는 마이크가 안 될 수 있어요.');
    expect(html).toContain('lcw-card');
    expect(html).toContain('단어 카드를 순서대로 눌러요');
  });

  it('keeps sizes in the font-scale variable so 150% scales everything (docs/08: one screen at 150%)', () => {
    const html = renderToStaticMarkup(<DialogPanel {...base} fontScale={1.5} hint="initial" />);
    expect(html).toContain('--fs:1.5');
    expect(html).toContain('C__');
    expect(textOf(html)).not.toContain('Can I have cold water');
    expect(DIALOG_CSS).toContain('calc(22px * var(--fs))');
  });

  it('given offers win over the bank (lesson targets), free mode shows them as ideas', () => {
    const html = renderToStaticMarkup(
      <DialogPanel {...base} mode="free" offers={[{ stars: 1, text: 'I would build a cafe.', hintTags: ['i would'] }]} />
    );
    expect(textOf(html)).toContain('I would build a cafe.');
    expect(html).toContain('이런 말도 할 수 있어요');
    expect(textOf(html)).not.toContain('Can I have cold water');
  });
});
