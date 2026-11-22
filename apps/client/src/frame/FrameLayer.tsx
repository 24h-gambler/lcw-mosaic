/**
 * The child's screen frame around the world (docs/08 8.6, frame domain): the HUD's always-on status (connection band,
 * coin chip), the HUD "메뉴" button and the player menu (G03 G04 G06 G10 G11 G14). The world draws the HUD itself
 * (`world/hud.ts`); this layer feeds it what only the shell knows (who is playing, whether the server answers).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldHandle } from '../world/api.js';
import { storedStudentToken, type PlayerIdentity } from '../world/identity.js';
import { watchConnection } from './connection.js';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN } from './strings.js';
import { ko } from './menu/ko-help.js';
import { helpKoOn, learnLang, onLearnLang } from '../world/lang.js';
import { PlayerMenu, tabForKey } from './menu/PlayerMenu.js';
import { ensureMenuStyle } from './menu/styles.js';
import { otherModalOpen, type FrameAuth, type MenuTab } from './menu/types.js';
import { fetchItems, holdThing, type ItemsView } from './api.js';
import { getAudioRuntime } from '../audio/runtime.js';
import { frameSettings, graphicsOf, lookSettingsOf, motionReduced, onFrameSettings, sameGraphics, startFrameSettings, type GraphicsSettings } from './settings.js';
import { startSettingsSync } from './settings-sync.js';
import { useGauges } from './useGauges.js';
import { keyLabel } from './menu/SettingsPanel.js';
import type { KeyHintLabels } from '../world/strings.js';
import { OPEN_SHOP_EVENT, OPEN_TRADE_EVENT } from './shop-api.js';
import { SHOP_STRINGS } from './shop-strings.js';
import { openShopOn } from './menu/ShopPanel.js';
import { say } from '../world/lang.js';

export interface FrameLayerProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
  /** a lesson is live */
  lessonOn?: boolean;
  /** a dialog window is open (solo); the HUD's own `.dlg` mark covers lesson dialogs too */
  dialogOpen?: boolean;
  /** the teacher in the world (?teach=): no gauges, no rest walk in the middle of a lesson (review R325) */
  teacher?: boolean;
  /**
   * A shell card holds the screen (R326: the free trial is over, or the seat stopped): like a dialog, the menu and shop
   * buttons and the coin tip step aside so nothing shows dimmed under the card's shade.
   */
  cardOpen?: boolean;
}

/**
 * The one-time coin tip ("Spend them here…"): only on a free screen — no dialog or shell card, menu closed, not in a
 * lesson — for a child who can buy. Not while solo play is stopped (a spent trial or a stopped seat cannot buy, so the
 * tip would promise what the shop refuses); it waits, unseen, until play comes back.
 */
export function shopTipShown(o: { blocked: boolean; menuOpen: boolean; guest: boolean; unseen: boolean; lessonOn: boolean; soloStopped: boolean }): boolean {
  return !o.blocked && !o.menuOpen && !o.guest && o.unseen && !o.lessonOn && !o.soloStopped;
}

/** Who the frame asks the server as (same tokens the review and build paths use). */
export function frameAuthOf(id: PlayerIdentity | null, studentToken: string | null): FrameAuth {
  if (id?.kind === 'child') return { kind: 'child', token: id.token };
  if (id?.kind === 'lesson' && studentToken && studentToken.length >= 32) return { kind: 'lesson', token: studentToken };
  return { kind: 'guest', token: null };
}

/** The HUD is hidden (the title screen's attract mode hides its root) on it or on its container. */
function hudHidden(hud: HTMLElement): boolean {
  for (const el of [hud, hud.parentElement]) {
    if (el && (el.style.visibility === 'hidden' || el.style.display === 'none' || el.style.opacity === '0')) return true;
  }
  return false;
}

/**
 * True while the world HUD carries its dialog mark (any dialog: solo, lesson, review) or is hidden (title screen):
 * the menu button and the menu keys step aside then.
 */
