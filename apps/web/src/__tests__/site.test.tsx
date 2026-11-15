import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { App } from '../App.js';
import { routeFromPath } from '../main.js';
import { bestOfferMatch, wordHits } from '../tryFlow.js';
import { FAQ, LEARN_PAGES, LOOP, PARENTS, PRICING, TOUR } from '../site/copy.js';
import { clipCaptionAt } from '../site/GameMedia.js';
import { SITE_CLIPS, SITE_STILLS } from '../site/media.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHILD_PAGES, SHARE_IMAGES, parseSitePath, prerenderPaths, shareImageFor } from '../site/routes.js';
import { SitePageView } from '../site/SiteRoot.js';
import { SAMPLE_SNAPSHOTS, parseShowroomSnapshot } from '../site/showroom.js';
import { siteCss } from '../site/siteCss.js';
import { TryScene } from '../site/TryScene.js';
import { chooseTryStage, worldCueFor } from '../site/TryWorld.js';
import { allPages, fillShell, prerenderPage, robotsTxt } from '../site/prerender.js';
import { TRY } from '../site/tryCopy.js';
import { TRY_LOUDNESS_TRIES, TRY_RECOGNITION_ANSWER_MS, TRY_RECOGNITION_AUDIO_MS, cardOrderStars } from '../site/TrySpeak.js';
import { TRY_INITIAL, TRY_OFFERS, TRY_PRICES, TRY_WALK_STEPS, TRY_WALLET, tryReducer, type TryPhase, type TryState } from '../site/tryState.js';
import { eventPayload } from '../site/track.js';
import { validateConsult } from '../site/pages/Tutoring.js';
import { normalizePassCode } from '../site/pages/Info.js';
import { VoxelSvg, collisions, projectIso, rotateQuarter, box } from '../site/voxel.js';
import { LEARN_ART_PARTS } from '../site/pages/Learn.js';
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
  it('shows the one-line title, the captioned real-game clip, both entrances and the try CTA', () => {
    const html = render('/');
    expect(html).toContain('말하면 생기는 세계');
    expect(html).toContain('영어로 말해야 물건이 생기는 3D 블록 게임');
    expect(html).toContain('data-testid="clip-hero-cafe"');
    // the clip waits until it is on screen: poster only, no video bytes on first load (docs/14 §11)
    expect(html).toContain('preload="none"');
    expect(html).toContain(`poster="${SITE_CLIPS['hero-cafe'].poster}"`);
    expect(html).toContain('실제 게임 화면 · 시연');
    expect(html).toContain('학부모님이세요?');
    expect(html).toContain('플레이어세요?');
    expect(html).toContain('href="/try"');
    // the loop carries its own caption (understandable with the sound off) and a pause control
    expect(html).toMatch(/s-loop-cap[\s\S]*카페 주인이 영어로 말을 걸어요/);
    expect(html).toContain('aria-pressed');
  });

  it('follows the clip with its captions, from the marks the capture recorded', () => {
    const c = SITE_CLIPS['hero-cafe'];
    const order = LOOP.captions.map(([k]) => k);
    expect(order.every((k) => k in c.marks)).toBe(true);
    expect(clipCaptionAt(0, c.marks, order)).toBe(0);
    expect(clipCaptionAt(c.marks.offers + 0.1, c.marks, order)).toBe(1);
    expect(clipCaptionAt(c.marks.speak + 0.1, c.marks, order)).toBe(2);
    expect(clipCaptionAt(c.seconds, c.marks, order)).toBe(3);
    expect(TOUR.captions.every(([k]) => k in SITE_CLIPS['tour-town'].marks)).toBe(true);
  });

  it('ships every captured file the pages name, and keeps clips inside the 1.5 MB per 15 s budget (docs/14 §11)', () => {
    const pub = join(__dirname, '../../public');
    for (const s of Object.values(SITE_STILLS)) for (const f of [s.src, s.src480]) expect(existsSync(join(pub, f)), f).toBe(true);
    for (const c of Object.values(SITE_CLIPS)) {
      expect(existsSync(join(pub, c.poster)), c.poster).toBe(true);
      const bytes = readFileSync(join(pub, c.src)).length;
      expect(bytes, c.src).toBeLessThanOrEqual(Math.max(c.seconds, 1) * 100 * 1024 * 1.05);
    }
    // nothing stale is left next to them (names are content-hashed)
    const named = new Set<string>([...Object.values(SITE_STILLS).flatMap((s) => [s.src, s.src480]), ...Object.values(SITE_CLIPS).flatMap((c) => [c.src, c.poster])]);
    for (const f of readdirSync(join(pub, 'media'))) expect(named.has(`/media/${f}`), f).toBe(true);
    for (const og of SHARE_IMAGES) expect(existsSync(join(pub, 'og', `${og}.jpg`)), og).toBe(true);
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

  it('caps card-only orders at two stars and never strands a child on a silent recognizer (docs/04 4.1)', () => {
    expect(cardOrderStars(3, true)).toBe(3);
    expect(cardOrderStars(3, false)).toBe(2);
    expect(cardOrderStars(2, false)).toBe(2);
    expect(cardOrderStars(1, false)).toBe(1);
    expect(TRY_LOUDNESS_TRIES).toBe(3);
    expect(TRY_RECOGNITION_AUDIO_MS).toBeLessThan(TRY_RECOGNITION_ANSWER_MS);
    expect(TRY_RECOGNITION_ANSWER_MS).toBeLessThanOrEqual(12_000);
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

describe('W06 /try in the 3D town (docs/19 createWorld)', () => {
  const base = { webgl2: true, coarse: false, deviceMemory: 8, hardwareConcurrency: 8, search: '' };
  it('uses the town only where it runs well, and the 2D stage everywhere else', () => {
    expect(chooseTryStage(base)).toEqual({ stage: '3d', tier: 'high', forced: false });
    expect(chooseTryStage({ ...base, coarse: true, deviceMemory: undefined })).toMatchObject({ stage: '3d', tier: 'mid' });
    expect(chooseTryStage({ ...base, webgl2: false }).stage).toBe('2d');
    expect(chooseTryStage({ ...base, deviceMemory: 2 }).stage).toBe('2d');
    expect(chooseTryStage({ ...base, saveData: true }).stage).toBe('2d');
    expect(chooseTryStage({ ...base, search: '?world=0' })).toMatchObject({ stage: '2d', forced: true });
    expect(chooseTryStage({ ...base, deviceMemory: 2, search: '?world=1' })).toMatchObject({ stage: '3d', tier: 'low', forced: true });
  });

  it('moves only while walking, shows the target line while speaking, and orders inside the cafe', () => {
    const t = 'Can I have a warm honey tea?';
    expect(worldCueFor('walk', TRY.goals, t)).toEqual({ goalKo: TRY.goals.walk, targetEn: undefined, paused: false, scene: 'plaza' });
    expect(worldCueFor('speak', TRY.goals, t)).toMatchObject({ targetEn: t, paused: true, scene: 'honey_cafe' });
    for (const ph of ['greet', 'choose', 'receive', 'drink', 'save', 'end'] as const) {
      expect(worldCueFor(ph, TRY.goals, t)).toMatchObject({ paused: true, scene: 'honey_cafe' });
    }
  });

  it('renders the 2D stage on the server, so the page works before and without the town', () => {
    const html = renderToStaticMarkup(<TryScene />);
    expect(html).toContain('data-stage="2d"');
    expect(html).not.toContain('data-testid="try-world"');
  });
});

describe('static pages for crawlers and first paint (docs/14 §11)', () => {
  const shell = '<!doctype html><html lang="ko"><head><meta charset="UTF-8" /><title>x</title>\n    <meta name="description" content="y" /></head><body><div id="root"></div><script type="module" src="/a.js"></script></body></html>';
  it('renders every public page with its own title, description, canonical and content', () => {
    const pages = allPages();
    expect(pages.length).toBeGreaterThanOrEqual(13);
    for (const p of pages) {
      const html = fillShell(shell, p);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html.match(/name="description"/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="https://lcw.worldwidesomething.com${p.path}"`);
      expect(html).toContain('<div id="root"><div class="s-root');
    }
    const parents = fillShell(shell, prerenderPage('/parents'));
    expect(parents).toContain(PARENTS.title.slice(0, 8));
    // hydrateRoot needs renderToString's text separators; renderToStaticMarkup output fails hydration on every page.
    expect(prerenderPage('/pass').body).toContain('<!-- -->');
  });

  it('gives every page a share picture, site name and large card; only listed pages are indexable', () => {
    for (const p of allPages()) {
      const html = fillShell(shell, p);
      expect(html).toContain(`<meta property="og:image" content="https://lcw.worldwidesomething.com/og/${p.image}.jpg" />`);
      expect(html).toContain('og:image:width" content="1200"');
      expect(html).toContain('og:site_name');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
      expect(html.includes('<meta name="robots" content="noindex" />')).toBe(p.path === '/pass');
    }
    expect(shareImageFor(parseSitePath('/learn/trade-items')!)).toBe('learn-trade');
    expect(shareImageFor(parseSitePath('/learn/order-a-drink')!)).toBe('learn-cafe');
    expect(shareImageFor(parseSitePath('/s/demo')!)).toBe('showroom');
  });

  it('keeps report and showroom links readable for link previews (robots), app screens out of search', () => {
    const r = robotsTxt();
    expect(r).not.toMatch(/Disallow: \/(r|s)\//);
    for (const p of ['/join', '/director', '/family', '/link', '/game/', '/v1/', '/report', '/dashboard']) expect(r).toContain(`Disallow: ${p}`);
    for (const p of prerenderPaths()) expect(r.split('\n').includes(`Disallow: ${p}`)).toBe(false);
  });

  it('clears the pre-rendered page before paint when the file is served for another address', () => {
    const html = fillShell(shell, prerenderPage('/'));
    const guard = /<script>(\(function[\s\S]*?)<\/script>/.exec(html)![1]!;
    const run = (pathname: string) => {
      const root = { innerHTML: 'landing' };
      new Function('location', 'document', guard)({ pathname }, { getElementById: () => root });
      return root.innerHTML;
    };
    expect(run('/')).toBe('landing');
    expect(run('/director')).toBe('');
    expect(run('/r/abc')).toBe('');
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

  it('joins same-colour faces into one path but keeps paint order', () => {
    const scene = [...box(0, 0, 0, 3, 3, 3, 'brand'), ...box(4, 0, 0, 2, 2, 2, 'sky')];
    const html = renderToStaticMarkup(<VoxelSvg voxels={scene} unit={10} />);
    const fills = [...html.matchAll(/<path d="[^"]+" fill="([^"]+)"/g)].map((m) => m[1]);
    const runs = projectIso(scene, 10).polys.map((p) => p.fill).filter((f, i, a) => i === 0 || a[i - 1] !== f);
    expect(fills).toEqual(runs);
    expect(fills.length).toBeLessThan(projectIso(scene, 10).polys.length);
    expect(html).not.toContain('<polygon');
  });

  it('never hides a prop inside a character on the expression pages', () => {
    for (const [scene, parts] of Object.entries(LEARN_ART_PARTS)) expect([scene, collisions(...parts)]).toEqual([scene, 0]);
  });

  it('honours reduced motion and uses no blur or glass (08 §1, §5)', () => {
    const css = siteCss();
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/blur\(|backdrop-filter/);
  });
});
