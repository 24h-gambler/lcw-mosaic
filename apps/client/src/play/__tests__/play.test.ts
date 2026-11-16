import { describe, expect, it } from 'vitest';
import { elevatorSpot, mineVeins } from '@lcw/sim-core';
import type { NpcRef } from '../../world/api.js';
import { SCENES } from '../../world/town.js';
import type { PlayState } from '../api.js';
import { playDialogFor, playStepKo } from '../dialogs.js';
import { elevatorNear, playIntercept, resetPlayStore, taskScene, veinNear } from '../PlayLayer.js';
import { PLAY_KO, RANK_KO } from '../strings.js';

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
    const rk = (r: string) => RANK_KO[r as keyof typeof RANK_KO];
    const lines = [
      ...playStepKo({ kind: 'interview', hired: 'intern', coins: 25 }, rk),
      ...playStepKo({ kind: 'customer', tip: 60, pay: 100, promoted: 'staff' }, rk),
      ...playStepKo({ kind: 'exchange', ore: 'coal', units: 2, coins: 9 }, rk),
      ...playStepKo({ kind: 'exchange', blocked: 'no_ore', ore: 'gold' }, rk)
    ];
    expect(lines).toEqual([PLAY_KO.result.hired('인턴', 25), PLAY_KO.result.tip(60), PLAY_KO.result.pay(100), PLAY_KO.result.promoted('사원'), PLAY_KO.result.sold(2, 'coal', 9), PLAY_KO.result.noOre('gold')]);
    for (const l of lines) expect(l).not.toMatch(/게임|정답|오답|시험|평가|결제|가격/);
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
