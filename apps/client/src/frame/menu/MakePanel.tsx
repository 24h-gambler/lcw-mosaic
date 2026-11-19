/**
 * Make (Dan 11-19 R326 ⑪⑫ "뭘 만들지 가이드가 없다", "상상력 자극"): today's open build challenge, today's goals that
 * pay coins (checked by the server: shop.ts), and the maker's book — what the shop's blocks and things can become,
 * as pictures (what goes in → what comes out). Building itself is the world's build mode; showing a build is the
 * showroom (a daily goal), and friends' builds are the ideas page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { DAILY_QUESTS, MAKE_RECIPES, challengeOfDay, shopItem, type MakeRecipeDef } from '@lcw/content';
import { say } from '../../world/lang.js';
import { SHOP_STRINGS as S } from '../shop-strings.js';
import { claimQuest, fetchShop, type ShopView } from '../shop-api.js';
import type { MenuPanelProps } from './types.js';
import { T, openShopOn } from './ShopPanel.js';

const MAKE_CSS = `
.lcw-menu .lcw-chal{display:grid;gap:8px;padding:12px;border:2px solid var(--c-ink-900);border-radius:12px;background:var(--c-sun);box-shadow:var(--shadow)}
.lcw-menu .lcw-chal .big{font-size:calc(40px * var(--fs));line-height:1}
.lcw-menu .lcw-chal .row{display:flex;gap:6px;flex-wrap:wrap}
.lcw-menu .lcw-chal h3{margin:0;display:flex;flex-direction:column}
.lcw-menu .lcw-recipe{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-weight:800}
.lcw-menu .lcw-recipe .in{display:inline-flex;gap:4px;align-items:center;padding:4px 8px;border:2px solid var(--c-ink-900);border-radius:8px;background:var(--c-paper-0)}
.lcw-menu .lcw-recipe .in.have{background:var(--c-leaf)}
.lcw-menu .lcw-recipe .eq{font-size:calc(20px * var(--fs))}
.lcw-menu .lcw-recipe .out{font-size:calc(28px * var(--fs))}
.lcw-menu .lcw-quests{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-menu .lcw-quests li{display:grid;grid-template-columns:auto 1fr minmax(70px,22%) auto;gap:8px;align-items:center;padding:6px 8px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px;font-weight:700}
.lcw-menu .lcw-quests li.done{background:var(--c-leaf)}
.lcw-menu .lcw-quests .t{display:flex;flex-direction:column}
.lcw-menu .lcw-book{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(220px * var(--fs)),1fr));gap:8px;list-style:none;margin:0;padding:0}
.lcw-menu .lcw-book li{display:grid;gap:6px;padding:8px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:10px}
.lcw-menu .lcw-book li.today{outline:3px solid var(--c-brand-d)}
.lcw-menu .lcw-book .tip{font-size:calc(12px * var(--fs));color:var(--c-ink-700);display:flex;flex-direction:column}
@media (max-width:600px){.lcw-menu .lcw-quests li{grid-template-columns:auto 1fr auto}.lcw-menu .lcw-quests li .bar{display:none}}
`;
let cssDone = false;
function ensureMakeCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.setAttribute('data-lcw', 'make');
  st.textContent = MAKE_CSS;
  document.head.appendChild(st);
}

/** What goes in → what comes out, as pictures. */
export function RecipePicture({ r, owned }: { r: MakeRecipeDef; owned: Record<string, number> }): React.ReactElement {
  return (
    <div className="lcw-recipe" aria-label={r.goal}>
      {r.needs.map((n, i) => {
        const item = shopItem(n.item);
        const have = (owned[n.item] ?? 0) >= n.n;
        return (
          <React.Fragment key={n.item}>
            {i > 0 ? <span className="eq" aria-hidden="true">+</span> : null}
            <span className={`in${have ? ' have' : ''}`} title={item ? `${item.adj} ${item.label}` : n.item}>
              <span aria-hidden="true">{item?.emoji ?? '🧩'}</span>
              {item?.block ? `${item.block.count * n.n}` : `×${n.n}`}
              {have ? ' ✓' : ''}
            </span>
          </React.Fragment>
        );
      })}
      <span className="eq" aria-hidden="true">
        →
      </span>
      <span className="out" aria-hidden="true">
        {r.emoji}
      </span>
    </div>
  );
}

const QUEST_ICON: Record<string, string> = Object.fromEntries(DAILY_QUESTS.map((q) => [q.key, q.emoji]));

