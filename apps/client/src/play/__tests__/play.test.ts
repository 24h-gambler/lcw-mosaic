import { describe, expect, it } from 'vitest';
import { elevatorSpot, mineVeins } from '@lcw/sim-core';
import type { NpcRef } from '../../world/api.js';
import { SCENES } from '../../world/town.js';
import type { PlayState } from '../api.js';
import { playDialogFor, playStepKo } from '../dialogs.js';
import { elevatorNear, onPlayResult, playDialogFor as layerDialogFor, playIntercept, resetPlayStore, shownClock, taskScene, veinNear } from '../PlayLayer.js';
import { PLAY_KO } from '../strings.js';

const npc = (id: string, ctx: NpcRef['ctx']): NpcRef => ({ id, ctx, nameKo: id, nameEn: id }) as NpcRef;
const boss = npc('office_boss', 'boss');
const customer = npc('office_customer', 'customer');
const clerk = npc('exchange_clerk', 'exchange');

function state(p: Partial<PlayState> & { hours?: PlayState['clock']['hours'] } = {}): PlayState {
  const { hours = 'on_time', ...rest } = p;
  return {
    clock: { day: 0, minute: 500, hhmm: '08:20', hours },
    job: { rank: null, progress: { have: 0, need: 0, next: null }, has_suit: true, interview_turn: 'interview_intro', pay: null },
    shift: null,
    next: { ctx: 'interview', key: 'interview_intro' },
    ores: {},
    market: { coal: 4, iron: 10, gold: 35, ruby: 50, diamond: 90 },
    tool_tier: 1,
    resting: {},
    exchange_total: 0,
    coins: 100,
    ...rest
  };
}

describe('play dialogs (which sentences a hall NPC offers now)', () => {
  it('the boss: no suit or closed hours answer with a bubble; else the interview turn the server expects', () => {
    expect(playDialogFor(boss, state({ job: { ...state().job, has_suit: false } }), 'L2')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.no_suit });
    expect(playDialogFor(boss, state({ hours: 'closed' }), 'L2')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.closed });
    const d = playDialogFor(boss, state({ next: { ctx: 'interview', key: 'interview_why' } }), 'L2');
    expect(d?.kind).toBe('dialog');
    if (d?.kind !== 'dialog') return;
    expect(d.npc.ctx).toBe('interview');
    expect(d.offers.map((o) => o.stars)).toEqual([1, 2, 3]);
    expect(d.npcLine).toMatch(/why/i);
  });

  it('after the interview the boss takes the clock-in; late asks why', () => {
    const hired = { ...state().job, rank: 'intern' as const, pay: 100 };
    const d = playDialogFor(boss, state({ job: hired, next: { ctx: 'boss', key: 'boss_late' }, hours: 'late' }), 'L1');
    expect(d).toMatchObject({ kind: 'dialog', npc: { ctx: 'boss' } });
    expect(playDialogFor(boss, state({ job: hired, next: { ctx: 'customer', key: 'customer_cold_coffee' } }), 'L1')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.customers_waiting });
  });

  it('the customer brings the claim the server picked; before the clock-in only a bubble', () => {
    const d = playDialogFor(customer, state({ next: { ctx: 'customer', key: 'customer_broken_lamp' } }), 'L3');
    expect(d).toMatchObject({ kind: 'dialog', npc: { ctx: 'customer' } });
    expect(playDialogFor(customer, state({ next: { ctx: 'boss', key: 'boss_report' } }), 'L3')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.clock_in_first });
    // the day's customers are done: a thank-you, not "come during work hours"
    const paid = { day: 0, late: false, served: 2, need: 2, tips: 60, paid: true };
    expect(playDialogFor(customer, state({ next: null, shift: paid }), 'L3')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.day_done });
  });

  it('the exchange offers the ore the child carries most of; nothing carried = a bubble', () => {
    expect(playDialogFor(clerk, state(), 'L1')).toMatchObject({ kind: 'gate', ko: PLAY_KO.gate.no_ore });
    const d = playDialogFor(clerk, state({ ores: { coal: 1, iron: 3 } }), 'L1');
    expect(d?.kind === 'dialog' && d.offers[0]!.text).toMatch(/iron/i);
    expect(d?.kind === 'dialog' && d.npcLine).toContain('10 coins');
  });

  it('a guest still practises every counter (no state = no gate)', () => {
    for (const n of [boss, customer, clerk, npc('tailor', 'boutique'), npc('maker', 'makers_lab')]) expect(playDialogFor(n, null, 'L1')?.kind, n.id).toBe('dialog');
    expect(playDialogFor(npc('guide', 'guide'), null, 'L1')).toBeNull();
  });

  it('intercept: a gate says it in a bubble and a Korean toast, and keeps the dialog closed', () => {
    const said: string[] = [];
    resetPlayStore({ token: 't', state: state({ job: { ...state().job, has_suit: false } }) });
    expect(playIntercept(boss, { npcSay: (_id, t) => said.push(t) })).toBe(true);
    expect(said[0]).toMatch(/suit/);
    expect(playIntercept(npc('guide', 'guide'), { npcSay: () => undefined })).toBe(false);
    resetPlayStore();
    expect(playIntercept(boss, { npcSay: () => undefined })).toBe(false);
  });

  it('result lines in Korean, without banned words (docs/21)', () => {
    const rk = (r: string) => r;
    const lines = [
      ...playStepKo({ kind: 'interview', hired: 'intern', coins: 25 }, rk),
      ...playStepKo({ kind: 'customer', tip: 60, pay: 100, promoted: 'staff' }, rk),
      ...playStepKo({ kind: 'exchange', ore: 'coal', units: 2, coins: 9 }, rk),
      ...playStepKo({ kind: 'exchange', blocked: 'no_ore', ore: 'gold' }, rk)
    ];
    expect(lines).toEqual([PLAY_KO.result.hired('intern', 25), PLAY_KO.result.tip(60), PLAY_KO.result.pay(100), PLAY_KO.result.promoted('staff'), PLAY_KO.result.sold(2, 'coal', 9), PLAY_KO.result.noOre('gold')]);
    for (const l of lines) expect(l).not.toMatch(/게임|정답|오답|시험|평가|결제|가격|합격|시세/);
    // the same window said again: better = the difference or a raised star, same = nothing
    expect(playStepKo({ kind: 'customer', retry: 'better', coins: 30 }, rk)).toEqual([PLAY_KO.result.soldBetter(30)]);
    expect(playStepKo({ kind: 'interview', retry: 'better' }, rk)).toEqual([PLAY_KO.result.better]);
    expect(playStepKo({ kind: 'interview', retry: 'better', hired: 'staff' }, rk)).toEqual([PLAY_KO.result.hired('staff', 0)]);
    expect(playStepKo({ kind: 'exchange', ore: 'coal', units: 2, coins: 0, retry: 'same' }, rk)).toEqual([]);
    for (const l of Object.values(PLAY_KO.market)) if (typeof l === 'string') expect(l).not.toMatch(/시세|가격/);
  });

  it('the card clock runs on between heartbeats, one game minute a real second, at most one heartbeat ahead (review L1)', () => {
    const s = { clock: { day: 0, minute: 8 * 60 + 58, hhmm: '08:58', hours: 'on_time' } } as unknown as PlayState;
    expect(shownClock(s, 1000, 1000)).toBe('08:58');
    expect(shownClock(s, 1000, 3500)).toBe('09:00');
    expect(shownClock(s, 1000, 600_000)).toBe('09:28');
    const late = { clock: { day: 0, minute: 1439, hhmm: '23:59', hours: 'closed' } } as unknown as PlayState;
    expect(shownClock(late, 0, 2000)).toBe('00:01');
  });
});

