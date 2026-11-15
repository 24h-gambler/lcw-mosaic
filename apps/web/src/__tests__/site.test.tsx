import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { App } from '../App.js';
import { routeFromPath } from '../main.js';
import { bestOfferMatch, wordHits } from '../tryFlow.js';
import { FAQ, LEARN_PAGES, PARENTS, PRICING } from '../site/copy.js';
import { HERO_LOOP_MS, heroPhaseAt, heroWordsLit } from '../site/HeroLoop.js';
import { CHILD_PAGES, parseSitePath, prerenderPaths } from '../site/routes.js';
import { SitePageView } from '../site/SiteRoot.js';
import { SAMPLE_SNAPSHOTS, parseShowroomSnapshot } from '../site/showroom.js';
import { siteCss } from '../site/siteCss.js';
import { TryScene } from '../site/TryScene.js';
import { TRY_INITIAL, TRY_OFFERS, TRY_PRICES, TRY_WALK_STEPS, TRY_WALLET, tryReducer, type TryPhase, type TryState } from '../site/tryState.js';
import { eventPayload } from '../site/track.js';
import { validateConsult } from '../site/pages/Tutoring.js';
import { normalizePassCode } from '../site/pages/Info.js';
import { projectIso, rotateQuarter, box } from '../site/voxel.js';
import { movingAverage } from '../site/widgets.js';

const PRICE_RE = /[0-9,]+\s*원|결제|할인|구독|만료|기한|남은 수량|품절/;
const GUARANTEE_RE = /보장합니다|보장해|성적 향상|몇 주 만에|유창해집니다|1위|최고의/;

const render = (path: string) => renderToStaticMarkup(<App initialRoute={routeFromPath(path)} />);
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe('site map (docs/14 §2)', () => {
  it('resolves all nine W pages, aliases and parameter routes', () => {
    const want: Record<string, string> = {
      '/': 'home',
      '/parents': 'parents',
      '/play': 'play',
      '/tutoring': 'tutoring',
      '/pricing': 'pricing',
      '/try': 'try',
      '/learn/order-a-drink': 'learnPage',
      '/s/demo': 'showroom',
      '/safety': 'safety',
      '/terms': 'terms',
      '/privacy': 'privacy',
      '/teachers': 'tutoring',
      '/worlds': 'worlds',
      '/pass': 'pass',
      '/pricing/': 'pricing'
    };
    for (const [p, page] of Object.entries(want)) expect(parseSitePath(p)?.page, p).toBe(page);
    expect(parseSitePath('/s/../../etc')).toBeNull();
    expect(parseSitePath('/director')).toBeNull();
    expect(parseSitePath('/join')).toBeNull();
    expect(routeFromPath('/learn/order-a-drink')).toBe('/learn/order-a-drink');
    expect(routeFromPath('/nowhere')).toBe('/');
  });

  it('every pre-rendered path renders the site shell, and the lesson screens stay outside it', () => {
    for (const p of prerenderPaths()) {
      const html = render(p);
      expect(html, p).toContain('data-site-page=');
    }
    expect(render('/join')).not.toContain('data-site-page=');
  });
});

describe('W01 first screen', () => {
  it('shows the one-line title, the captioned loop, both entrances and the try CTA', () => {
    const html = render('/');
    expect(html).toContain('말하면 생기는 세계');
    expect(html).toContain('영어로 말해야 물건이 생기는 3D 블록 게임');
    expect(html).toContain('data-testid="hero-loop"');
    expect(html).toContain('학부모님이세요?');
    expect(html).toContain('플레이어세요?');
    expect(html).toContain('href="/try"');
    // the loop carries its own caption (understandable with the sound off) and a pause control
    expect(html).toMatch(/s-loop-cap[\s\S]*더 좋은 장비가 됩니다/);
    expect(html).toContain('aria-pressed');
  });

  it('runs the loop phases in order within 15 seconds and paints the 3-star words progressively', () => {
    expect(HERO_LOOP_MS).toBe(15_000);
    expect([0, 4_000, 9_000, 14_000].map(heroPhaseAt)).toEqual([0, 1, 2, 3]);
    expect(heroPhaseAt(15_100)).toBe(0);
    expect(heroWordsLit(7_000, 10)).toBe(0);
    const mid = heroWordsLit(9_500, 10);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
    expect(heroWordsLit(12_000, 10)).toBe(10);
  });
});

