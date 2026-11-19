/**
 * The lesson's side panel and the trade window (R325, Dan 11-19 lesson: "화면 아래 중앙을 계속 차지하는 부분(수업 창)을
 * 옆 정보 패널로", "선생님에게 상호작용하면 언제든 거래 창"). docs/18 §11.
 *
 * The side panel sits on the right under the HUD's right column (stars, view button, minimap, 1PC teacher button —
 * world/hud.ts measures them into --lcw-hud-right-b) and folds to one small row, so the world stays the child's: no
 * window opens by itself, the child walks to the stage's NPC (goal mark, edge arrow, light beam) and opens the talk
 * with E / a tap on that NPC or with 🎤 here. The trade window opens from 🤝 here or E / a tap on the teacher.
 *
 * R326 ⑫ (Dan 11-19 "억지 교육"): the panel is a small mission list, not an instruction — the stage's goal as a mission
 * done in play (in the child's own words; the stage's sentences are only ideas), talking to anyone, trading with the
 * teacher, and the missions already done in this lesson.
 */
import React, { useEffect, useRef, useState } from 'react';
import { TEACHER_SPEAKER_ID, TEACHER_TALK_OPENING_EN, itemWordEn, teacherStockItem, tradeOffers, tradeOpeningEn, type TradeOffer } from '@lcw/content';
import { TOKENS } from '@lcw/ui';
import type { DialogResult, LessonTradeInfo } from './api.js';
import type { LessonView } from './controller.js';
import type { LessonDialogConfig, LessonNpcRef } from './LessonLayer.js';
import { LESSON_STRINGS as S, helpLine, lessonGoal } from './strings.js';

const C = TOKENS.colors;
const T = TOKENS.typography;
const SP = TOKENS.spacing;

const card: React.CSSProperties = {
  background: C['paper-0'],
  color: C['ink-900'],
  border: `${TOKENS.shape.borderWidthPx}px solid ${C['ink-900']}`,
  borderRadius: TOKENS.shape.radiusCardPx,
  boxShadow: TOKENS.shape.shadowDefault
};
const btn: React.CSSProperties = {
  ...card,
  boxShadow: 'none',
  minHeight: TOKENS.shape.touchTargetMinPx,
  padding: `${SP[1]}px ${SP[2]}px`,
  fontFamily: T.fonts.ui,
  fontSize: T.scale.small.sizePx,
  fontWeight: 800,
  cursor: 'pointer',
  pointerEvents: 'auto'
};

/** Short screens (a phone on its side, 844×390): the panel starts folded to one row. */
export const SIDE_FOLD_HEIGHT_PX = 500;
/**
 * The open panel keeps this much of the right edge free: the way-finding's edge arrow and its "29 m" run down that
 * lane when the stage's NPC is off to the right (frame check 1280×800: the open panel lay on the arrow).
 */
export const SIDE_EDGE_LANE_PX = 80;
/** How often the panel asks the world how far the stage's NPC is. */
export const SIDE_DIST_MS = 500;
/** Nearer than this the panel says "right here" (the talk prompt shows at about this distance). */
export const SIDE_NEAR_M = 4;

export function sideStartsFolded(h: number = typeof innerHeight === 'number' ? innerHeight : 800): boolean {
  return h <= SIDE_FOLD_HEIGHT_PX;
}

/** The teacher's newest line in the lesson (the teacher's own voice or the teacher speaking as an NPC), or null. */
export function teacherLatest(view: Pick<LessonView, 'bubbles'>): { id: string; text: string; asNpc: string | null } | null {
  for (let i = view.bubbles.length - 1; i >= 0; i--) {
    const b = view.bubbles[i]!;
    if (b.npcId === TEACHER_SPEAKER_ID) return { id: b.id, text: b.text, asNpc: null };
    if (b.possessed) return { id: b.id, text: b.text, asNpc: b.npcNameEn || b.npcNameKo };
  }
  return null;
}

/** How long a new teacher line stays under the folded panel (the open panel keeps the newest one). */
export const SIDE_LINE_MS = 8_000;