describe('a step result moves the next dialog at once (no poll wait)', () => {
  it('the next interview question opens right after an answer', () => {
    const s0 = { clock: { day: 1, minute: 500, hhmm: '08:20', hours: 'on_time' }, job: { rank: null, progress: { have: 0, need: 3, next: 'staff' }, has_suit: true, interview_turn: 'interview_intro', pay: null }, shift: null, next: { ctx: 'interview', key: 'interview_intro' }, ores: {}, market: {}, tool_tier: 1, resting: {}, exchange_total: 0, coins: 0 } as unknown as PlayState;
    resetPlayStore({ token: 't', state: s0 });
    onPlayResult({ kind: 'interview', next: { ctx: 'interview', key: 'interview_why' } });
    const d = layerDialogFor(boss, 'L2');
    expect(d?.offers.length).toBeGreaterThan(0);
    expect(d?.npcLine).toMatch(/why/i);
    onPlayResult({ kind: 'interview', hired: 'intern', next: { ctx: 'boss', key: 'boss_report' } });
    expect(layerDialogFor(boss, 'L2')?.npcLine).toMatch(/morning/i);
    resetPlayStore();
  });
});

describe('where the child stands (dig and elevator buttons)', () => {
  it('a vein is reachable from the floor in front of it; the elevator from its stop', () => {
    const v = mineVeins()[0]!;
    expect(veinNear({ x: v.x + 0.5, y: v.y, z: v.z - 1.2 })?.id).toBe(v.id);
    expect(veinNear({ x: v.x + 0.5, y: v.y + 40, z: v.z - 1.2 })).toBeNull();
    expect(elevatorNear(elevatorSpot('mine_deep'))).toBe('mine_deep');
    expect(elevatorNear(elevatorSpot('hall'))).toBe('hall');
    expect(elevatorNear(SCENES.plaza.player)).toBeNull();
    // every mine scene starts on its elevator
    for (const id of ['mine', 'mine_deep', 'mine_core'] as const) expect(elevatorNear(SCENES[id].player)).toBe(id);
  });

  it('the 가기 button leads to the tailor until the suit is bought, then the office', () => {
    expect(taskScene(state({ job: { ...state().job, has_suit: false } }))).toBe('tailor');
    expect(taskScene(state())).toBe('office');
  });
});
