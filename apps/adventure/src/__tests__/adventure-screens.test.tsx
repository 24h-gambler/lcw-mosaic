import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS, ADVENTURE_MERCHANT, ADVENTURE_PROLOGUE, ADVENTURE_SKILLS, ADVENTURE_STORY, adventureGoodsInfo, adventureGoodsName } from '@lcw/content';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import type { Engine, Snapshot } from '../engine.js';
import { buildChapterPlan, skillItem } from '../core/plan.js';
import { createRng } from '../core/rng.js';
import { emptyProgress, recordFinish } from '../core/progress.js';
import { addLine, startRecord, toActivity, wordHit } from '../core/record.js';
import { canBuy, newRun } from '../core/run.js';
import { Panel } from '../ui/Panel.js';
import { ParentSummary } from '../ui/Parent.js';
import { TalkPanel } from '../ui/Talk.js';
import { S } from '../ui/strings.js';

/** A stand-in engine: the panels only call methods on it, which these renders never do. */
const engine = { day: null, sound: { unlock() {} } } as unknown as Engine;

const PLAN = buildChapterPlan({ chapter: 1, level: 1 });
const TALKS = PLAN.encounters.flatMap((e) => e.talks);

function base(over: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    scene: 'title',
    booted: true,
    linked: true,
    help: true,
    sound: true,
    touch: false,
    chapter: 1,
    level: 1,
    islands: ADVENTURE_CHAPTERS.map((c, i) => ({ id: c.id, en: c.islandEn, ko: c.islandKo, state: i === 0 ? 'cleared' : i === 1 ? 'open' : 'previous', stars: i === 0 ? 2 : 0 })),
    selected: 1,
    cursor: 0,
    run: { hp: 20, hpMax: 20, coins: 14, items: { honeyDrop: 2, berryBun: 1, starTea: 0 }, gear: [], skills: ['warmHeal'] },
    story: null,
    shop: null,
    down: null,
    dayNote: 'none',
    exploreMsg: null,
    reveal: 0,
    battle: null,
    end: null,
    progress: emptyProgress(),
    hint: null,
    ...over
  };
}

function battle(phase: NonNullable<Snapshot['battle']>['phase'], over: Partial<NonNullable<Snapshot['battle']>> = {}): Snapshot {
  return base({
    scene: 'battle',
    battle: {
      phase,
      msg: null,
      menuIndex: 1,
      choices: TALKS.slice(0, 3),
      current: null,
      ready: false,
      items: { honeyDrop: 2, berryBun: 1, starTea: 0 },
      pouch: ['honeyDrop', 'berryBun'],
      skills: [{ id: 'warmHeal', en: ADVENTURE_SKILLS.warmHeal.nameEn, ko: ADVENTURE_SKILLS.warmHeal.nameKo, info: ADVENTURE_SKILLS.warmHeal.info }],
      talk: { tries: 0, result: null },
      stage: 0,
      stageCount: 0,
      creatureEn: PLAN.chapter.critters[0].nameEn,
      creatureKo: PLAN.chapter.critters[0].nameKo,
      turnLine: PLAN.chapter.critters[0].turns[0]!,
      befriendLine: PLAN.chapter.befriend[1],
      ...over
    }
  });
}

function finishedActivity() {
  const r = startRecord(1, 1, ['puppy', 'eagle', 'turtle'], Date.UTC(2026, 10, 16, 6, 0, 0));
  addLine(r, { en: 'Hello! Nice to meet you.', ko: '안녕! 만나서 반가워.', mode: 'voice', ok: true, stars: 3 });
  addLine(r, { en: 'I am happy.', ko: '나는 기뻐.', mode: 'pick', ok: true, stars: 2 });
  wordHit(r, 'puppy', 'caught');
  r.befriended.push('rootle', 'conekin', 'bramblebun');
  r.outcome = 'spared';
  return toActivity(r, Date.UTC(2026, 10, 16, 6, 9, 0));
}

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noBanned = (s: string) => {
  for (const p of FORBIDDEN_PLAYER_UI_PATTERNS) expect(s).not.toContain(p);
  expect(s).not.toMatch(/₩|\$\d|\d{1,2}:\d{2}/); // no price, no clock on the child's screens (docs/19)
  expect(s.toLowerCase()).not.toMatch(/\bgame\b|게임/);
};