export function LessonSidePanel(props: {
  view: LessonView;
  npc: LessonNpcRef;
  /** Metres to the stage's NPC (world), or null when the world cannot say. */
  distance: () => number | null;
  onTalk: () => void;
  onTrade: () => void;
  /** The status row (who is with the child, adventure, leave): LessonLayer's StatusPill. */
  status: React.ReactNode;
  /** The talk or trade window is open: the panel folds out of its way. */
  windowOpen: boolean;
}): React.ReactElement | null {
  const { view, npc } = props;
  const [folded, setFolded] = useState(() => sideStartsFolded());
  const distRef = useRef(props.distance);
  distRef.current = props.distance;
  const readDist = (): number | null => {
    const d = distRef.current();
    return d === null || !Number.isFinite(d) ? null : Math.round(d);
  };
  const [dist, setDist] = useState<number | null>(readDist);
  useEffect(() => {
    const tick = () => setDist(readDist());
    const t = setInterval(tick, SIDE_DIST_MS);
    return () => clearInterval(t);
  }, []);
  const latest = teacherLatest(view);
  // missions done in this lesson (the goals of the stages the lesson moved past while this panel was up)
  const [doneGoals, setDoneGoals] = useState<string[]>([]);
  const lastGoal = useRef<{ stage: string | null; goal: string }>({ stage: view.stageId, goal: lessonGoal(view.goalEn, view.goalKo) });
  useEffect(() => {
    const was = lastGoal.current;
    if (was.stage && view.stageId && was.stage !== view.stageId && was.goal) setDoneGoals((d) => (d.includes(was.goal) ? d : [...d, was.goal].slice(-6)));
    lastGoal.current = { stage: view.stageId, goal: lessonGoal(view.goalEn, view.goalKo) };
  }, [view.stageId, view.goalEn, view.goalKo]);
  // a new teacher line shows under the folded row for a moment (the world's bubble is over the teacher, maybe off screen)
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (!latest) return undefined;
    setFresh(latest.id);
    const t = setTimeout(() => setFresh(null), SIDE_LINE_MS);
    return () => clearTimeout(t);
  }, [latest?.id]);
  if (props.windowOpen) return null;
  const goal = lessonGoal(view.goalEn, view.goalKo);
  const near = dist !== null && dist <= SIDE_NEAR_M;
  const place: React.CSSProperties = {
    position: 'fixed',
    // under the HUD's right column (stars, view button, minimap, 1PC teacher button) and its top stack (the goal card
    // spreads wide on a phone), never over them
    top: 'calc(max(var(--lcw-hud-right-b, 92px), var(--lcw-hud-top-b, 0px)) + 8px)',
    // left of the touch talk button's column (world/hud.ts --lcw-hud-talk-w; 12px without touch): 844×390 put the
    // folded row on that button
    right: 'var(--lcw-hud-talk-w, 12px)',
    zIndex: 46,
    pointerEvents: 'auto'
  };
  if (folded) {
    return (
      <div data-testid="lesson-side" data-folded="1" data-hud-part="" style={{ ...place, display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SP[1], alignItems: 'center', maxWidth: 'min(320px, 60vw)' }}>
        <button type="button" data-testid="lesson-side-unfold" onClick={() => setFolded(false)} style={btn}>
          {S.side.unfold}
          {dist !== null && !near ? ` · ${dist}m` : ''}
        </button>
        <button type="button" data-testid="lesson-reopen" aria-label={S.speak.title(npc)} onClick={props.onTalk} style={{ ...btn, background: C['brand-d'], color: C['paper-0'] }}>
          🎤
        </button>
        <button type="button" data-testid="lesson-trade-open" aria-label={S.side.trade} onClick={props.onTrade} style={btn}>
          🤝
        </button>
        {latest && fresh === latest.id ? (
          <div data-testid="lesson-side-teacher" role="status" style={{ ...card, boxShadow: 'none', flexBasis: '100%', padding: SP[1], borderColor: C.grape, fontSize: T.scale.small.sizePx }}>
            <strong style={{ color: C['grape-d'] }}>{S.side.teacherSays}</strong> <span style={{ fontFamily: T.fonts.target }}>{latest.text}</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <aside
      data-testid="lesson-side"
      data-hud-part=""
      aria-label={S.side.title}
      style={{
        ...place,
        ...card,
        right: `max(var(--lcw-hud-talk-w, 12px), ${12 + SIDE_EDGE_LANE_PX}px)`,
        width: 'min(280px, calc(42vw))',
        maxHeight: 'calc(100vh - max(var(--lcw-hud-right-b, 92px), var(--lcw-hud-top-b, 0px)) - 20px)',
        overflowY: 'auto',
        padding: SP[2],
        display: 'flex',
        flexDirection: 'column',
        gap: SP[2],
        fontFamily: T.fonts.ui,
        fontSize: T.scale.small.sizePx
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[1] }}>
        <strong style={{ fontSize: T.scale.body.sizePx }}>{S.side.title}</strong>
        <button type="button" data-testid="lesson-side-fold" aria-label={S.side.fold} onClick={() => setFolded(true)} style={{ ...btn, minHeight: SP[5] }}>
          {S.side.fold}
        </button>
      </div>
      <ul data-testid="lesson-missions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: SP[1] }}>
        {doneGoals.map((g) => (
          <li key={g} data-done="1" style={{ color: C['ink-700'], textDecoration: 'line-through' }}>
            ✓ {g}
          </li>
        ))}
        {goal ? (
          <li data-now="1" style={{ background: C['paper-100'], borderRadius: TOKENS.shape.radiusCardPx, padding: SP[1], borderLeft: `${SP[0]}px solid ${C.sun}` }}>
            <div style={{ fontWeight: 800 }}>▶ {goal}</div>
            <div data-testid="lesson-side-where" style={{ fontSize: T.scale.micro.sizePx, marginTop: 2 }}>
              <strong>{near ? S.side.near(npc) : S.side.goTo(npc)}</strong>
              {!near && dist !== null ? ` · ${S.side.far(dist)}` : ''}
            </div>
            {view.offers.length ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: T.scale.micro.sizePx, color: C['ink-700'] }}>{S.side.ideas}</div>
                <div style={{ fontFamily: T.fonts.target, fontSize: T.scale.small.sizePx }}>“{view.offers[0]!.text}”</div>
              </div>
            ) : null}
          </li>
        ) : null}
        <li>{S.side.anyone}</li>
        <li>{S.side.tradeMission}</li>
      </ul>
      {latest ? (
        <div data-testid="lesson-side-teacher" style={{ borderLeft: `3px solid ${C.grape}`, paddingLeft: SP[1] }}>
          <div style={{ fontSize: T.scale.micro.sizePx, fontWeight: 800, color: C['grape-d'] }}>
            {S.side.teacherSays}
            {latest.asNpc ? ` · ${latest.asNpc}` : ''}
          </div>
          <div style={{ fontFamily: T.fonts.target }}>{latest.text}</div>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: SP[1], flexWrap: 'wrap' }}>
        <button type="button" data-testid="lesson-reopen" onClick={props.onTalk} style={{ ...btn, flex: '1 1 auto', background: C['brand-d'], color: C['paper-0'] }}>
          {S.side.talk}
        </button>
        <button type="button" data-testid="lesson-trade-open" onClick={props.onTrade} style={{ ...btn, flex: '1 1 auto' }}>
          {S.side.trade}
        </button>
      </div>
      <div style={{ fontSize: T.scale.micro.sizePx, color: C['ink-700'] }}>{S.side.free}</div>
      {props.status}
    </aside>
  );
}

