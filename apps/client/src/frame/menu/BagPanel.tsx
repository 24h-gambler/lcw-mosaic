/**
 * G03 소지품·보관함 (docs/08 8.6; docs/03 3장 "5칸 슬롯의 결핍감은 들고 다니는 것에만", D1 소켓 6개, D8 창고 장비):
 * the 5-slot bag, the 6 worn sockets and the home chest grid, all as the server keeps them. Moving a thing between
 * the bag and the chest is a server request (owner and the 5-slot limit are checked there, AGENTS 4.7); the HUD
 * hotbar follows the server's bag afterwards.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN as E } from '../strings.js';
import { SOCKET_NAMES, fetchItems, moveThing, type ItemsView, type ThingView } from '../api.js';
import type { MenuPanelProps } from './types.js';
import { KoHelp } from './ko-help.js';
import { thingName } from './collection-names.js';

/** Bag slots in order: the server's bag things, padded with empty slots up to the bag size. */
export function bagSlots(v: ItemsView): Array<ThingView | null> {
  const bag = v.items.filter((t) => t.location === 'bag');
  const n = Math.max(v.bag_slots, bag.length);
  return Array.from({ length: n }, (_, i) => bag[i] ?? null);
}

export function chestThings(v: ItemsView): ThingView[] {
  return v.items.filter((t) => t.location === 'chest');
}

export function socketThings(v: ItemsView): Record<string, ThingView | null> {
  const out: Record<string, ThingView | null> = {};
  for (const s of SOCKET_NAMES) out[s] = v.items.find((t) => t.location === 'socket' && t.socket === s) ?? null;
  return out;
}

function Badge({ t }: { t: ThingView }): React.ReactElement | null {
  if (t.card?.mastered) return <span className="tag master">👑 {F.mastered}</span>;
  if (t.card?.due) return <span className="tag due">🔧 {F.needsRepair}</span>;
  return null;
}

function Thing(props: { t: ThingView | null; slot?: number; action?: React.ReactNode }): React.ReactElement {
  const { t, slot, action } = props;
  return (
    <div className={`lcw-thing${t ? '' : ' empty'}`} aria-label={t ? thingName(t.item_key, t.item_name_ko) : F.socketEmpty}>
      {slot !== undefined ? <span className="n">{slot + 1}</span> : null}
      <span className="e" aria-hidden="true">
        {t ? t.emoji : ''}
      </span>
      <span className="nm">{t ? thingName(t.item_key, t.item_name_ko) : F.socketEmpty}</span>
      {t ? <Badge t={t} /> : null}
      {action}
    </div>
  );
}

const THING_CSS = `
.lcw-menu .lcw-bagrow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.lcw-menu .lcw-sockets{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.lcw-menu .lcw-chest{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,calc(144px * var(--fs))),1fr));gap:8px}
.lcw-menu .lcw-thing{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px 8px;min-height:calc(112px * var(--fs));
  background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px;text-align:center}
.lcw-menu .lcw-thing.empty{background:transparent;border-style:dashed;border-color:var(--c-ink-500);color:var(--c-ink-500)}
.lcw-menu .lcw-thing .n{position:absolute;left:6px;top:4px;font-size:calc(12px * var(--fs));color:var(--c-ink-500);font-weight:700}
.lcw-menu .lcw-thing .e{font-size:calc(32px * var(--fs));line-height:1.1;min-height:calc(36px * var(--fs))}
.lcw-menu .lcw-thing .nm{font-weight:700;font-size:calc(14px * var(--fs));line-height:1.25;word-break:keep-all}
.lcw-menu .lcw-thing .lb{font-size:calc(12px * var(--fs));color:var(--c-ink-700);font-weight:700}
.lcw-menu .lcw-thing .tag{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-size:calc(12px * var(--fs));font-weight:800;padding:1px 6px;border-radius:999px;border:2px solid var(--c-ink-900)}
.lcw-menu .lcw-thing .tag.due{background:var(--c-sun)}
.lcw-menu .lcw-thing .tag.master{background:var(--c-grape);color:var(--c-paper-0);box-shadow:0 0 0 2px var(--c-sun)}
.lcw-menu .lcw-thing .btn{margin-top:auto;width:100%;padding:4px 8px;min-height:36px;box-shadow:none}
.lcw-menu .lcw-msg{margin:8px 0;padding:8px 12px;border-radius:8px;border:2px solid var(--c-ink-900);background:var(--c-sun);font-weight:700}
@media (max-width:600px){.lcw-menu .lcw-bagrow{grid-template-columns:repeat(3,minmax(0,1fr))}.lcw-menu .lcw-sockets{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-height:500px){.lcw-menu .lcw-thing{min-height:calc(96px * var(--fs))}}
`;