export function MakePanel(props: MenuPanelProps): React.ReactElement {
  const { auth, fetchImpl, go, close, world } = props;
  ensureMakeCss();
  const [view, setView] = useState<ShopView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!auth.token) return;
    void fetchShop(auth, fetchImpl).then((r) => {
      if (r.ok) setView(r.data);
    });
  }, [auth, fetchImpl]);
  useEffect(load, [load]);
  const today = challengeOfDay(Date.now());
  const owned = view?.owned ?? {};
  const chal = view?.challenge;

  const claim = async (key: (typeof DAILY_QUESTS)[number]['key']): Promise<void> => {
    const r = await claimQuest(auth, key, fetchImpl);
    if (r.ok) {
      setNote(`+${r.data.reward} 🪙`);
      world?.setCoins?.(r.data.coins_total);
      load();
    } else setNote(say(S.failed).text);
  };
  const shopFor = (r: MakeRecipeDef): void => {
    const first = r.needs.map((n) => shopItem(n.item)).find((i) => i && (owned[i.key] ?? 0) === 0) ?? shopItem(r.needs[0]!.item);
    openShopOn(first?.cat ?? 'materials');
    go('shop');
  };

  return (
    <div className="lcw-make">
      <section className="lcw-chal" aria-label={say(S.makeTitle).text}>
        <span>
          <T s={S.makeTitle} />
        </span>
        <span className="big" aria-hidden="true">
          {today.emoji}
        </span>
        <h3>
          <T s={{ en: today.goal, ko: today.nameKo }} strong />
        </h3>
        <span className="tip">
          <T s={{ en: today.tip, ko: today.tipKo }} />
        </span>
        <span>
          <T s={S.makeUses} />
        </span>
        <RecipePicture r={today} owned={owned} />
        {chal ? (
          <div>
            <span>
              {say(S.makeProgress).text}: {Math.min(chal.placed, chal.goal)} / {chal.goal}
            </span>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={chal.goal} aria-valuenow={Math.min(chal.placed, chal.goal)}>
              <i style={{ width: `${Math.round((Math.min(chal.placed, chal.goal) / Math.max(1, chal.goal)) * 100)}%` }} />
            </div>
          </div>
        ) : null}
        <div className="row">
          <button type="button" className="btn" onClick={() => shopFor(today)}>
            🛍️ {say(S.shopFor).text}
          </button>
          <button
            type="button"
            className="btn pri"
            disabled={props.lessonOn}
            onClick={() => {
              close();
              void world?.goToScene('build_plot');
            }}
          >
            🏗️ {say(S.goBuild).text}
          </button>
        </div>
      </section>
      {note ? <div className="lcw-msg" role="status">{note}</div> : null}
      <h3>
        <T s={S.quests} />
      </h3>
      <ul className="lcw-quests">
        {(view?.quests ?? []).map((q) => {
          const def = DAILY_QUESTS.find((d) => d.key === q.key)!;
          const done = q.progress >= q.goal;
          return (
            <li key={q.key} className={q.claimed ? 'done' : ''} data-quest={q.key}>
              <span aria-hidden="true">{QUEST_ICON[q.key]}</span>
              <span className="t">
                <T s={{ en: q.key === 'build_today' ? `${def.en}: ${today.goal}` : def.en, ko: def.ko }} />
              </span>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={q.goal} aria-valuenow={q.progress}>
                <i style={{ width: `${Math.round((q.progress / Math.max(1, q.goal)) * 100)}%` }} />
              </div>
              <button type="button" className="btn" disabled={q.claimed || !done} onClick={() => void claim(q.key)}>
                {q.claimed ? say(S.claimed).text : `${say(S.claim).text} +${q.reward}`}
              </button>
            </li>
          );
        })}
      </ul>
      <h3>
        <T s={S.book} />
      </h3>
      <p className="note">
        <T s={S.bookHint} />
      </p>
      <ul className="lcw-book">
        {MAKE_RECIPES.map((r) => (
          <li key={r.key} className={r.key === today.key ? 'today' : ''}>
            <strong>
              <T s={{ en: r.goal, ko: r.nameKo }} />
            </strong>
            <RecipePicture r={r} owned={owned} />
            <span className="tip">
              <T s={{ en: r.tip, ko: r.tipKo }} />
            </span>
            <div>
              <button type="button" className="btn" onClick={() => shopFor(r)}>
                🛍️ {say(S.shopFor).text}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p>
        <a className="btn" href="/worlds" target="_blank" rel="noopener">
          🖼️ {say(S.ideas).text}
        </a>
      </p>
    </div>
  );
}