describe('adventure screens (A01–A06)', () => {
  it('A01 island map: four isles, the next one opens once the one before is done (R2734), start and the guardian link', () => {
    const s = html(<Panel engine={engine} snap={base({ dayNote: 'document', selected: 2 })} />);
    for (const c of ADVENTURE_CHAPTERS) expect(s).toContain(`data-testid="adv-isle-${c.id}"`);
    expect(s).toContain('data-state="previous"');
    expect(s).toContain(S.state.previous.en);
    expect(s).toContain('data-testid="adv-start"');
    expect(s).toContain('data-testid="adv-new-trip"');
    expect(s).toContain('data-testid="adv-parent-link"');
    // coins and magic words carried on the trip show on the map
    expect(s).toContain('data-testid="adv-hud"');
    expect(s).not.toMatch(/tomorrow|next lesson day/i);
    noBanned(s);
    // until the day file and the server progress are in, start waits
    const loading = html(<Panel engine={engine} snap={base({ booted: false })} />);
    expect(loading.match(/<button[^>]*data-testid="adv-start"[^>]*>/)?.[0]).toContain('disabled');
    expect(loading).toContain(S.loading.en);
  });

  it('A01 state: a document that did not open says so in one line and still starts', () => {
    const s = html(<Panel engine={engine} snap={base({ dayNote: 'document-failed' })} />);
    expect(s).toContain(S.dayFailed.en);
    expect(s).toContain('data-testid="adv-start"');
    expect(s.match(/<button[^>]*data-testid="adv-start"[^>]*>/)?.[0]).not.toContain('disabled');
  });

  it('A02 island walk: voice and coins, hint, keys or touch pad, the talk button; a word stone offers listening and typing', () => {
    const walk = html(<Panel engine={engine} snap={base({ scene: 'explore', hint: { en: 'Walk right.', ko: '오른쪽으로.' }, touch: true })} />);
    expect(walk).toContain('data-testid="adv-pad-up"');
    expect(walk).toContain('data-testid="adv-action"');
    expect(walk).toContain('data-hp="20"');
    expect(walk).toContain('data-coins="14"');
    expect(walk).toContain(S.touchHint.en);
    const stone = html(
      <Panel
        engine={engine}
        snap={base({
          scene: 'explore',
          exploreMsg: { who: 'Word Stone', whoKo: '낱말 돌', lines: [{ en: 'I see a puppy.', ko: 'puppy = 강아지' }], i: 0, voice: null, stone: { w: 'puppy', ko: '강아지', emoji: '🐶', lit: false, index: 0 } }
        })}
      />
    );
    expect(stone).toContain('data-testid="adv-stone"');
    expect(stone).toContain('data-testid="adv-listen"');
    // no microphone in this environment: the typing box is there at once
    expect(stone).toContain('data-testid="adv-stone-type"');
    noBanned(walk + stone);
  });

  it('A02 talk with replies: the last line offers choices with the cursor on one (Z picks it)', () => {
    const tree = ADVENTURE_STORY[1].villager;
    const node = tree.tree.start!;
    const snap = base({
      scene: 'explore',
      cursor: 1,
      reveal: 999,
      exploreMsg: { who: tree.nameEn, whoKo: tree.nameKo, lines: [...node.lines], i: node.lines.length - 1, voice: null, choices: node.choices!.map((c) => c.say), npc: { tree, node: 'start' } }
    });
    const s = html(<Panel engine={engine} snap={snap} />);
    expect((s.match(/data-testid="adv-reply"/g) ?? []).length).toBe(node.choices!.length);
    expect(s).toMatch(/aria-current="true"[^>]*data-testid="adv-reply" data-index="1"/);
    expect(s).not.toContain('data-testid="adv-next"');
    noBanned(s);
  });

  it("A02 Tumble's cart: goods with costs and what they do, owned and short of coins shown, a way to leave", () => {
    const run = newRun();
    run.coins = 10;
    const rows = ADVENTURE_STORY[2].stock.map((g) => ({ id: g.id, kind: g.kind, ...adventureGoodsName(g.id), info: adventureGoodsInfo(g.id), cost: g.cost, check: canBuy(run, g) }));
    const s = html(<Panel engine={engine} snap={base({ scene: 'explore', chapter: 2, shop: { rows, note: S.shopNoCoins } })} />);
    expect(s).toContain('data-testid="adv-shop"');
    expect((s.match(/data-testid="adv-goods"/g) ?? []).length).toBe(rows.length + 1);
    expect(s).toContain('data-goods="leave"');
    expect(s).toContain('data-check="coins"');
    expect(s).toContain(S.shopNoCoins.en);
    expect(s).toContain(S.shopTitle.en.replace(/'/g, '&#x27;'));
    noBanned(s);
  });

  it('A03 meeting: five commands with FRIEND glowing when calm is full, SKILL, pouch, poke and the dodge turn', () => {
    const menu = html(<Panel engine={engine} snap={battle('menu', { ready: true })} />);
    for (const c of ['poke', 'talk', 'skill', 'pouch', 'friend']) expect(menu).toContain(`data-testid="adv-cmd-${c}"`);
    expect(menu).toMatch(/class="btn[^"]*glow[^"]*"[^>]*data-testid="adv-cmd-friend"/);
    expect(menu).toContain('data-testid="adv-hud"');
    const pouch = html(<Panel engine={engine} snap={battle('pouch')} />);
    expect(pouch).toContain('data-item="honeyDrop"');
    expect(pouch).not.toContain('data-item="starTea"');
    const skills = html(<Panel engine={engine} snap={battle('skillPick')} />);
    expect(skills).toContain('data-skill="warmHeal"');
    expect(html(<Panel engine={engine} snap={battle('poke')} />)).toContain('data-testid="adv-poke"');
    const dodge = html(<Panel engine={engine} snap={battle('dodge', { stage: 1, stageCount: 3 })} />);
    expect(dodge).toContain('data-testid="adv-turn"');
    expect(dodge).toContain('data-testid="adv-stage"');
    expect(dodge).toContain(`${S.stageLabel.en} 2/3`);
    expect(dodge).toContain(S.catchHint.en);
    const fr = html(<Panel engine={engine} snap={battle('befriend')} />);
    expect(fr).toContain('data-testid="adv-befriend-go"');
    expect(fr).toContain(PLAN.chapter.befriend[1].en.replace(/'/g, '&#x27;'));
    noBanned(menu + dodge + fr + skills + pouch);
  });

  it('A03 state: out of voice is a kind page that wakes the keeper at the last lantern post (no penalty words)', () => {
    const s = html(<Panel engine={engine} snap={base({ scene: 'down', down: { where: 'post', boss: true } })} />);
    expect(s).toContain('data-testid="adv-down"');
    expect(s).toContain('data-testid="adv-wake"');
    expect(s).toContain(S.downWake.en);
    expect(s).not.toMatch(/game over|you lose|failed|dead|die/i);
    noBanned(s);
    expect(html(<Panel engine={engine} snap={base({ scene: 'down', down: { where: 'start', boss: false } })} />)).toContain(S.downWakeStart.en);
  });

  it('A03 story pages: the opening, page count and Next; the last credits page says The End', () => {
    const s = html(<Panel engine={engine} snap={base({ scene: 'story', reveal: 999, story: { kind: 'prologue', who: S.title.en, whoKo: S.title.ko, lines: ADVENTURE_PROLOGUE, i: 0 } })} />);
    expect(s).toContain('data-testid="adv-story"');
    expect(s).toContain('data-kind="prologue"');
    expect(s).toContain(ADVENTURE_PROLOGUE[0]!.en.replace(/'/g, '&#x27;').replace(/"/g, '&quot;'));
    expect(s).toContain('data-testid="adv-next"');
    noBanned(s);
  });

  it('A04 talk panel: say, build, spell and pick each render their own controls; spelling never shows the word', () => {
    const by = (m: string) => TALKS.find((t) => t.mode === m)!;
    const snap = battle('talk');
    const say = html(<TalkPanel engine={engine} snap={snap} item={by('say')} help />);
    expect(say).toContain('data-mode="say"');
    expect(say).toContain(by('say').target);
    expect(say).toContain('data-testid="adv-type"');
    // review #196: with no microphone (this test page has none) Z still has a button to press — Skip is the primary
    expect(say).not.toContain('data-testid="adv-mic"');
    expect(say).toMatch(/data-primary="true"[^>]*data-testid="adv-talk-skip"/);
    const build = html(<TalkPanel engine={engine} snap={snap} item={by('build')} help />);
    expect((build.match(/data-testid="adv-tile"/g) ?? []).length).toBe(by('build').tiles!.length);
    const spell = by('spell');
    const sp = html(<TalkPanel engine={engine} snap={snap} item={spell} help />);
    expect(sp).toContain('data-testid="adv-spell-type"');
    expect(sp.replace(/data-tile="[^"]*"/g, '')).not.toContain(spell.target);
    const pick = TALKS.find((t) => t.mode === 'pick')!;
    const pk = html(<TalkPanel engine={engine} snap={snap} item={pick} help />);
    expect((pk.match(/data-testid="adv-choice"/g) ?? []).length).toBe(pick.choices!.length);
    expect(pk).toMatch(/aria-current="true"[^>]*data-testid="adv-choice" data-index="0"/);
    // magic words are picked like a reply
    const sk = html(<TalkPanel engine={engine} snap={snap} item={skillItem('warmHeal', 1, createRng(1))} help />);
    expect((sk.match(/data-testid="adv-choice"/g) ?? []).length).toBe(3);
    // after a passing answer, Next is the one button Z presses
    const passed = battle('talk', { talk: { tries: 1, result: { stars: 3, score: 1, pass: true, missed: [] } } });
    expect(html(<TalkPanel engine={engine} snap={passed} item={pick} help />)).toMatch(/data-primary="true"[^>]*data-testid="adv-talk-next"/);
    noBanned(say + build + sp + pk + sk);
  });

  it('A04 state: without speech recognition the typing box and the pieces are there at once', () => {
    const say = html(<TalkPanel engine={engine} snap={battle('talk')} item={TALKS.find((t) => t.mode === 'say')!} help={false} />);
    expect(say).not.toContain('data-testid="adv-mic"');
    expect(say).toContain('data-testid="adv-type"');
    expect(say).toContain(S.micUnavailable.en);
    expect(say).not.toMatch(/[가-힣]/); // help off: English only
  });

  it('A05 chapter end: stars, friends, words, used sentences, sail on, the way back to the document and the island map', () => {
    const act = finishedActivity();
    const end = { activity: act, friends: ['Rootle', 'Conekin', 'Bramblebun'], words: ['puppy', 'eagle', 'turtle'], nextNote: 'sail' as const, back: 'https://english-day.pages.dev/smoke-adv/', sent: 'sent' as const };
    const s = html(<Panel engine={engine} snap={base({ scene: 'end', end })} />);
    expect(s).toContain('data-testid="adv-end-stars"');
    expect(s).toContain('Bramblebun');
    expect(s).toContain('Hello! Nice to meet you.');
    expect(s).toContain('href="https://english-day.pages.dev/smoke-adv/"');
    expect(s).toContain('data-testid="adv-to-map"');
    expect(s).toMatch(/data-primary="true"[^>]*data-testid="adv-sail"/);
    expect(s).toContain(S.endNext.sail.en);
    noBanned(s);
  });

  it('A05 state: a result that could not be sent leaves the same screen; after island 4 the way on is the ending', () => {
    const act = finishedActivity();
    const end = { activity: act, friends: [], words: ['puppy'], nextNote: 'done-all' as const, back: null, sent: 'failed' as const };
    const s = html(<Panel engine={engine} snap={base({ scene: 'end', chapter: 4, end })} />);
    expect(s).toContain('data-testid="adv-end"');
    expect(s).toContain('data-testid="adv-to-map"');
    expect(s).toContain(S.endingTitle.en);
    expect(s).not.toContain('data-testid="adv-back-doc"');
  });

  it('A06 guardian summary: Korean, per chapter outcome, stars, time, sentences with how they were said', () => {
    const act = finishedActivity();
    const progress = recordFinish(emptyProgress(), 1, '2026-11-16', { stars: 3, outcome: 'spared', words: ['puppy', 'eagle', 'turtle'], activity: act });
    const s = html(<ParentSummary engine={engine} snap={base({ scene: 'parent', progress })} />);
    expect(s).toContain('data-testid="adv-parent-ch1"');
    expect(s).toContain('말로 친구가 됨');
    expect(s).toContain('9분 0초');
    expect(s).toContain('말하기 · 성공');
    expect(s).toContain('고르기');
    expect(s).toContain('아직 열리지 않았어요');
    noBanned(s);
  });

  it('A06 state: with nothing played yet it says "아직 모험 기록이 없어요"', () => {
    const s = html(<ParentSummary engine={engine} snap={base({ scene: 'parent' })} />);
    expect(s).toContain('data-testid="adv-parent-empty"');
    expect(s).toContain('아직 모험 기록이 없어요');
  });
});
