/**
 * Play domain slot (App.tsx loads `./play/PlayLayer.tsx` when it is in the build): the market hall and the mine.
 *
 * - `PlayLayer`: the "내 일" card (work clock, rank, today's task with a 가기 button), the elevator buttons by the
 *   elevator, the dig button by a vein (hold, F key), the exchange board, and short Korean toasts. It sends a
 *   heartbeat every 15 s so the child's own play time moves the work clock (docs/03 D4).
 * - `playIntercept(npc, world)`: a play NPC with nothing to say yet (office closed, no suit, no ore) answers in a
 *   bubble and the card says why; the dialog does not open.
 * - `playDialogFor(npc, level)`: the sentences that NPC offers now (interview turn, clock-in, today's customer…).
 * - `onPlayResult(step)`: what a scored sentence moved (server `play`), shown as toasts; the state is fetched again.
 *
 * Everything worth something comes from the server (AGENTS 4.7): this file only shows it and asks.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LangLevel } from '@lcw/content';
import { MINE_FLOORS, TUNING, elevatorSpot, mineVeins, type MineVein } from '@lcw/sim-core';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { NpcRef, SceneId, WorldHandle } from '../world/api.js';
import { fetchPlayState, mineVein, playToken, type PlayState, type PlayStep } from './api.js';
import { PLAY_NPC_IDS, playDialogFor as dialogFor, playStepKo } from './dialogs.js';
import { MINE_FLOOR_KO, PLAY_KO, RANK_KO } from './strings.js';

/* ------------------------------------------------------------------ store (shared by the slot functions) */

interface Toast {
  id: number;
  text: string;
}
interface Store {
  token: string;
  state: PlayState | null;
  /** When `state` arrived (the card clock runs on from it between heartbeats). */
  at: number;
  toasts: Toast[];
}
let store: Store = { token: '', state: null, at: 0, toasts: [] };
const listeners = new Set<() => void>();
let toastSeq = 0;

