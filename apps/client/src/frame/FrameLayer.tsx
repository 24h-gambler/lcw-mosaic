/**
 * The child's screen frame around the world (docs/08 8.6, frame domain): the HUD's always-on status (connection band,
 * coin chip), the HUD "메뉴" button and the player menu (G03 G04 G06 G10 G11 G14). The world draws the HUD itself
 * (`world/hud.ts`); this layer feeds it what only the shell knows (who is playing, whether the server answers).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorldHandle } from '../world/api.js';
import { storedStudentToken, type PlayerIdentity } from '../world/identity.js';
import { watchConnection } from './connection.js';
import { FRAME_STRINGS as F, setFrameLang } from './strings.js';
import { helpKoOn, onLearnLang, uiLang } from './lang.js';
import { PlayerMenu, tabForKey } from './menu/PlayerMenu.js';
import { ensureMenuStyle } from './menu/styles.js';
import type { FrameAuth, MenuTab } from './menu/types.js';
import { fetchItems, holdThing, type ItemsView } from './api.js';
import { getAudioRuntime } from '../audio/runtime.js';
import { frameSettings, graphicsOf, lookSettingsOf, motionReduced, onFrameSettings, sameGraphics, startFrameSettings, type GraphicsSettings } from './settings.js';
import { startSettingsSync } from './settings-sync.js';
import { useGauges } from './useGauges.js';
import { keyLabel } from './menu/SettingsPanel.js';
import { setWorldFrameLang, type KeyHintLabels } from '../world/strings.js';

export interface FrameLayerProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
  /** a lesson is live */
  lessonOn?: boolean;
  /** a dialog window is open (solo); the HUD's own `.dlg` mark covers lesson dialogs too */
  dialogOpen?: boolean;
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
  const move = [keys.forward, keys.left, keys.back, keys.right].map(keyLabel);
  return {
    move: move.every((m) => m.length === 1) ? move.join('') : move.join('/'),
    jump: keyLabel(keys.jump),
    talk: keyLabel(keys.talk),
    undo: keyLabel(keys.undo),
    rotate: keyLabel(keys.rotate)
  };
}

/**
 * Screens in the language being learned (frame/lang.ts uiLang): the menu strings, the frame's HUD strings (with the
 * Korean help notices while lang.ts helpKoOn) and <html lang>. Returns the applied "lang|helpKo" key.
 */
export function applyFrameLang(): string {
  const lang = uiLang();
  const helpKo = helpKoOn();
  setFrameLang(lang);
  setWorldFrameLang(lang, { helpKo });
  if (typeof document !== 'undefined' && document.documentElement.lang !== lang) document.documentElement.lang = lang;
  return `${lang}|${helpKo}`;
}

/** Hotbar keys from the server's bag: the first five carried things. */
export function bagKeys(v: ItemsView): Array<string | null> {
  const bag = v.items.filter((t) => t.location === 'bag').map((t) => t.item_key);
  return Array.from({ length: 5 }, (_, i) => bag[i] ?? null);
}

export function FrameLayer({ world, identity, lessonOn = false, dialogOpen = false }: FrameLayerProps): React.ReactElement | null {
  const [online, setOnline] = useState(true);
  const [menu, setMenu] = useState<MenuTab | null>(null);
  const [lastTab, setLastTab] = useState<MenuTab>('bag');
  const hudDialog = useHudDialog();
  const blocked = dialogOpen || hudDialog;
  // the lesson token appears once the join answered (lessonOn flips then)
  const auth = useMemo(() => frameAuthOf(identity, identity?.kind === 'lesson' ? storedStudentToken() : null), [identity, lessonOn]);
  // G14 settings: the device copy is put into effect at start (audio buses, text size, font, colours, motion, keys).
  useEffect(() => startFrameSettings(() => getAudioRuntime()), []);

  // Screen language: at start, when the learn language changes and when Korean help is switched (lang.ts announces
  // both, other tabs too); the tick re-renders the menu (its strings are read at render time).
  const [, setLangTick] = useState(0);
  useEffect(() => {
    let applied = '';
    const apply = (): void => {
      if (`${uiLang()}|${helpKoOn()}` === applied) return;
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
      if (typeof v.coins_total === 'number') world?.setCoins?.(v.coins_total);
      world?.setBag?.(bagKeys(v));
    },
    [world]
  );
  const syncBag = useCallback(() => {
    if (auth.kind === 'guest') return;
    void fetchItems(auth).then((r) => {
      if (r.ok) applyBag(r.data);
    });
  }, [auth, applyBag]);

  // Picking a hotbar slot with a thing in it is a use of that thing (docs/09 P4); the server decides. Once per thing
  // per ten minutes is enough for the "used in the last days" window, so slot flicking never floods the server.
  useEffect(() => {
    if (!world?.onHold || auth.kind === 'guest') return;
    const last = new Map<string, number>();
    return world.onHold((key) => {
      const now = Date.now();
      if ((last.get(key) ?? -Infinity) > now - HOLD_EVERY_MS) return;
      last.set(key, now);
      void holdThing(auth, key);
    });
  }, [world, auth]);

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

  // A dialog opening (an NPC, the teacher) takes the screen: the menu steps aside.
  useEffect(() => {
    if (blocked) setMenu(null);
  }, [blocked]);

  // G01 gauges: the clock stops for a lesson, a dialog and the menu; eating or drinking is a use on the server
  useGauges(world, lessonOn || blocked || menu !== null, (key) => {
    if (auth.kind !== 'guest') void holdThing(auth, key);
  });

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
          <span>{F.menu}</span>
        </button>
      ) : null}
      {menu !== null ? (
        <PlayerMenu world={world} identity={identity} auth={auth} lessonOn={lessonOn} tab={menu} onTab={open} onClose={close} syncBag={syncBag} />
      ) : null}
    </>
  );
}
