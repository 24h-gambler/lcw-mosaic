import React, { useCallback, useEffect, useRef, useState } from 'react';
import { npcPersona } from '@lcw/content';
import { live } from './strings.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import type { WorldHandle } from '../world/api.js';
import { MINIMAP_TOUCH_BOTTOM } from '../world/minimap-place.js';
import { DialogPanel } from './DialogPanel.js';
import { createReviewSubmit, fetchReviewDue, nextPollDelay, type ReviewSignView } from './review.js';
import { playSfx } from './sound.js';
import type { SpeechEngine } from './speech.js';
import { readStudentToken, SubmitError, type SoloPlayerRef } from './submit.js';
import type { DialogResult, Level, NpcRef } from './types.js';

/**
 * Review signs in the world (docs/03 D8 "복습 징후", docs/08 6장: a small lightning mark, docs/12 `mem.warn`).
 * Up to three gear items that are due show here; tapping one opens the dialog window on that card's own sentence
 * with the hint of its box. Guests have no cards (nothing is stored for them), so the dock stays empty.
 */

const R = live('review');

/** Fallback when the world has no NPC of that ctx: the names come from the cast pack (npc-cast.ts). */
function castRef(id: string, ctx: NpcRef['ctx']): NpcRef {
  const p = npcPersona(id);
  return { id, ctx, nameKo: p?.nameKo ?? id, nameEn: p?.nameEn ?? id };
}

const NPC_BY_CTX: Record<string, NpcRef> = {
  cafe: castRef('cafe_owner', 'cafe'),
  trade_shop: castRef('shop_owner', 'trade_shop'),
  guide: castRef('guide', 'guide')
};

export function npcForReview(world: WorldHandle | null, ctx: string): NpcRef {
  const live = world?.listNpcs?.().find((n) => n.ctx === ctx);
  return live ?? NPC_BY_CTX[ctx] ?? NPC_BY_CTX.guide!;
}

export interface ReviewDockProps {
  world: WorldHandle | null;
  player?: SoloPlayerRef;
  /** Hidden while a lesson runs or another dialog is open (the lesson layer owns the screen then). */
  hidden?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Test/preview seam for the dialog's speech engine. */
  speech?: SpeechEngine;
  /** Called after a review closes (pass or not) so the shell can refresh coins etc. */
  onReviewed?: (r: DialogResult) => void;
}

function tokenOf(player?: SoloPlayerRef): string {
  return readStudentToken() || player?.deviceToken || '';
}

/**
 * Top-right column under the world's star+coin chip (top 12, 36 high). Touch HUDs also carry the world's view button
 * at about 60~116px and the minimap under it (124~220px, docs/08 7.3), so the dock starts below both there (docs/19 5장).
 */
export function reviewDockTop(coarse: boolean): number {
  return coarse ? MINIMAP_TOUCH_BOTTOM : 60;
}

function mediaQuery(q: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null;
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => mediaQuery(query)?.matches ?? false);
  useEffect(() => {
    const q = mediaQuery(query);
    if (!q) return;
    const change = () => setOn(q.matches);
    change();
    q.addEventListener?.('change', change);
    return () => q.removeEventListener?.('change', change);
  }, [query]);
  return on;
}

/**
 * A phone held sideways (touch, 500 px tall or less): the right column is full (view, talk, jump, build tools) and the
 * left one holds the status chip, the minimap and the walk button, so the dock folds into one button in the free
 * bottom-right corner right of the hotbar, which opens the first sign (frame, R2722: the full dock lay over jump / talk).
 */
export const REVIEW_PILL_PLACE = { right: 12, bottom: 12 } as const;

