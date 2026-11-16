/**
 * G11 수리소(복습) (docs/08 8.6 "아이템, 힌트 단계, 마이크"; docs/03 D8 창고 장비; docs/09 P4). Things stored in the
 * home chest get no sign in the world; here the child picks one, the server hands its review card (POST
 * /v1/review/repair/pick) and the same dialog window as every review opens on it, with the hint of its box and the mic.
 * The server scores it (POST /v1/review/attempt) and moves the card; mastery pays into the ledger.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { UI_STRINGS_KO } from '@lcw/content';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN as E } from '../strings.js';
import { fetchRepairGear, pickRepair, type RepairGearView } from '../api.js';
import type { MenuPanelProps } from './types.js';
import { KoHelp } from './ko-help.js';
import { DialogPanel } from '../../dialog/DialogPanel.js';
import { createReviewSubmit, type ReviewSignView } from '../../dialog/review.js';
import { npcForReview } from '../../dialog/ReviewDock.js';
import { playSfx } from '../../dialog/sound.js';
import type { DialogResult, Level } from '../../dialog/types.js';

const R = UI_STRINGS_KO.review;

/** Due things first (they can be fixed now), then by name. */
export function repairOrder(items: readonly RepairGearView[]): RepairGearView[] {
  return [...items].sort((a, b) => Number(b.due) - Number(a.due) || a.item_name_ko.localeCompare(b.item_name_ko, 'ko'));
}

const REPAIR_CSS = `
.lcw-menu .lcw-repair{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(180px * var(--fs)),1fr));gap:8px}
.lcw-menu .lcw-repair li{list-style:none;display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px}
.lcw-menu .lcw-repair li.later{background:transparent;border-style:dashed;border-color:var(--c-ink-500)}
.lcw-menu .lcw-repair .top{display:flex;align-items:center;gap:8px}
.lcw-menu .lcw-repair .e{font-size:calc(30px * var(--fs));line-height:1}
.lcw-menu .lcw-repair .nm{font-weight:800}
.lcw-menu .lcw-repair .st{font-size:calc(12px * var(--fs));font-weight:800;align-self:flex-start;padding:1px 8px;border-radius:999px;border:2px solid var(--c-ink-900)}
.lcw-menu .lcw-repair .st.due{background:var(--c-sun)}
.lcw-menu .lcw-repair .st.later{background:var(--c-paper-100);border-color:var(--c-ink-500);color:var(--c-ink-700)}
.lcw-menu ul.lcw-repair{margin:0;padding:0}
.lcw-menu .lcw-res{margin:8px 0;padding:10px 12px;border:2px solid var(--c-ink-900);border-radius:8px;background:var(--c-leaf);color:var(--c-ink-900);font-weight:800}
.lcw-menu .lcw-res.again{background:var(--c-paper-100)}
`;

export function RepairPanel(props: MenuPanelProps): React.ReactElement {
  const { world, auth, identity, fetchImpl } = props;
  const [items, setItems] = useState<RepairGearView[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'guest'>(auth.token ? 'loading' : 'guest');
  const [open, setOpen] = useState<ReviewSignView | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ pass: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!auth.token) return;
    const r = await fetchRepairGear(auth, fetchImpl);
    if (r.ok) {
      setItems(repairOrder(r.data));
      setState('ready');
    } else setState('offline');
  }, [auth, fetchImpl]);
  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (it: RepairGearView): Promise<void> => {
    setBusy(true);
    setResult(null);
    const r = await pickRepair(auth, it.item_id, fetchImpl);
    setBusy(false);
    if (r.ok) setOpen(r.data);
    else if (r.error === 'not_due') setResult({ pass: false, text: R.notDue });
    else if (r.error === 'mastered') setResult({ pass: false, text: F.repairMastered });
    else setResult({ pass: false, text: F.offline });
  };

  const done = (r: DialogResult | null): void => {
    setOpen(null);
    if (r) {
      if (typeof r.coinsTotal === 'number') world?.setCoins?.(r.coinsTotal);
      if (r.pass) {
        playSfx('mem.fix');
        world?.celebrate(Math.max(0, Math.min(3, Math.round(r.stars))) as 0 | 1 | 2 | 3);
      }
      setResult({ pass: r.pass, text: r.feedbackKo || (r.pass ? F.repairDone : F.repairAgain) });
    }
    void load();
  };

  if (open && auth.token) {
    const level = (identity?.kind === 'child' ? identity.level : 'L1') as Level;
    return (
      <DialogPanel
        key={open.card_id}
        npc={npcForReview(world, open.ctx)}
        level={level}
        mode={open.box >= 2 ? 'recall' : 'read'}
        offers={[{ stars: Math.max(1, Math.min(3, open.stars)) as 1 | 2 | 3, text: open.text, hintTags: open.hint_tags }]}
        hint={open.hint}
        listen={open.listen}
        npcLine={R.npcLine}
        submit={createReviewSubmit({ token: auth.token, cardId: open.card_id, ...(fetchImpl ? { fetchImpl: fetchImpl as typeof fetch } : {}) })}
        onDone={(r) => done(r)}
        onClose={() => done(null)}
      />
    );
  }

  return (
    <section>
      <style>{REPAIR_CSS}</style>
      <h2>{E.repairTitle}<KoHelp of={E.repairTitle} /></h2>
      <p className="muted">{E.repairIntro}<KoHelp of={E.repairIntro} /></p>
      {props.lessonOn ? <p className="note">{E.repairInLesson}<KoHelp of={E.repairInLesson} /></p> : null}
      {result ? (
        <p className={`lcw-res${result.pass ? '' : ' again'}`} role="status">
          {result.text}
        </p>
      ) : null}
      {state === 'guest' ? <p className="note">{E.guestNote}<KoHelp of={E.guestNote} /></p> : null}
      {state === 'loading' ? <p className="muted">{E.loading}<KoHelp of={E.loading} /></p> : null}
      {state === 'offline' ? <p className="note">{E.offline}<KoHelp of={E.offline} /></p> : null}
      {state === 'ready' && items && items.length === 0 ? <p className="note">{E.repairEmpty}<KoHelp of={E.repairEmpty} /></p> : null}
      {state === 'ready' && items && items.length > 0 ? (
        <ul className="lcw-repair">
          {items.map((it) => (
            <li key={it.item_id} className={it.due ? '' : 'later'}>
              <div className="top">
                <span className="e" aria-hidden="true">
                  {it.emoji}
                </span>
                <span className="nm">{it.item_name_ko}</span>
              </div>
              <span className={`st ${it.due ? 'due' : 'later'}`}>{it.due ? `🔧 ${F.repairDue}` : F.repairLater}</span>
              <button type="button" className="btn pri" disabled={!it.due || busy || props.lessonOn} onClick={() => void pick(it)}>
                🎤 {F.repairPick}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