function useHudDialog(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let obs: MutationObserver | null = null;
    let raf = 0;
    const attach = (): void => {
      const hud = document.querySelector<HTMLElement>('.lw-hud');
      if (!hud) {
        raf = requestAnimationFrame(attach);
        return;
      }
      const read = (): void => setOn(hud.classList.contains('dlg') || hudHidden(hud));
      read();
      obs = new MutationObserver(read);
      obs.observe(hud, { attributes: true, attributeFilter: ['class', 'style'] });
      if (hud.parentElement) obs.observe(hud.parentElement, { attributes: true, attributeFilter: ['style'] });
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      obs?.disconnect();
    };
  }, []);
  return on;
}

const HOLD_EVERY_MS = 10 * 60_000;

/** HUD help-line key names from the player's keys: "WASD" while the four move keys are single letters. */
export function keyHintsOf(keys: Readonly<Record<'forward' | 'left' | 'back' | 'right' | 'jump' | 'talk' | 'undo' | 'rotate', string>>): KeyHintLabels {
  const move = [keys.forward, keys.left, keys.back, keys.right].map((c) => keyLabel(c));
  return {
    move: move.every((m) => m.length === 1) ? move.join('') : move.join('/'),
    jump: keyLabel(keys.jump),
    talk: keyLabel(keys.talk),
    undo: keyLabel(keys.undo),
    rotate: keyLabel(keys.rotate)
  };
}

/**
 * The page speaks the language being learned (world/lang.ts learnLang): <html lang> follows it; the strings tables read
 * the language and the Korean help at the moment of use. Returns the applied "lang|helpKo" key.
 */
export function applyFrameLang(): string {
  const lang = learnLang();
  if (typeof document !== 'undefined' && document.documentElement.lang !== lang) document.documentElement.lang = lang;
  return `${lang}|${helpKoOn()}`;
}

/** Hotbar keys from the server's bag: the first five carried things. */
export function bagKeys(v: ItemsView): Array<string | null> {
  const bag = v.items.filter((t) => t.location === 'bag').map((t) => t.item_key);
  return Array.from({ length: 5 }, (_, i) => bag[i] ?? null);
}

