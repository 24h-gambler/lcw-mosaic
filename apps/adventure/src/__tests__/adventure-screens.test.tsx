import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS } from '@lcw/content';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import type { Engine, Snapshot } from '../engine.js';
import { buildChapterPlan } from '../core/plan.js';
import { emptyProgress, recordFinish } from '../core/progress.js';
import { addLine, startRecord, toActivity, wordHit } from '../core/record.js';
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
    help: true,
    sound: true,
    touch: false,
    chapter: 1,
    level: 1,
    islands: ADVENTURE_CHAPTERS.map((c, i) => ({ id: c.id, en: c.islandEn, ko: c.islandKo, state: i === 0 ? 'open' : i === 1 ? 'previous' : 'next-day', stars: 0 })),
    selected: 1,
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
      items: { honeyDrop: 2, berryBun: 1 },
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
  r.befriended.push('sprigget', 'puffmoth', 'bramblebun');
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
  it('A01 island map: four isles with lock reasons, today words from the document, start and the guardian link', () => {
    const s = html(<Panel engine={engine} snap={base({ dayNote: 'document', islands: base().islands })} />);
    for (const c of ADVENTURE_CHAPTERS) expect(s).toContain(`data-testid="adv-isle-${c.id}"`);
    expect(s).toContain('data-state="previous"');
    expect(s).toContain(S.state['next-day'].en);
    expect(s).toContain('data-testid="adv-start"');
    expect(s).toContain('data-testid="adv-parent-link"');
    noBanned(s);
  });

  it('A01 state: a document that did not open says so in one line and still starts', () => {
    const s = html(<Panel engine={engine} snap={base({ dayNote: 'document-failed' })} />);
    expect(s).toContain(S.dayFailed.en);
    expect(s).toContain('data-testid="adv-start"');
    expect(s).not.toMatch(/data-testid="adv-start"[^>]*disabled/);
  });

  it('A02 island walk: hint, keys or touch pad, the talk button; a word stone offers listening and typing', () => {
    const walk = html(<Panel engine={engine} snap={base({ scene: 'explore', hint: { en: 'Walk right.', ko: '오른쪽으로.' }, touch: true })} />);
    expect(walk).toContain('data-testid="adv-pad-up"');
    expect(walk).toContain('data-testid="adv-action"');
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

  it('A03 meeting: four commands with FRIEND glowing when calm is full, pouch, poke and the dodge turn', () => {
    const menu = html(<Panel engine={engine} snap={battle('menu', { ready: true })} />);
    for (const c of ['poke', 'talk', 'pouch', 'friend']) expect(menu).toContain(`data-testid="adv-cmd-${c}"`);
    expect(menu).toMatch(/class="btn[^"]*glow[^"]*"[^>]*data-testid="adv-cmd-friend"/);
    expect(html(<Panel engine={engine} snap={battle('pouch')} />)).toContain('data-testid="adv-item-honeyDrop"');
    expect(html(<Panel engine={engine} snap={battle('poke')} />)).toContain('data-testid="adv-poke"');
    const dodge = html(<Panel engine={engine} snap={battle('dodge')} />);
    expect(dodge).toContain('data-testid="adv-turn"');
    expect(dodge).toContain(S.catchHint.en);
    const fr = html(<Panel engine={engine} snap={battle('befriend')} />);
    expect(fr).toContain('data-testid="adv-befriend-go"');
    expect(fr).toContain(PLAN.chapter.befriend[1].en.replace(/'/g, '&#x27;'));
    noBanned(menu + dodge + fr);
  });

  it('A03 state: running out of voice restarts the same meeting kindly (no penalty words)', () => {
    const msg = { who: 'narrator' as const, line: { en: "Your voice bubble needs a rest. Let's try again!", ko: '말풍선이 조금 쉬어야 해요. 다시 해 봐요!' } };
    const s = html(<Panel engine={engine} snap={battle('msg', { msg })} />);
    expect(s).toContain('data-testid="adv-msg"');
    expect(s).toContain('data-testid="adv-next"');
    noBanned(s);
  });

  it('A04 talk panel: say, build, spell and pick each render their own controls; spelling never shows the word', () => {
    const by = (m: string) => TALKS.find((t) => t.mode === m)!;
    const say = html(<TalkPanel engine={engine} item={by('say')} help />);
    expect(say).toContain('data-mode="say"');
    expect(say).toContain(by('say').target);
    expect(say).toContain('data-testid="adv-type"');
    const build = html(<TalkPanel engine={engine} item={by('build')} help />);
    expect((build.match(/data-testid="adv-tile"/g) ?? []).length).toBe(by('build').tiles!.length);
    const spell = by('spell');
    const sp = html(<TalkPanel engine={engine} item={spell} help />);
    expect(sp).toContain('data-testid="adv-spell-type"');
    expect(sp.replace(/data-tile="[^"]*"/g, '')).not.toContain(spell.target);
    const pick = TALKS.find((t) => t.mode === 'pick');
    if (pick) {
      const pk = html(<TalkPanel engine={engine} item={pick} help />);
      expect((pk.match(/data-testid="adv-choice"/g) ?? []).length).toBe(pick.choices!.length);
    }
    noBanned(say + build + sp);
  });

  it('A04 state: without speech recognition the typing box and the pieces are there at once', () => {
    const say = html(<TalkPanel engine={engine} item={TALKS.find((t) => t.mode === 'say')!} help={false} />);
    expect(say).not.toContain('data-testid="adv-mic"');
    expect(say).toContain('data-testid="adv-type"');
    expect(say).toContain(S.micUnavailable.en);
    expect(say).not.toMatch(/[가-힣]/); // help off: English only
  });

  it('A05 chapter end: stars, friends, words, used sentences, the way back to the document and the island map', () => {
    const act = finishedActivity();
    const end = { activity: act, friends: ['Sprigget', 'Puffmoth', 'Bramblebun'], words: ['puppy', 'eagle', 'turtle'], nextNote: 'next-day' as const, back: 'https://english-day.pages.dev/smoke-adv/', sent: 'sent' as const };
    const s = html(<Panel engine={engine} snap={base({ scene: 'end', end })} />);
    expect(s).toContain('data-testid="adv-end-stars"');
    expect(s).toContain('Bramblebun');
    expect(s).toContain('Hello! Nice to meet you.');
    expect(s).toContain('href="https://english-day.pages.dev/smoke-adv/"');
    expect(s).toContain('data-testid="adv-to-map"');
    expect(s).toContain(S.endNext['next-day'].en);
    noBanned(s);
  });

  it('A05 state: a result that could not be sent leaves the same screen', () => {
    const act = finishedActivity();
    const end = { activity: act, friends: [], words: ['puppy'], nextNote: 'replay' as const, back: null, sent: 'failed' as const };
    const s = html(<Panel engine={engine} snap={base({ scene: 'end', end })} />);
    expect(s).toContain('data-testid="adv-end"');
    expect(s).toContain('data-testid="adv-to-map"');
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
