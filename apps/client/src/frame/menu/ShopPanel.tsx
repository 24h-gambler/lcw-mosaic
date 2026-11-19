/**
 * The shop window (Dan 11-19 R326 ⑤⑪⑫): the child goes shopping on their own — picks a category, buys with the
 * button at list price or asks the shopkeeper in English for the star price (up to half), sells back, and trades with
 * the friends in the same world. Coins, prices and things are the server's (shop-api.ts); this window asks once when
 * it opens and once per press.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { COIN_RULES, SHOP_CATALOG, SHOP_CATEGORIES, SHOP_CATEGORY_NAMES, shopItem, starPrice, tradeLines, type ShopCategory, type ShopItemDef } from '@lcw/content';
import { SayLine, type Said } from './SayLine.js';
import { say } from '../../world/lang.js';
import { SHOP_STRINGS as S, type Bi } from '../shop-strings.js';
import {
  acceptOffer,
  askShopkeeper,
  buyThing,
  cancelOffer,
  fetchOffers,
  fetchShop,
  makeOffer,
  newRequestId,
  sellThing,
  type OffersView,
  type ShopView
} from '../shop-api.js';
import { fetchItems, type ThingView } from '../api.js';
import type { MenuPanelProps } from './types.js';

/** English screen line + Korean help line (when on). */
export function T({ s, strong }: { s: Bi; strong?: boolean }): React.ReactElement {
  const v = say(s);
  return (
    <>
      {strong ? <strong>{v.text}</strong> : <span>{v.text}</span>}
      {v.help ? (
        <span className="ko" lang="ko">
          {v.help}
        </span>
      ) : null}
    </>
  );
}

const HELP_SEEN_KEY = 'lcw.shopHelpSeen';
function helpSeen(): boolean {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    /* private window: the help shows again next time */
  }
}

/** Which view the shop opens on: set by the HUD shop button, a peer tap (trade) or the maker's book. */
let pendingView: ShopCategory | 'trade' | null = null;
/** An open shop window takes the new view at once; a closed one opens on it next time. */
const SHOP_VIEW_EVENT = 'lcw:shop-view';
let shopMounted = false;
export function openShopOn(v: ShopCategory | 'trade'): void {
  if (shopMounted && typeof window !== 'undefined') {
    pendingView = null;
    window.dispatchEvent(new CustomEvent(SHOP_VIEW_EVENT, { detail: v }));
    return;
  }
  pendingView = v;
}

export const SHOP_CSS = `
.lcw-menu .lcw-shop-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
.lcw-menu .lcw-coin{display:inline-flex;gap:6px;align-items:center;padding:4px 12px;border:2px solid var(--c-ink-900);border-radius:999px;background:var(--c-sun);font-weight:800;font-variant-numeric:tabular-nums}
.lcw-menu .lcw-today{font-size:calc(12px * var(--fs));color:var(--c-ink-700);font-weight:700}
.lcw-menu .lcw-help{background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:10px;padding:10px 12px;margin:6px 0 10px;display:grid;gap:6px}
.lcw-menu .lcw-help p{margin:0;display:flex;flex-direction:column}
.lcw-menu .lcw-cats{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
.lcw-menu .lcw-cats button{display:flex;gap:6px;align-items:center;padding:6px 10px;border:2px solid var(--c-ink-900);border-radius:999px;background:var(--c-paper-0);font-weight:800;cursor:pointer}
.lcw-menu .lcw-cats button[aria-pressed="true"]{background:var(--c-sun)}
.lcw-menu .lcw-goods{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(150px * var(--fs)),1fr));gap:8px;list-style:none;margin:0;padding:0}
.lcw-menu .lcw-goods li{display:flex;flex-direction:column;gap:4px;padding:8px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:10px}
.lcw-menu .lcw-goods .e{font-size:calc(34px * var(--fs));line-height:1.1;text-align:center}
.lcw-menu .lcw-goods .n{font-weight:800;text-align:center;display:flex;flex-direction:column}
.lcw-menu .lcw-goods .p{display:flex;justify-content:center;gap:6px;font-weight:800;font-variant-numeric:tabular-nums}
.lcw-menu .lcw-goods .fx{font-size:calc(11px * var(--fs));color:var(--c-ink-700);text-align:center;font-weight:700}
.lcw-menu .lcw-goods .row{display:flex;gap:4px;flex-wrap:wrap;justify-content:center}
.lcw-menu .lcw-goods .btn{min-height:40px;padding:4px 10px;font-size:calc(13px * var(--fs))}
.lcw-menu .lcw-goods .say{display:flex;flex-direction:column;line-height:1.1}
.lcw-menu .lcw-goods .say small{font-size:calc(10px * var(--fs));font-weight:700}
.lcw-menu .lcw-msg{margin:8px 0;padding:8px 10px;border-radius:8px;border:2px solid var(--c-ink-900);background:var(--c-leaf);font-weight:800}
.lcw-menu .lcw-msg.bad{background:var(--c-paper-100)}
.lcw-menu .lcw-trade{display:grid;gap:10px}
.lcw-menu .lcw-trade ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-menu .lcw-trade li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px;font-weight:700}
.lcw-menu .lcw-trade li .grow{flex:1;min-width:120px}
.lcw-menu .lcw-sayline{display:grid;gap:6px;padding:10px 12px;border:2px solid var(--c-ink-900);border-radius:10px;background:var(--c-sun)}
.lcw-menu .lcw-sayline strong{font-size:calc(20px * var(--fs))}
.lcw-menu .lcw-sayline .row{display:flex;gap:6px;flex-wrap:wrap}
.lcw-menu .lcw-sayline input{flex:1;min-width:160px;min-height:40px;border:2px solid var(--c-ink-900);border-radius:8px;padding:2px 8px;font:inherit}
.lcw-menu .lcw-trade input{width:72px;min-height:36px;border:2px solid var(--c-ink-900);border-radius:8px;padding:2px 6px;font:inherit}
@media (max-width:600px){.lcw-menu .lcw-goods{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}}
`;
let cssDone = false;
function ensureShopCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.setAttribute('data-lcw', 'shop');
  st.textContent = SHOP_CSS;
  document.head.appendChild(st);
}