export function FrameLayer({ world, identity, lessonOn = false, dialogOpen = false, teacher = false, cardOpen = false }: FrameLayerProps): React.ReactElement | null {
  const [online, setOnline] = useState(true);
  const [menu, setMenu] = useState<MenuTab | null>(null);
  const [lastTab, setLastTab] = useState<MenuTab>('bag');
  const hudDialog = useHudDialog();
  const blocked = dialogOpen || hudDialog || cardOpen;
  // the lesson token appears once the join answered (lessonOn flips then)
  const auth = useMemo(() => frameAuthOf(identity, identity?.kind === 'lesson' ? storedStudentToken() : null), [identity, lessonOn]);
  // G14 settings: the device copy is put into effect at start (audio buses, text size, font, colours, motion, keys).
  useEffect(() => startFrameSettings(() => getAudioRuntime()), []);

  // Screen language: at start, when the learn language changes and when Korean help is switched (lang.ts announces
  // both, other tabs too); the tick re-renders the menu (its strings are read at render time).
  const [, setLangTick] = useState(0);
  const menuKo = ko((t) => t.menu);
  useEffect(() => {
    let applied = '';
    const apply = (): void => {
      if (`${learnLang()}|${helpKoOn()}` === applied) return;
      applied = applyFrameLang();
      setLangTick((n) => n + 1);
    };
    apply();
    return onLearnLang(apply);
  }, []);

  // ...and the world gets its part now and on every change (look speed, inversion, motion, FPS).
  useEffect(() => {
    if (!world) return;
    // Graphics: the start tier comes from savedTier() (App.pickTier); the performance lane's `setGraphics` (optional
    // until it lands) gets the whole choice at start and on every graphics change, applied live.
    const live = world as WorldHandle & { setGraphics?: (g: GraphicsSettings) => void };
    let sent: GraphicsSettings | null = null;
    const push = (): void => {
      const s = frameSettings();
      world.setLookSettings?.(lookSettingsOf(s));
      world.setReduceMotion?.(motionReduced());
      world.setShowFps?.(s.showFps);
      world.setKeyHints?.(keyHintsOf(s.keys));
      const g = graphicsOf(s);
      if (!sent || !sameGraphics(sent, g)) {
        sent = g;
        live.setGraphics?.(g);
      }
    };
    push();
    return onFrameSettings(push);
  }, [world]);

  // A linked child or a lesson student keeps the settings on the server too (other devices pick them up).
  const settingsToken = auth.token;
  useEffect(() => {
    if (!settingsToken) return;
    return startSettingsSync({ token: settingsToken });
  }, [settingsToken]);

  // Connection band: the world keeps running on the device while the server is away.
  useEffect(() => {
    if (!world) return;
    const startOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    return watchConnection({
      setOnline: (on) => {
        setOnline(on);
        world.setOnline?.(on);
      },
      startOnline
    });
  }, [world]);

  // The HUD hotbar shows the server's bag (G03): the first five carried things, in the server's order.
  const applyBag = useCallback(
    (v: ItemsView) => {
      // a linked child in a lesson sees the lesson's coins (the lesson layer sets them), not the home ledger
      if (typeof v.coins_total === 'number' && !(lessonOn && auth.kind === 'child')) world?.setCoins?.(v.coins_total);
      world?.setBag?.(bagKeys(v));
    },
    [world, lessonOn, auth.kind]
  );
  const syncBag = useCallback(() => {
    if (auth.kind === 'guest') return;
    void fetchItems(auth).then((r) => {
      if (r.ok) applyBag(r.data);
    });
  }, [auth, applyBag]);

  // Picking a hotbar slot with a thing in it is a use of that thing (docs/09 P4); the server decides. Once per thing
  // per ten minutes is enough for the "used in the last days" window, so slot flicking never floods the server.
  // Eating or drinking (G01) shares the same once-per-ten-minutes record, so a pick and a use never send two calls.
  const usedAt = useRef(new Map<string, number>());
  const useOnce = useCallback(
    (key: string): void => {
      if (auth.kind === 'guest') return;
      const now = Date.now();
      if ((usedAt.current.get(key) ?? -Infinity) > now - HOLD_EVERY_MS) return;
      usedAt.current.set(key, now);
      void holdThing(auth, key);
    },
    [auth]
  );
  useEffect(() => {
    if (!world?.onHold || auth.kind === 'guest') return;
    return world.onHold(useOnce);
  }, [world, auth, useOnce]);

  // Coins are always on the HUD (docs/08 8.1). A guest has no ledger: nothing is ever granted on a guest device, so its
  // balance is 0. A linked child or a lesson student reads the server ledger once at the start; later answers and the
  // lesson poll keep it current.
  useEffect(() => {
    if (!world) return;
    if (identity?.kind === 'guest') {
      world.setCoins?.(0);
      return;
    }
    // a lesson before its join answered, or no identity yet: wait for the token
    if (auth.kind === 'guest') return;
    let live = true;
    void fetchItems(auth).then((r) => {
      if (live && r.ok) applyBag(r.data);
    });
    return () => {
      live = false;
    };
  }, [world, auth, identity, applyBag]);

  const open = useCallback((t: MenuTab) => {
    // never over another window (a review dialog has no HUD mark; the first-visit and seat cards neither)
    if (otherModalOpen()) return;
    setLastTab(t);
    setMenu(t);
  }, []);
  const close = useCallback(() => setMenu(null), []);

  // Desktop keys open a tab while nothing else holds the screen (the menu handles keys itself once open).
  useEffect(() => {
    if (menu !== null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (blocked || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const t = tabForKey(e.code);
      if (!t) return;
      e.preventDefault();
      open(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, blocked, open]);

  // The shop opens from the HUD shop button, a first-coin tip, the maker's book, or a peer tap in the world (trade).
  useEffect(() => {
    const shop = (e: Event): void => {
      const cat = (e as CustomEvent<{ cat?: string }>).detail?.cat;
      if (cat) openShopOn(cat as Parameters<typeof openShopOn>[0]);
      open('shop');
    };
    const trade = (): void => {
      openShopOn('trade');
      open('shop');
    };
    window.addEventListener(OPEN_SHOP_EVENT, shop);
    window.addEventListener(OPEN_TRADE_EVENT, trade);
    return () => {
      window.removeEventListener(OPEN_SHOP_EVENT, shop);
      window.removeEventListener(OPEN_TRADE_EVENT, trade);
    };
  }, [open]);
  // One short tip the first time (Dan R326 ⑪ "도움말이 없다"): what coins are for, pointing at the shop button.
  const [shopTip, setShopTip] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lcw.shopTipSeen') !== '1';
    } catch {
      return false;
    }
  });
  const dropShopTip = useCallback(() => {
    setShopTip(false);
    try {
      localStorage.setItem('lcw.shopTipSeen', '1');
    } catch {
      /* private window */
    }
  }, []);

  // A dialog opening (an NPC, the teacher) takes the screen: the menu steps aside.
  useEffect(() => {
    if (blocked) setMenu(null);
  }, [blocked]);

  // G01 gauges: the clock stops for a lesson, a dialog and the menu; eating or drinking is a use on the server
  useGauges(teacher ? null : world, lessonOn || blocked || menu !== null, useOnce);

  ensureMenuStyle();
  if (!world) return null;
  return (
    <>
      {!blocked && menu === null ? (
        <button
          type="button"
          className="lcw-hudbtn lcw-hudbtn--bag"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => open(lastTab)}
          aria-label={F.menu}
        >
          <span className="ic" aria-hidden="true">
            🎒
          </span>
          <span>{FRAME_STRINGS_EN.menu}</span>
          {/* the Korean help as a small second line: the button keeps its size next to the hotbar */}
          {menuKo ? (
            <span className="ko" lang="ko">
              {menuKo}
            </span>
          ) : null}
        </button>
      ) : null}
      {!blocked && menu === null && auth.kind !== 'guest' ? (
        <button
          type="button"
          className="lcw-hudbtn lcw-hudbtn--shop"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            dropShopTip();
            open('shop');
          }}
          aria-label={say(SHOP_STRINGS.hudShop).text}
        >
          <span className="ic" aria-hidden="true">
            🛍️
          </span>
          <span>{say(SHOP_STRINGS.hudShop).text}</span>
          {say(SHOP_STRINGS.hudShop).help ? (
            <span className="ko" lang="ko">
              {say(SHOP_STRINGS.hudShop).help}
            </span>
          ) : null}
        </button>
      ) : null}
      {shopTipShown({
        blocked,
        menuOpen: menu !== null,
        guest: auth.kind === 'guest',
        unseen: shopTip,
        lessonOn,
        soloStopped: identity?.kind === 'child' && !identity.playAllowed
      }) ? (
        <div className="lcw-shoptip" role="note">
          <span>{say(SHOP_STRINGS.helpSpend).text}</span>
          {say(SHOP_STRINGS.helpSpend).help ? (
            <span className="ko" lang="ko">
              {say(SHOP_STRINGS.helpSpend).help}
            </span>
          ) : null}
          <button type="button" className="x" onPointerDown={(e) => e.stopPropagation()} onClick={dropShopTip} aria-label={say(SHOP_STRINGS.helpOk).text}>
            {say(SHOP_STRINGS.helpOk).text}
          </button>
        </div>
      ) : null}
      {menu !== null ? (
        <PlayerMenu world={world} identity={identity} auth={auth} lessonOn={lessonOn} tab={menu} onTab={open} onClose={close} syncBag={syncBag} />
      ) : null}
    </>
  );
}