/** The teacher as the dialog's NPC for a trade (the world's teacher figure, NPC id 'teacher'). */
export function teacherNpcRef(name: string | null): LessonNpcRef {
  return { id: TEACHER_SPEAKER_ID, ctx: 'guide', nameEn: name || 'Teacher', nameKo: name ? `${name} 선생님` : '선생님' };
}

/** What the trade window opens with when the child picks: the trade's sentences as the dialog's offer cards. */
export function tradeOfferCards(offers: readonly TradeOffer[]): Array<{ stars: 1 | 2 | 3; text: string; hintTags: string[] }> {
  return offers.map((o) => ({ stars: o.stars, text: o.text, hintTags: [...o.hintTags] }));
}

type TradeStep = { kind: 'pick' } | { kind: 'talk'; seq: number } | { kind: 'say'; getKey: string | null; giveItemId: string | null; giveKey: string | null; seq: number };

export function TradeWindow(props: {
  view: LessonView;
  teacherName: string | null;
  load: () => Promise<LessonTradeInfo>;
  trade: (u: unknown, pick: { getKey: string | null; giveItemId: string | null }) => Promise<{ result: DialogResult; trade: { done: boolean; get_key: string | null; give_key: string | null } }>;
  renderDialog?: (npc: LessonNpcRef, cfg: LessonDialogConfig) => React.ReactNode;
  /** R326 ⑫: the child talks with the teacher in their own words (a lesson free-talk answer the console shows). */
  talk?: (u: unknown) => Promise<DialogResult>;
  onClose: () => void;
}): React.ReactElement {
  const [info, setInfo] = useState<LessonTradeInfo | null>(null);
  const [err, setErr] = useState(false);
  const [getKey, setGetKey] = useState<string | null>(null);
  const [giveId, setGiveId] = useState<string | null>(null);
  const [step, setStep] = useState<TradeStep>({ kind: 'pick' });
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = () => {
    setErr(false);
    props.load().then(setInfo, () => setErr(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, []);
  const teacher = teacherNpcRef(props.teacherName);
  const owned = info?.owned ?? [];
  const giveKey = owned.find((o) => o.item_id === giveId)?.item_key ?? null;

  if (step.kind === 'talk' && props.talk && props.renderDialog) {
    const talk = props.talk;
    const dlg = props.renderDialog(teacher, {
      level: props.view.level,
      mode: 'free',
      offers: [],
      hint: 'full',
      npcLine: TEACHER_TALK_OPENING_EN,
      submit: (u) => talk(u),
      onDone: () => setStep({ kind: 'pick' }),
      onClose: () => setStep({ kind: 'pick' })
    });
    if (dlg) {
      return (
        <div key={step.seq} data-testid="lesson-teacher-talk" style={{ pointerEvents: 'auto' }}>
          {dlg}
        </div>
      );
    }
  }
  if (step.kind === 'say') {
    const offers = tradeOffers({ getKey: step.getKey, giveKey: step.giveKey, level: props.view.level });
    const cfg: LessonDialogConfig = {
      level: props.view.level,
      // R326 ⑫: the child asks in their own words; the trade's sentences are ideas (the server finds the one they carry)
      mode: 'free',
      offers: tradeOfferCards(offers),
      hint: 'full',
      npcLine: tradeOpeningEn({ getKey: step.getKey, giveKey: step.giveKey }),
      submit: async (u) => {
        const r = await props.trade(u, { getKey: step.getKey, giveItemId: step.giveItemId });
        if (r.trade.done) {
          setDone(S.trade.done(r.trade.get_key ? itemWordEn(r.trade.get_key) : null, r.trade.give_key ? itemWordEn(r.trade.give_key) : null));
          setGetKey(null);
          setGiveId(null);
        }
        return r.result;
      },
      onDone: (r) => {
        setStep({ kind: 'pick' });
        if (r.pass) reload();
      },
      onClose: () => setStep({ kind: 'pick' })
    };
    const dlg = props.renderDialog?.(teacher, cfg) ?? null;
    if (dlg) {
      return (
        <div key={step.seq} data-testid="lesson-trade-dialog" style={{ pointerEvents: 'auto' }}>
          {dlg}
        </div>
      );
    }
    return <TypedTrade offers={offers} onSend={cfg.submit} onBack={() => setStep({ kind: 'pick' })} />;
  }

  const cell = (on: boolean): React.CSSProperties => ({
    ...btn,
    minWidth: SP[7],
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: SP[1],
    background: on ? C.sun : C['paper-0'],
    borderWidth: on ? 3 : TOKENS.shape.borderWidthPx
  });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[2], pointerEvents: 'none' }}>
      <section
        role="dialog"
        aria-label={S.trade.title}
        data-testid="lesson-trade"
        style={{ ...card, pointerEvents: 'auto', width: 'min(640px, 100%)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', padding: SP[3], display: 'flex', flexDirection: 'column', gap: SP[2], fontFamily: T.fonts.ui }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SP[2] }}>
          <strong style={{ fontSize: T.scale.h3.sizePx }}>{S.trade.title}</strong>
          {props.talk && props.renderDialog ? (
            <button
              type="button"
              data-testid="lesson-teacher-talk-open"
              onClick={() => {
                seq.current += 1;
                setStep({ kind: 'talk', seq: seq.current });
              }}
              style={{ ...btn, marginLeft: 'auto' }}
            >
              {S.trade.talkFree}
            </button>
          ) : null}
          <button type="button" data-testid="lesson-trade-close" aria-label={S.trade.close} onClick={props.onClose} style={btn}>
            {S.trade.close}
          </button>
        </div>
        {done ? (
          <div role="status" data-testid="lesson-trade-done" style={{ background: C.sun, borderRadius: TOKENS.shape.radiusCardPx, padding: SP[1], fontWeight: 800 }}>
            {done}
          </div>
        ) : null}
        {err ? (
          <button type="button" onClick={reload} style={btn}>
            {S.trade.failed}
          </button>
        ) : !info ? (
          <div>{S.trade.loading}</div>
        ) : info.ended ? (
          <div>{S.trade.ended}</div>
        ) : (
          <>
            <div>
              <div style={{ fontWeight: 800 }}>
                {S.trade.teacherHas} · <span style={{ fontWeight: 400 }}>{S.trade.pickTeacher}</span>
              </div>
              <div data-testid="lesson-trade-stock" style={{ display: 'flex', flexWrap: 'wrap', gap: SP[1], marginTop: SP[1] }}>
                {info.stock.map((it) => (
                  <button key={it.key} type="button" aria-pressed={getKey === it.key} onClick={() => setGetKey(getKey === it.key ? null : it.key)} style={cell(getKey === it.key)}>
                    <span aria-hidden style={{ fontSize: T.scale.h3.sizePx, lineHeight: `${T.scale.h3.lineHeightPx}px` }}>{it.emoji}</span>
                    <span>{helpLine(it.label, it.nameKo)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 800 }}>
                {S.trade.mine} · <span style={{ fontWeight: 400 }}>{S.trade.pickMine}</span>
              </div>
              {owned.length === 0 ? (
                <div style={{ marginTop: SP[1] }}>{S.trade.mineEmpty}</div>
              ) : (
                <div data-testid="lesson-trade-mine" style={{ display: 'flex', flexWrap: 'wrap', gap: SP[1], marginTop: SP[1] }}>
                  {owned.map((it) => {
                    const known = teacherStockItem(it.item_key);
                    return (
                      <button key={it.item_id} type="button" aria-pressed={giveId === it.item_id} onClick={() => setGiveId(giveId === it.item_id ? null : it.item_id)} style={cell(giveId === it.item_id)}>
                        <span aria-hidden style={{ fontSize: T.scale.h3.sizePx, lineHeight: `${T.scale.h3.lineHeightPx}px` }}>{known?.emoji ?? '🎁'}</span>
                        <span>{known ? helpLine(known.label, known.nameKo) : itemWordEn(it.item_key)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              data-testid="lesson-trade-say"
              disabled={!getKey && !giveKey}
              onClick={() => {
                setDone(null);
                seq.current += 1;
                setStep({ kind: 'say', getKey, giveItemId: giveId, giveKey, seq: seq.current });
              }}
              style={{ ...btn, minHeight: TOKENS.shape.micButtonPx, background: getKey || giveKey ? C['brand-d'] : C['paper-100'], color: getKey || giveKey ? C['paper-0'] : C['ink-700'], fontSize: T.scale.body.sizePx }}
            >
              {S.trade.say}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

/** Without the dialog domain's window (it failed to load): the trade's sentences to type and send. */
function TypedTrade(props: { offers: readonly TradeOffer[]; onSend: (u: unknown) => Promise<DialogResult>; onBack: () => void }): React.ReactElement {
  const [text, setText] = useState('');
  const [pick, setPick] = useState(props.offers[0]?.text ?? '');
  const [res, setRes] = useState<DialogResult | null>(null);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[2] }}>
      <section data-testid="lesson-trade-typed" style={{ ...card, width: 'min(560px, 100%)', padding: SP[3], display: 'flex', flexDirection: 'column', gap: SP[2], pointerEvents: 'auto' }}>
        {props.offers.map((o) => (
          <button key={o.text} type="button" aria-pressed={pick === o.text} onClick={() => setPick(o.text)} style={{ ...btn, textAlign: 'left', background: pick === o.text ? C.sun : C['paper-0'], fontFamily: T.fonts.target }}>
            {'⭐'.repeat(o.stars)} {o.text}
          </button>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={S.speak.typePlaceholder} style={{ ...btn, fontWeight: 400, cursor: 'text' }} />
        <div style={{ display: 'flex', gap: SP[1] }}>
          <button
            type="button"
            onClick={() => {
              void props
                .onSend({ target_text: pick, transcript: text, chosen_stars: props.offers.find((o) => o.text === pick)?.stars ?? 1, stt_source: 'keyboard' })
                .then(setRes, () => setRes({ pass: false, stars: 0, feedbackKo: S.speak.failed }));
            }}
            style={{ ...btn, background: C['brand-d'], color: C['paper-0'] }}
          >
            {S.speak.send}
          </button>
          <button type="button" onClick={props.onBack} style={btn}>
            {S.trade.back}
          </button>
        </div>
        {res ? <div role="status">{res.feedbackEn ?? res.feedbackKo}</div> : null}
      </section>
    </div>
  );
}