export function ReviewDock(props: ReviewDockProps): React.ReactElement | null {
  const coarse = useMedia('(pointer: coarse)');
  const shortLandscape = useMedia('(max-height: 500px)');
  const { world, player, hidden, baseUrl, fetchImpl, speech, onReviewed } = props;
  const [signs, setSigns] = useState<ReviewSignView[]>([]);
  const [open, setOpen] = useState<ReviewSignView | null>(null);
  const known = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  // Keyed on the token string: the shell hands a fresh player object on every render, which must not re-poll.
  const playerToken = player?.deviceToken ?? '';
  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const token = readStudentToken() || playerToken;
    if (!token) return;
    let delay = 60_000;
    try {
      const due = await fetchReviewDue({ token, baseUrl, fetchImpl });
      if (!live.current) return;
      // docs/12 mem.warn: a low two-note cue when a new sign appears (never on every poll).
      if (due.signs.some((s) => !known.current.has(s.card_id))) playSfx('mem.warn');
      known.current = new Set(due.signs.map((s) => s.card_id));
      setSigns(due.signs);
      delay = nextPollDelay(due, Date.now());
    } catch (err) {
      if (err instanceof SubmitError && err.kind === 'auth') return; // token gone: no more polling
    }
    if (live.current) timer.current = setTimeout(() => void refresh(), delay);
  }, [playerToken, baseUrl, fetchImpl]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open || !world) return;
    world.setPaused(true);
    return () => world.setPaused(false);
  }, [open, world]);

  const close = useCallback(
    (r: DialogResult | null) => {
      setOpen(null);
      if (r) {
        // The server ledger is the only coin record (a mastered card pays its bonus there).
        if (typeof r.coinsTotal === 'number') world?.setCoins?.(r.coinsTotal);
        if (r.pass) {
          playSfx('mem.fix');
          world?.celebrate(Math.max(0, Math.min(3, Math.round(r.stars))) as 0 | 1 | 2 | 3);
        }
        onReviewed?.(r);
      }
      void refresh();
    },
    [world, onReviewed, refresh]
  );

  if (open) {
    const token = tokenOf(player);
    return (
      <DialogPanel
        key={open.card_id}
        npc={npcForReview(world, open.ctx)}
        level={(player?.level ?? 'L1') as Level}
        mode={open.box >= 2 ? 'recall' : 'read'}
        offers={[{ stars: Math.max(1, Math.min(3, open.stars)) as 1 | 2 | 3, text: open.text, hintTags: open.hint_tags }]}
        hint={open.hint}
        listen={open.listen}
        npcLine={R.npcLine}
        speech={speech}
        submit={createReviewSubmit({ token, cardId: open.card_id, baseUrl, fetchImpl })}
        onDone={(r) => close(r)}
        onClose={() => close(null)}
      />
    );
  }
  if (hidden || signs.length === 0) return null;
  if (coarse && shortLandscape) {
    return (
      <button
        type="button"
        className="lcw-review-dock lcw-review-pill"
        data-hud-part=""
        aria-label={`${R.dockTitle} ${signs.length}`}
        onClick={() => {
          playSfx('ui.click');
          setOpen(signs[0] ?? null);
        }}
        style={{
          position: 'absolute',
          right: REVIEW_PILL_PLACE.right,
          // above the lesson sheet when one stands at the bottom (world/hud.ts measureFloor)
          bottom: `calc(${REVIEW_PILL_PLACE.bottom}px + var(--lcw-hud-floor, 0px))`,
          minHeight: S.touchTargetMinPx,
          padding: '6px 14px',
          background: C['night-900'],
          color: C.sun,
          border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
          borderRadius: S.radiusButtonPx,
          boxShadow: S.shadowDefault,
          fontFamily: T.fonts.ui,
          fontSize: T.scale.small.sizePx,
          fontWeight: 800,
          pointerEvents: 'auto',
          cursor: 'pointer'
        }}
      >
        ⚡ {R.dockTitle} {signs.length}
      </button>
    );
  }
  return (
    <div
      className="lcw-review-dock"
      data-hud-part=""
      role="region"
      aria-label={R.dockTitle}
      style={{
        position: 'absolute',
        // under the HUD's measured top stack (goal card) and right column (stars, view button, minimap), world/hud.ts;
        // the fixed value is only the fallback before the HUD has measured
        top: `calc(max(var(--lcw-hud-top-b, ${reviewDockTop(coarse)}px), var(--lcw-hud-right-b, 0px)) + 8px)`,
        right: 12,
        width: 'min(300px, calc(100vw - 24px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
        fontFamily: T.fonts.ui
      }}
    >
      <div style={{ alignSelf: 'flex-end', background: C['night-900'], color: C.sun, borderRadius: S.radiusButtonPx, padding: '2px 10px', fontSize: T.scale.micro.sizePx, fontWeight: 800 }}>
        ⚡ {R.dockTitle} {signs.length}
      </div>
      {signs.map((s) => (
        <button
          key={s.card_id}
          type="button"
          data-card={s.card_id}
          onClick={() => {
            playSfx('ui.click');
            setOpen(s);
          }}
          style={{
            display: 'grid',
            gridTemplateColumns: '44px 1fr',
            alignItems: 'center',
            gap: 10,
            textAlign: 'left',
            minHeight: S.touchTargetMinPx,
            background: C['paper-50'],
            color: C['ink-900'],
            border: `${S.borderWidthPx}px solid ${C['ink-900']}`,
            borderRadius: S.radiusCardPx,
            boxShadow: S.shadowDefault,
            padding: '8px 10px',
            cursor: 'pointer'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'relative',
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              fontSize: 26,
              borderRadius: S.radiusButtonPx,
              // docs/08: a grey smudge on the worn item, with the lightning mark on top.
              background: `radial-gradient(circle at 35% 40%, ${C.silver} 0 30%, ${C['paper-100']} 60%)`,
              filter: 'grayscale(0.35)'
            }}
          >
            {s.emoji}
            <span style={{ position: 'absolute', right: -6, top: -8, fontSize: 18, filter: 'none' }}>⚡</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <b style={{ fontSize: T.scale.small.sizePx, lineHeight: 1.3 }}>{s.label_ko}</b>
            <span style={{ fontSize: T.scale.micro.sizePx, color: C['ink-700'] }}>
              {R.stage[s.box] ?? ''} · {R.fixCta}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