export function BagPanel(props: MenuPanelProps): React.ReactElement {
  const { auth, fetchImpl, go, syncBag } = props;
  const [view, setView] = useState<ItemsView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'guest'>(auth.token ? 'loading' : 'guest');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth.token) return;
    const r = await fetchItems(auth, fetchImpl);
    if (r.ok) {
      setView(r.data);
      setState('ready');
    } else setState('offline');
  }, [auth, fetchImpl]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (t: ThingView, to: 'bag' | 'chest'): Promise<void> => {
    setBusy(t.item_id);
    setMsg(null);
    const r = await moveThing(auth, t.item_id, to, fetchImpl);
    setBusy(null);
    if (!r.ok) {
      setMsg(r.error === 'bag_full' ? F.bagFull : F.offline);
      return;
    }
    await load();
    syncBag?.();
  };

  if (state === 'guest')
    return (
      <section>
        <style>{THING_CSS}</style>
        <h2>{E.bagTitle}<KoHelp of={E.bagTitle} /></h2>
        <p className="note">{E.guestNote}<KoHelp of={E.guestNote} /></p>
        <div className="lcw-bagrow">
          {Array.from({ length: 5 }, (_, i) => (
            <Thing key={i} t={null} slot={i} />
          ))}
        </div>
      </section>
    );
  if (state === 'loading' || !view)
    return (
      <section>
        <style>{THING_CSS}</style>
        <h2>{E.bagTitle}<KoHelp of={E.bagTitle} /></h2>
        <p className="muted">{state === 'offline' ? E.offline : E.loading}<KoHelp of={state === 'offline' ? E.offline : E.loading} /></p>
      </section>
    );

  const slots = bagSlots(view);
  const chest = chestThings(view);
  const sockets = socketThings(view);
  const bagFull = slots.every((s) => s !== null) && slots.length >= view.bag_slots;
  return (
    <section>
      <style>{THING_CSS}</style>
      <h2>{E.bagTitle}<KoHelp of={E.bagTitle} /></h2>
      <p className="muted">{E.bagHint}<KoHelp of={E.bagHint} /></p>
      {msg ? (
        <p className="lcw-msg" role="status">
          {msg}
        </p>
      ) : null}
      <div className="lcw-bagrow">
        {slots.map((t, i) => (
          <Thing
            key={t?.item_id ?? `e${i}`}
            t={t}
            slot={i}
            action={
              t ? (
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void move(t, 'chest')}>
                  {F.toChest}
                </button>
              ) : null
            }
          />
        ))}
      </div>
      {slots.every((s) => s === null) ? <p className="muted">{E.bagEmpty}<KoHelp of={E.bagEmpty} /></p> : null}

      <h3>{E.socketsTitle}<KoHelp of={E.socketsTitle} /></h3>
      <div className="lcw-sockets">
        {SOCKET_NAMES.map((s) => (
          <div key={s}>
            <div className="lcw-thing-label muted" style={{ textAlign: 'center', fontWeight: 700 }}>
              {F.sockets[s]}
            </div>
            <Thing t={sockets[s] ?? null} />
          </div>
        ))}
      </div>

      <h3>{E.chestTitle}<KoHelp of={E.chestTitle} /></h3>
      <p className="muted">{E.chestHint}<KoHelp of={E.chestHint} /></p>
      {chest.length === 0 ? (
        <p className="muted">{E.chestEmpty}<KoHelp of={E.chestEmpty} /></p>
      ) : (
        <div className="lcw-chest">
          {chest.map((t) => (
            <Thing
              key={t.item_id}
              t={t}
              action={
                <>
                  {t.card?.due ? (
                    <button type="button" className="btn" onClick={() => go('repair')}>
                      🔧 {F.tabs.repair}
                    </button>
                  ) : null}
                  <button type="button" className="btn" disabled={busy !== null || bagFull} onClick={() => void move(t, 'bag')}>
                    {F.toBag}
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