function setStore(patch: Partial<Store>): void {
  store = { ...store, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function playToast(text: string, ms = 4200): void {
  const t = { id: ++toastSeq, text };
  setStore({ toasts: [...store.toasts.slice(-2), t] });
  setTimeout(() => setStore({ toasts: store.toasts.filter((x) => x.id !== t.id) }), ms);
}
async function refresh(beat = false): Promise<void> {
  if (!store.token) return;
  const s = await fetchPlayState(store.token, { beat });
  if (s) setStore({ state: s, at: Date.now() });
}

/**
 * The card's clock between two heartbeats: the server's minute plus the real seconds since (one game minute = one
 * real second), never more than one heartbeat's worth ahead. Display only: the server judges the hours itself.
 */
export function shownClock(s: PlayState, at: number, now: number): string {
  const ahead = Math.max(0, Math.min(TUNING.play.beatMaxAddMs, now - at));
  const m = (s.clock.minute + Math.floor(ahead / TUNING.play.realMsPerGameMinute)) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** For tests: start from a known store. */
export function resetPlayStore(s: Partial<Store> = {}): void {
  store = { token: '', state: null, at: 0, toasts: [], ...s };
  for (const l of listeners) l();
}
export function playStoreState(): PlayState | null {
  return store.state;
}

/* ------------------------------------------------------------------ slot functions App.tsx calls */

const rankKo = (r: string): string => RANK_KO[r as keyof typeof RANK_KO] ?? r;

export function playIntercept(npc: NpcRef, world: Pick<WorldHandle, 'npcSay'> | null): boolean {
  if (!PLAY_NPC_IDS.has(npc.id)) return false;
  const d = dialogFor(npc, store.token ? store.state : null, 'L1');
  if (d?.kind !== 'gate') return false;
  world?.npcSay(npc.id, d.lineEn);
  playToast(d.ko);
  return true;
}

export function playDialogFor(npc: NpcRef, level: LangLevel): { npc: NpcRef; offers: Array<{ stars: 1 | 2 | 3; text: string; hintTags: string[] }>; npcLine: string } | null {
  const d = dialogFor(npc, store.token ? store.state : null, level);
  if (!d || d.kind !== 'dialog' || d.offers.length === 0) return null;
  return { npc: d.npc, offers: d.offers, npcLine: d.npcLine };
}

export function onPlayResult(step: PlayStep | { kind: string; [k: string]: unknown }): void {
  for (const line of playStepKo(step as PlayStep, rankKo)) playToast(line);
  void refresh();
}

/* ------------------------------------------------------------------ where the child stands */

const VEINS = mineVeins();
const ELEVATORS: Array<{ id: 'hall' | (typeof MINE_FLOORS)[number]['id']; x: number; y: number; z: number }> = [
  { id: 'hall', ...elevatorSpot('hall') },
  ...MINE_FLOORS.map((f) => ({ id: f.id, ...elevatorSpot(f.id) }))
];

/** The vein the child stands at (within reach, same floor), nearest first. */
export function veinNear(p: { x: number; y: number; z: number }): MineVein | null {
  let best: { v: MineVein; d: number } | null = null;
  for (const v of VEINS) {
    if (Math.abs(v.y - p.y) > 3) continue;
    const d = Math.hypot(v.x + 0.5 - p.x, v.z + 0.5 - p.z);
    if (d < 2.4 && (!best || d < best.d)) best = { v, d };
  }
  return best?.v ?? null;
}

/** The elevator the child stands on (hall or a mine floor). */
export function elevatorNear(p: { x: number; y: number; z: number }): (typeof ELEVATORS)[number]['id'] | null {
  for (const e of ELEVATORS) if (Math.abs(e.y - p.y) < 2 && Math.hypot(e.x - p.x, e.z - p.z) < 2.6) return e.id;
  return null;
}

/** The scene that answers today's task (the 가기 button). */
export function taskScene(s: PlayState | null): SceneId {
  if (!s) return 'office';
  if (!s.job.rank && !s.job.has_suit) return 'tailor';
  return 'office';
}

function taskLine(s: PlayState): string {
  if (!s.job.rank && !s.job.has_suit) return PLAY_KO.needSuit;
  const h = s.clock.hours;
  if (h === 'closed') return PLAY_KO.hours.closed;
  if (h === 'before_open') return PLAY_KO.hours.before_open(TUNING.play.shift.openMinute - s.clock.minute);
  if (s.next) return PLAY_KO.next[s.next.ctx === 'customer' ? 'customer' : s.next.ctx === 'boss' ? s.next.key : 'interview'] ?? '';
  return s.shift?.paid ? PLAY_KO.paidToday : PLAY_KO.gate.day_done;
}

/* ------------------------------------------------------------------ the layer */

const box: React.CSSProperties = {
  background: C['paper-50'],
  border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: S.radiusCardPx,
  boxShadow: S.shadowDefault,
  fontFamily: T.fonts.ui,
  color: C['ink-900']
};
const btn = (bg: string, fg: string = C['ink-900']): React.CSSProperties => ({
  minHeight: S.touchTargetMinPx,
  padding: '0 14px',
  border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: S.radiusButtonPx,
  boxShadow: S.shadowDefault,
  background: bg,
  color: fg,
  fontWeight: 800,
  fontSize: T.scale.small.sizePx,
  fontFamily: T.fonts.ui,
  cursor: 'pointer'
});

export interface PlayLayerProps {
  world: WorldHandle | null;
  /** The linked child's device token (solo); the lesson student token is read at call time. */
  deviceToken?: string;
  /** A lesson or a dialog is on screen: the layer steps aside (the heartbeat keeps going). */
  hidden?: boolean;
}

export function PlayLayer({ world, deviceToken, hidden }: PlayLayerProps): React.ReactElement | null {
  const st = useSyncExternalStore(subscribe, () => store);
  const [pos, setPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [scene, setScene] = useState<SceneId | null>(null);
  const [hold, setHold] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [topPx, setTopPx] = useState(0);
  const cardTop = Math.max(64, topPx);
  // A phone: the top is full (goal line, review dock, view button), so the card sits bottom-left above the errand
  // button and opens upward; the market board moves into the card; dig and elevator go up a row.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 600);
  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth < 600);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const actionBottom = narrow ? 204 : 150;

  // token (read at call time: a lesson student token beats the device token)
  useEffect(() => {
    const t = playToken(deviceToken);
    if (t !== store.token) setStore({ token: t, state: null });
    void refresh(true);
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const t2 = playToken(deviceToken);
      if (t2 !== store.token) setStore({ token: t2, state: null });
      void refresh(true);
    }, 15000);
    return () => window.clearInterval(id);
  }, [deviceToken]);

  // the card clock ticks each real second (one game minute) between heartbeats
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // where the child stands (4 times a second; cheap: getStats reads numbers the engine already has)
  useEffect(() => {
    if (!world?.getStats) return;
    const id = window.setInterval(() => {
      const s = world.getStats?.();
      if (!s) return;
      setPos((p) => (p && Math.abs(p.x - s.player.x) < 0.05 && Math.abs(p.y - s.player.y) < 0.05 && Math.abs(p.z - s.player.z) < 0.05 ? p : { ...s.player }));
      setScene(s.scene);
      // stay under the goal line when it spans the left corner (a phone: it wraps to two lines across the screen)
      const g = document.querySelector('.lw-goal')?.getBoundingClientRect();
      const below = g && g.bottom > 0 && g.left < 180 ? Math.ceil(g.bottom) + 8 : 0;
      setTopPx((t) => (t === below ? t : below));
    }, 250);
    return () => window.clearInterval(id);
  }, [world]);

  const vein = pos ? veinNear(pos) : null;
  const lift = pos ? elevatorNear(pos) : null;
  const state = st.token ? st.state : null;
  const inHall = scene === 'tailor' || scene === 'workshop' || scene === 'exchange' || scene === 'office';

  const dig = async (): Promise<void> => {
    if (!vein) return;
    const r = await mineVein(store.token, vein.id);
    if (r.ok) {
      playToast(PLAY_KO.mine.got(r.ore, r.count));
      world?.celebrate(1, { add: 0 });
      void refresh();
      return;
    }
    if (r.reason === 'guest') playToast(PLAY_KO.mine.guest);
    else if (r.reason === 'tool') playToast(PLAY_KO.mine.tool(r.need_tier ?? 2));
    else if (r.reason === 'resting') playToast(PLAY_KO.mine.resting(Math.ceil((r.wait_ms ?? 60000) / 60000)));
    else if (r.reason === 'too_fast') playToast(PLAY_KO.mine.tooFast);
  };
  // a better tool digs faster (tuning holdMsByTier, keyed by the child's tool tier)
  const holdMs = TUNING.play.mine.holdMsByTier[state?.tool_tier ?? 1] ?? 1400;
  const startHold = (): void => {
    if (holdTimer.current !== null || !vein) return;
    const t0 = performance.now();
    holdTimer.current = window.setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / holdMs);
      setHold(f);
      if (f >= 1) {
        stopHold();
        void dig();
      }
    }, 50);
  };
  const stopHold = (): void => {
    if (holdTimer.current !== null) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHold(0);
  };
  // F key = dig (hold), only while standing at a vein and nobody types
  useEffect(() => {
    if (!vein || hidden) return;
    const typing = (): boolean => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'KeyF' && !e.repeat && !typing()) startHold();
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'KeyF') stopHold();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      stopHold();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vein?.id, hidden]);

  if (hidden) return null;
  const resting = vein && state ? state.resting[vein.id] : undefined;

  return (
    <div className="lcw-play" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* 내 일 card: left, under the coin chip */}
      <div
        data-play="card-wrap"
        style={{
          position: 'absolute',
          ...(narrow ? { bottom: 148 } : { top: cardTop }),
          left: 12,
          width: open ? 'min(280px, calc(100vw - 24px))' : 'auto',
          display: 'flex',
          flexDirection: narrow ? 'column-reverse' : 'column',
          alignItems: 'flex-start',
          pointerEvents: 'auto',
          zIndex: open ? 2 : undefined
        }}
      >
        <button
          type="button"
          data-play="card"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ ...btn(C['night-900'], C.sun), display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.fonts.ui }}
        >
          <span aria-hidden>💼</span>
          <span>{PLAY_KO.cardTitle}</span>
          {state ? <span style={{ fontFamily: T.fonts.pixel, color: C['paper-0'] }}>{shownClock(state, st.at, now)}</span> : null}
        </button>
        {open ? (
          <div data-play="card-body" style={{ ...box, ...(narrow ? { marginBottom: 8 } : { marginTop: 8 }), alignSelf: 'stretch', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: T.scale.small.sizePx, lineHeight: `${T.scale.small.lineHeightPx}px` }}>
            {state ? (
              <>
                <div style={{ fontWeight: 800 }}>{PLAY_KO.clock(shownClock(state, st.at, now))}</div>
                <div>
                  {state.job.rank && state.job.pay !== null ? PLAY_KO.rankLine(rankKo(state.job.rank), state.job.pay) : PLAY_KO.noJob}
                </div>
                {state.job.rank ? (
                  <div style={{ color: C['ink-700'] }}>
                    {state.job.progress.next ? PLAY_KO.promo(state.job.progress.have, state.job.progress.need, rankKo(state.job.progress.next)) : PLAY_KO.topRank}
                  </div>
                ) : null}
                {state.shift ? <div style={{ color: C['ink-700'] }}>{PLAY_KO.served(state.shift.served, state.shift.need)}</div> : null}
                <div data-play="task" style={{ fontWeight: 700, color: C['brand-d'] }}>
                  {taskLine(state)}
                </div>
                {narrow && scene === 'exchange' ? <MarketRows state={state} /> : null}
              </>
            ) : (
              <div>{PLAY_KO.mine.guest}</div>
            )}
            {!inHall ? (
              <button type="button" data-play="go" style={btn(C.sun)} onClick={() => world && void world.goToScene(taskScene(state))}>
                {PLAY_KO.go}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* elevator buttons */}
      {lift ? (
        <div data-play="elevator" style={{ ...box, position: 'absolute', left: '50%', bottom: actionBottom, transform: 'translateX(-50%)', padding: 10, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center', pointerEvents: 'auto', maxWidth: 'calc(100vw - 24px)' }}>
          <span style={{ fontWeight: 800, fontSize: T.scale.small.sizePx }}>{PLAY_KO.elevator.title}</span>
          {lift !== 'hall' ? (
            <button type="button" style={btn(C.sky)} onClick={() => world && void world.goToScene('exchange')}>
              {PLAY_KO.elevator.up}
            </button>
          ) : null}
          {MINE_FLOORS.filter((f) => f.id !== lift).map((f) => (
            <button key={f.id} type="button" data-floor={f.id} style={btn(C['paper-0'])} onClick={() => world && void world.goToScene(f.id)}>
              {PLAY_KO.elevator.down(MINE_FLOOR_KO[f.id] ?? f.id)}
            </button>
          ))}
        </div>
      ) : null}

      {/* dig button */}
      {vein && !lift ? (
        <button
          type="button"
          data-play="dig"
          data-vein={vein.id}
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          style={{ ...btn(resting ? C['line-200'] : C.sun), position: 'absolute', left: '50%', bottom: actionBottom, transform: 'translateX(-50%)', pointerEvents: 'auto', minWidth: 200, overflow: 'hidden' }}
        >
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(hold * 100)}%`, background: C.leaf, opacity: 0.5 }} />
          <span style={{ position: 'relative' }}>
            {hold > 0 ? PLAY_KO.mine.holding : resting ? PLAY_KO.mine.resting(Math.ceil(resting / 60000)) : `${PLAY_KO.mine.action(vein.ore)} · ${PLAY_KO.mine.key}`}
          </span>
        </button>
      ) : null}

      {/* exchange board */}
      {scene === 'exchange' && state && !narrow ? (
        <div data-play="market" style={{ ...box, position: 'absolute', top: topPx > 0 ? cardTop + 56 : 64, right: 12, width: 'min(240px, calc(100vw - 24px))', padding: 10, fontSize: T.scale.small.sizePx, pointerEvents: 'auto' }}>
          <MarketRows state={state} />
        </div>
      ) : null}

      {/* toasts */}
      <div style={{ position: 'absolute', left: '50%', bottom: narrow ? 262 : 210, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: 'min(420px, calc(100vw - 24px))' }}>
        {st.toasts.map((t) => (
          <div key={t.id} role="status" data-play="toast" style={{ ...box, padding: '8px 14px', fontWeight: 700, fontSize: T.scale.small.sizePx, textAlign: 'center' }}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Today's ore prices in this world and what the child carries (exchange board; inside the card on a phone). */
function MarketRows({ state }: { state: PlayState }): React.ReactElement {
  return (
    <div data-play="market-rows">
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{PLAY_KO.market.title}</div>
      {Object.entries(state.market).map(([ore, price]) => (
        <div key={ore} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{PLAY_KO.oreName(ore)}</span>
          <span style={{ fontFamily: T.fonts.pixel }}>
            🪙{price}
            {state.ores[ore] ? ` · ${PLAY_KO.market.mine(state.ores[ore]!)}` : ''}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 6, color: C['ink-700'], fontSize: T.scale.micro.sizePx }}>{PLAY_KO.market.hint}</div>
    </div>
  );
}

export default PlayLayer;