/** What the good does, in a few words (food points, block count). */
export function effectLine(i: ShopItemDef): string {
  if (i.food) {
    const parts: string[] = [];
    if (i.food.hunger) parts.push(`+${i.food.hunger} ${S.hunger.en}`);
    if (i.food.thirst) parts.push(`+${i.food.thirst} ${S.thirst.en}`);
    return parts.join(' · ');
  }
  if (i.block) return `${i.block.count} ${S.blocks.en}`;
  return '';
}

export function ShopPanel(props: MenuPanelProps): React.ReactElement {
  const { auth, fetchImpl, syncBag, close } = props;
  ensureShopCss();
  const [view, setView] = useState<ShopView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'guest'>(auth.token ? 'loading' : 'guest');
  const [cat, setCat] = useState<ShopCategory | 'trade'>(() => {
    const v = pendingView;
    pendingView = null;
    return v ?? 'clothes';
  });
  useEffect(() => {
    shopMounted = true;
    const on = (e: Event): void => setCat((e as CustomEvent<ShopCategory | 'trade'>).detail);
    window.addEventListener(SHOP_VIEW_EVENT, on);
    return () => {
      shopMounted = false;
      window.removeEventListener(SHOP_VIEW_EVENT, on);
    };
  }, []);
  const [help, setHelp] = useState<boolean>(() => !helpSeen());
  const [msg, setMsg] = useState<{ text: Bi; bad?: boolean; extra?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setCoinsOnly = useCallback((n: number) => setView((v) => (v ? { ...v, coins_total: n } : v)), []);
  const load = useCallback(() => {
    if (!auth.token) return;
    void fetchShop(auth, fetchImpl).then((r) => {
      if (r.ok) {
        setView(r.data);
        setState('ready');
      } else setState(r.error === 'guest' ? 'guest' : 'offline');
    });
  }, [auth, fetchImpl]);
  useEffect(load, [load]);

  const buy = async (i: ShopItemDef): Promise<void> => {
    setBusy(i.key);
    const r = await buyThing(auth, i.key, newRequestId(), fetchImpl);
    setBusy(null);
    if (r.ok) {
      setMsg({ text: r.data.location === 'chest' ? S.boughtChest : S.bought, extra: `${i.emoji} -${r.data.paid}` });
      setView((v) => (v ? { ...v, coins_total: r.data.coins_total, owned: { ...v.owned, [i.key]: (v.owned[i.key] ?? 0) + 1 } } : v));
      syncBag?.();
    } else setMsg({ text: r.error === 'short_of_coins' ? S.short : S.failed, bad: true });
  };

  if (state === 'guest') return <p className="note"><T s={S.guest} /></p>;
  if (state === 'offline') return <p className="note"><T s={S.offline} /></p>;
  const coins = view?.coins_total ?? 0;
  const closeHelp = (): void => {
    markHelpSeen();
    setHelp(false);
  };
  return (
    <div className="lcw-shop">
      <div className="lcw-shop-top">
        <span className="lcw-coin" aria-label={`${coins} ${S.coins.en}`}>
          🪙 {view ? coins : '…'}
        </span>
        {view ? (
          <span className="lcw-today">
            {say(S.today).text} +{view.earned_today} / {view.earn_cap}
          </span>
        ) : null}
        <button type="button" className="btn" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          ❓ {say(S.helpOpen).text}
        </button>
      </div>
      {help ? (
        <div className="lcw-help" role="note">
          <strong>{say(S.helpTitle).text}</strong>
          <p>
            <T s={S.helpEarn} />
          </p>
          <p>
            <T s={S.helpSpend} />
          </p>
          <p>
            <T s={S.helpSay} />
          </p>
          <p>
            <T s={S.helpMake} />
          </p>
          <div>
            <button type="button" className="btn pri" onClick={closeHelp}>
              {say(S.helpOk).text}
            </button>
          </div>
        </div>
      ) : null}
      <div className="lcw-cats" role="group">
        {SHOP_CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>
            <span aria-hidden="true">{SHOP_CATEGORY_NAMES[c].emoji}</span>
            <T s={{ en: SHOP_CATEGORY_NAMES[c].en, ko: SHOP_CATEGORY_NAMES[c].ko }} />
          </button>
        ))}
        <button type="button" aria-pressed={cat === 'trade'} onClick={() => setCat('trade')}>
          <span aria-hidden="true">🤝</span>
          <T s={S.trade} />
        </button>
      </div>
      {msg ? (
        <div className={`lcw-msg${msg.bad ? ' bad' : ''}`} role="status">
          {say(msg.text).text} {msg.extra ?? ''}
        </div>
      ) : null}
      {cat === 'trade' ? (
        <TradeView {...props} listPrices={view?.prices ?? {}} sellPrices={view?.sell_prices ?? {}} onCoins={setCoinsOnly} />
      ) : (
        <ul className="lcw-goods">
          {SHOP_CATALOG.filter((i) => i.cat === cat).map((i) => {
            const price = view?.prices[i.key] ?? i.price;
            const short = Math.max(0, price - coins);
            const fx = effectLine(i);
            return (
              <li key={i.key} data-item={i.key}>
                <span className="e" aria-hidden="true">
                  {i.emoji}
                </span>
                <span className="n">
                  <T s={{ en: `${i.adj} ${i.label}`, ko: i.nameKo }} />
                </span>
                {fx ? <span className="fx">{fx}</span> : null}
                <span className="p">
                  🪙 {price}
                  {view?.owned[i.key] ? <span>· ×{view.owned[i.key]}</span> : null}
                </span>
                <div className="row">
                  <button type="button" className="btn" disabled={!view || short > 0 || busy !== null} onClick={() => void buy(i)}>
                    {short > 0 && view ? `${say(S.need).text} ${short}` : say(S.buy).text}
                  </button>
                  <button
                    type="button"
                    className="btn pri say"
                    disabled={props.lessonOn}
                    onClick={() => {
                      close();
                      askShopkeeper(i.key);
                    }}
                  >
                    🗣️ {say(S.sayIt).text}
                    <small>{say(S.sayItSub).text}</small>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Child-to-child trades in this world (the server names the room) and selling back to the shop. */
function TradeView(props: MenuPanelProps & { listPrices: Record<string, number>; sellPrices: Record<string, number>; onCoins(n: number): void }): React.ReactElement {
  const { auth, fetchImpl, syncBag, onCoins, listPrices, sellPrices } = props;
  const listOf = (key: string): number => listPrices[key] ?? shopItem(key)?.price ?? 0;
  /** A friend price to start from: half the shop's price (the child changes it). */
  const startPrice = (key: string): number => Math.min(COIN_RULES.tradeMaxCoins, Math.floor(listOf(key) / 2));
  /** What the shop pays back: half of what was paid (the server's number; before it answers, the lowest it can be). */
  const sellOf = (t: ThingView): number => sellPrices[t.item_id] ?? Math.floor((starPrice(shopItem(t.item_key)?.price ?? 0, 3) * COIN_RULES.sellBackPct) / 100);
  /** One press at a time: a second tap waits for the first answer. */
  const [busy, setBusy] = useState(false);
  const once = async (f: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const [offers, setOffers] = useState<OffersView | null>(null);
  const [noRoom, setNoRoom] = useState(false);
  const [things, setThings] = useState<ThingView[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  /** The trade step waiting for the child's English line (WP-509). */
  const [step, setStep] = useState<{ kind: 'offer'; thing: ThingView } | { kind: 'accept'; offer: OffersView['offers'][number] } | null>(null);
  const [again, setAgain] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchOffers(auth, fetchImpl).then((r) => {
      if (r.ok) {
        setOffers(r.data);
        onCoins(r.data.coins_total);
        if (r.data.paid_out > 0) setNote(`${say(S.paidOut).text} +${r.data.paid_out} 🪙`);
      } else if (r.error === 'not_found') setNoRoom(true);
    });
    void fetchItems(auth, fetchImpl).then((r) => {
      if (r.ok) setThings(r.data.items.filter((t) => t.location !== 'socket'));
    });
  }, [auth, fetchImpl, onCoins]);
  useEffect(load, [load]);

  const offer = async (t: ThingView, said: Said): Promise<void> => {
    const price = Math.max(0, Math.min(COIN_RULES.tradeMaxCoins, Math.round(prices[t.item_id] ?? startPrice(t.item_key))));
    const r = await makeOffer(auth, t.item_id, price, said, fetchImpl);
    if (r.ok) {
      setStep(null);
      syncBag?.();
      load();
    } else if (r.error === 'say_again') setAgain(say(S.sayAgain).text);
    else {
      setStep(null);
      setNote(say(S.failed).text);
    }
  };
  const accept = async (o: OffersView['offers'][number], said: Said): Promise<void> => {
    const r = await acceptOffer(auth, o.id, said, fetchImpl);
    if (r.ok) {
      setStep(null);
      onCoins(r.data.coins_total);
      setNote(`${o.emoji} ${say(S.bought).text}`);
      syncBag?.();
      load();
    } else if (r.error === 'say_again') setAgain(say(S.sayAgain).text);
    else {
      setStep(null);
      setNote(say(r.error === 'short_of_coins' ? S.short : S.failed).text);
      load();
    }
  };
  const sell = async (t: ThingView): Promise<void> => {
    const r = await sellThing(auth, t.item_id, fetchImpl);
    if (r.ok) {
      onCoins(r.data.coins_total);
      setNote(`${t.emoji} +${r.data.paid} 🪙`);
      syncBag?.();
      load();
    } else setNote(say(S.failed).text);
  };

  return (
    <div className="lcw-trade">
      <p className="note">
        <T s={S.tradeHint} />
      </p>
      {note ? <div className="lcw-msg" role="status">{note}</div> : null}
      {step ? (
        <SayLine
          key={step.kind === 'offer' ? step.thing.item_id : step.offer.id}
          line={step.kind === 'offer' ? tradeLines(step.thing.item_key).offer : tradeLines(step.offer.item_key).accept}
          note={again}
          onCancel={() => setStep(null)}
          onSaid={(said) => void once(() => (step.kind === 'offer' ? offer(step.thing, said) : accept(step.offer, said)))}
        />
      ) : null}
      <h3>
        <T s={S.tradeTitle} />
      </h3>
      {noRoom ? (
        <p className="note">
          <T s={S.tradeNoRoom} />
        </p>
      ) : offers && offers.offers.length === 0 ? (
        <p className="note">
          <T s={S.tradeEmpty} />
        </p>
      ) : (
        <ul>
          {(offers?.offers ?? []).map((o) => (
            <li key={o.id} data-offer={o.id}>
              <span aria-hidden="true">{o.emoji}</span>
              <span className="grow">
                {o.label} · {o.mine ? '⭐' : o.seller_name}
              </span>
              <span>🪙 {o.price}</span>
              {o.mine ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void once(async () => {
                      const r = await cancelOffer(auth, o.id, fetchImpl);
                      if (!r.ok) setNote(say(S.failed).text);
                      syncBag?.();
                      load();
                    })
                  }
                >
                  {say(S.cancel).text}
                </button>
              ) : (
                <button type="button" className="btn pri" onClick={() => { setAgain(null); setStep({ kind: 'accept', offer: o }); }}>
                  {say(S.buy).text}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>
        <T s={S.myThings} />
      </h3>
      <ul>
        {things.map((t) => {
          const def = shopItem(t.item_key);
          return (
            <li key={t.item_id}>
              <span aria-hidden="true">{t.emoji}</span>
              <span className="grow">{def ? `${def.adj} ${def.label}` : t.item_name_ko}</span>
              {!noRoom ? (
                <>
                  <label>
                    🪙{' '}
                    <input
                      type="number"
                      min={0}
                      max={COIN_RULES.tradeMaxCoins}
                      aria-label={say(S.price).text}
                      value={prices[t.item_id] ?? startPrice(t.item_key)}
                      onChange={(e) => setPrices((p) => ({ ...p, [t.item_id]: Number(e.target.value) }))}
                    />
                  </label>
                  <button type="button" className="btn" onClick={() => { setAgain(null); setStep({ kind: 'offer', thing: t }); }}>
                    {say(S.offer).text}
                  </button>
                </>
              ) : null}
              {def ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void once(() => sell(t))}>
                  {say(S.sellShop).text} +{sellOf(t)}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