describe('W02 parents and W05 pricing', () => {
  it('has the eleven parent sections in order', () => {
    const html = render('/parents');
    const titles = [
      PARENTS.title,
      PARENTS.problemTitle,
      PARENTS.methodTitle,
      PARENTS.proofTitle,
      PARENTS.memoryTitle,
      PARENTS.museumTitle,
      PARENTS.tutoringTitle,
      PARENTS.safetyTitle,
      PARENTS.timeTitle,
      PARENTS.priceTitle,
      PARENTS.faqTitle
    ];
    let at = -1;
    for (const t of titles) {
      const i = html.indexOf(t.replace(/"/g, '&quot;'));
      expect(i, t).toBeGreaterThan(at);
      at = i;
    }
    // sample screens and synthetic voice are labelled
    expect(html).toContain('예시 화면');
    expect(html).toContain('기계 음성 시연');
    expect(html).toContain('표로 보기');
  });

  it('shows plans, refund and cancellation on one screen, plus the ten FAQ answers', () => {
    const html = render('/pricing');
    for (const p of PRICING.plans) expect(html).toContain(p.month);
    expect(html).toContain('7일 이내 전액 환불');
    expect(html).toContain('해지');
    expect(html).toContain('Duo는 가족이 아니어도 됩니다');
    expect(FAQ).toHaveLength(10);
    for (const f of FAQ) expect(html).toContain(f.q);
  });

  it('never promises outcomes on any page (docs/14 §12)', () => {
    for (const p of prerenderPaths()) expect(GUARANTEE_RE.test(textOf(render(p))), p).toBe(false);
  });
});

describe('child pages carry no price, payment or deadline (AGENTS.md 4.9)', () => {
  const phases: TryPhase[] = ['start', 'walk', 'greet', 'choose', 'speak', 'receive', 'drink', 'save', 'end'];
  it('/play and /pass', () => {
    for (const page of CHILD_PAGES.filter((c) => c !== 'try')) {
      const loc = { page, path: `/${page}` } as const;
      const text = textOf(renderToStaticMarkup(<SitePageView loc={loc} />));
      expect(PRICE_RE.test(text), page).toBe(false);
      for (const f of FORBIDDEN_PLAYER_UI_PATTERNS) expect(text, page).not.toContain(f);
    }
    expect(render('/play')).toContain('부모님께 소개 보내기');
  });

  it('/try at every phase', () => {
    for (const phase of phases) {
      const html = renderToStaticMarkup(<TryScene initial={{ phase, stars: 3, said: TRY_OFFERS[2]!.text, cup: phase === 'receive' }} pathOverride="recognition" />);
      const text = textOf(html);
      expect(PRICE_RE.test(text), phase).toBe(false);
      for (const f of FORBIDDEN_PLAYER_UI_PATTERNS) expect(text, phase).not.toContain(f);
    }
    const end = renderToStaticMarkup(<TryScene initial={{ phase: 'end', stars: 3, said: 'x' }} />);
    expect(end).toContain('부모님께 소개 보내기');
    expect(end).toContain('학부모님이세요?');
    expect(end).toContain('어른 학습자세요?');
    expect(end).toContain('과외 문의');
  });
});

describe('W06 /try flow (WP-702: one order, no server)', () => {
  const run = (s: TryState, ...as: Parameters<typeof tryReducer>[1][]) => as.reduce(tryReducer, s);

  it('golden path: start → walk → greet → choose → speak → receive → drink → save → end', () => {
    let s = run(TRY_INITIAL, { type: 'start', sound: true });
    expect(s.phase).toBe('walk');
    for (let i = 0; i < TRY_WALK_STEPS - 1; i++) s = tryReducer(s, { type: 'walk' });
    expect(s.phase).toBe('walk');
    s = run(s, { type: 'walk' }, { type: 'greeted' }, { type: 'pick', stars: 3 });
    expect(s.phase).toBe('speak');
    s = run(s, { type: 'spoke', stars: 3, text: TRY_OFFERS[2]!.text });
    expect(s).toMatchObject({ phase: 'receive', cup: true, cookie: true, coins: TRY_WALLET - TRY_PRICES[3] });
    s = run(s, { type: 'drink' }, { type: 'drank' }, { type: 'save', yes: true });
    expect(s).toMatchObject({ phase: 'end', saved: true, drank: true });
  });

  it('a better sentence costs less, and only 3 stars earns the cookie', () => {
    expect(TRY_PRICES[3]).toBeLessThan(TRY_PRICES[2]);
    expect(TRY_PRICES[2]).toBeLessThan(TRY_PRICES[1]);
    const one = run({ ...TRY_INITIAL, phase: 'speak' }, { type: 'spoke', stars: 1, text: 'Honey tea, please.' });
    expect(one.cookie).toBe(false);
  });

  it('ignores out-of-order actions and restarts at the choice', () => {
    expect(tryReducer(TRY_INITIAL, { type: 'drink' })).toBe(TRY_INITIAL);
    expect(tryReducer({ ...TRY_INITIAL, phase: 'end' }, { type: 'restart' }).phase).toBe('choose');
  });

  it('uses the first lesson cafe sentences', () => {
    const cafe = FIRST_LESSON_PLAN.stages.find((s) => s.id === 'cafe_order')!;
    expect(TRY_OFFERS.map((o) => o.text)).toEqual([1, 2, 3].map((n) => cafe.targets.find((t) => t.stars === n)!.text));
  });

  it('gives the highest star that passes, and 3 stars only with the connector', () => {
    expect(bestOfferMatch('can I have a warm honey tea so that I stay warm', TRY_OFFERS).stars).toBe(3);
    expect(bestOfferMatch('can I have a warm honey tea I stay warm', TRY_OFFERS).stars).toBe(2);
    expect(bestOfferMatch('honey tea please', TRY_OFFERS).stars).toBe(1);
    expect(bestOfferMatch('banana', TRY_OFFERS).stars).toBe(0);
  });

  it('marks which target words were heard', () => {
    expect(wordHits('can I have honey tea', 'Can I have a warm honey tea?')).toEqual([true, true, true, false, false, true, true]);
  });

  it('starts without asking for anything and states that voice is not stored', () => {
    const html = renderToStaticMarkup(<TryScene />);
    expect(html).toContain('시작하기 (소리 켜기)');
    expect(html).toContain('목소리는 저장되지 않아요');
    expect(html).toContain('data-phase="start"');
  });
});

describe('W08 showroom (WP-703)', () => {
  it('accepts the sample and rejects live position, voice or real-name fields', () => {
    const ok = parseShowroomSnapshot(SAMPLE_SNAPSHOTS.demo);
    expect(ok?.blocks.length).toBeGreaterThan(100);
    const base = SAMPLE_SNAPSHOTS.demo as Record<string, unknown>;
    for (const extra of [{ position: [1, 2, 3] }, { voice_url: 'x' }, { real_name: '김지우' }, { owner_id: 'p1' }])
      expect(parseShowroomSnapshot({ ...base, ...extra })).toBeNull();
    expect(parseShowroomSnapshot({ ...base, avatar: { shirt: 'brand', pants: 'sky-d', hair: 'ink-700', name: 'x' } })).toBeNull();
    expect(parseShowroomSnapshot({ ...base, blocks: [[0, 0, 0, '#fff']] })).toBeNull();
  });
});

describe('W07 expression pages', () => {
  it('each page has three growing sentences, explanations, mistakes and a try button', () => {
    for (const p of LEARN_PAGES) {
      expect(p.offers.map((o) => o.stars)).toEqual([1, 2, 3]);
      const html = render(`/learn/${p.slug}`);
      expect(html).toContain(p.title);
      expect(html).toContain('이 장면 해 보기');
      expect(html).toContain('자주 틀리는 부분');
    }
  });
});

describe('forms, counters and helpers', () => {
  it('validates the consult form like the edge does', () => {
    const f = { name: '김보호', contact: '010-1234-5678', grade: '초4', days: ['토'], note: '' };
    expect(validateConsult(f)).toBe(true);
    expect(validateConsult({ ...f, contact: 'mom@example.com' })).toBe(true);
    expect(validateConsult({ ...f, contact: '12' })).toBe(false);
    expect(validateConsult({ ...f, name: ' ' })).toBe(false);
  });

  it('sends only the event name and a path without query', () => {
    expect(JSON.parse(eventPayload('try_start', '/try?utm=x#a'))).toEqual({ event: 'try_start', path: '/try' });
  });

  it('normalises pass codes', () => {
    expect(normalizePassCode(' AB12-CD ')).toBe('AB12-CD');
    expect(normalizePassCode('<script>')).toBeNull();
  });

  it('computes a 4-week moving average', () => {
    expect(movingAverage([100, 104, 108, 112, 116])).toEqual([100, 102, 104, 106, 110]);
  });

  it('draws only visible faces and turns builds a quarter at a time', () => {
    const cube = box(0, 0, 0, 2, 2, 2, 'brand');
    // 2x2x2: 4 top + 4 right + 4 left faces visible, inner faces culled
    expect(projectIso(cube).polys).toHaveLength(12);
    expect(rotateQuarter(rotateQuarter(cube, 2), 2)).toEqual(cube);
  });

  it('honours reduced motion and uses no blur or glass (08 §1, §5)', () => {
    const css = siteCss();
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/blur\(|backdrop-filter/);
  });
});
