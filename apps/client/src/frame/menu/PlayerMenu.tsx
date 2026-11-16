/**
 * Player menu (docs/08 8.6): one window with six tabs — 소지품 G03 · 거울 G04 · 지도 G06 · 도감 G10 · 수리소 G11 ·
 * 설정 G14. Opening it pauses walking (world.setPaused); closing gives control back. Desktop keys I / M / K open a tab
 * and Esc closes; the HUD "메뉴" button opens the last tab. Focus moves into the window and back out (docs/08 11장).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN as E } from '../strings.js';
import { MENU_TABS, otherModalOpen, type MenuPanelProps, type MenuTab } from './types.js';
import { ensureMenuStyle } from './styles.js';
import { KoHelp } from './ko-help.js';
import { BagPanel } from './BagPanel.js';
import { MirrorPanel } from './MirrorPanel.js';
import { MapPanel } from './MapPanel.js';
import { BookPanel } from './BookPanel.js';
import { RepairPanel } from './RepairPanel.js';
import { SettingsPanel } from './SettingsPanel.js';

export const TAB_ICONS: Readonly<Record<MenuTab, string>> = {
  bag: '🎒',
  mirror: '🪞',
  map: '🗺️',
  book: '📖',
  repair: '🔧',
  settings: '⚙️'
};

const PANELS: Readonly<Record<MenuTab, React.ComponentType<MenuPanelProps>>> = {
  bag: BagPanel,
  mirror: MirrorPanel,
  map: MapPanel,
  book: BookPanel,
  repair: RepairPanel,
  settings: SettingsPanel
};

/** Desktop key → tab. Keys that the world already uses (Tab, R, E, WASD, digits, F5, Space, Z) are never taken. */
export function tabForKey(code: string): MenuTab | null {
  if (code === 'KeyI') return 'bag';
  if (code === 'KeyM') return 'map';
  if (code === 'KeyK') return 'book';
  return null;
}

export interface PlayerMenuProps extends Omit<MenuPanelProps, 'go' | 'close'> {
  tab: MenuTab;
  onTab(tab: MenuTab): void;
  onClose(): void;
}

export function PlayerMenu(props: PlayerMenuProps): React.ReactElement {
  const { tab, onTab, onClose, world } = props;
  const winRef = useRef<HTMLDivElement | null>(null);
  ensureMenuStyle();

  useEffect(() => {
    world?.setPaused(true);
    // the world's pause is one switch: a dialog that opened meanwhile (and closed this menu) keeps it on
    return () => {
      if (!otherModalOpen()) world?.setPaused(false);
    };
  }, [world]);

  // focus into the window, back to whatever had it on close
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    winRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => {
      // a dialog that closed the menu keeps the focus; otherwise back to what had it, else the menu button
      if (otherModalOpen()) return;
      if (before && before !== document.body && before.isConnected) before.focus?.();
      else requestAnimationFrame(() => document.querySelector<HTMLElement>('.lcw-hudbtn--bag')?.focus());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      // a dialog window opened from a tab (the repair review) owns the keys until it closes
      if (document.querySelector('.lcw-dlg')) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const t = tabForKey(e.code);
      if (t) {
        e.preventDefault();
        e.stopPropagation();
        if (t === tab) onClose();
        else onTab(t);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tab, onTab, onClose]);

  const onTabKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = MENU_TABS.indexOf(tab);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const next = MENU_TABS[(i + d + MENU_TABS.length) % MENU_TABS.length]!;
      onTab(next);
      requestAnimationFrame(() => winRef.current?.querySelector<HTMLElement>(`#lcw-menu-tab-${next}`)?.focus());
    },
    [tab, onTab]
  );

  const Panel = PANELS[tab];
  return (
    <div
      className="lcw-menu"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lcw-menu__win" ref={winRef} role="dialog" aria-modal="true" aria-label={F.menu}>
        <div className="lcw-menu__top">
          <div className="lcw-menu__tabs" role="tablist" aria-label={F.menu} onKeyDown={onTabKey}>
            {MENU_TABS.map((t) => (
              <button
                key={t}
                id={`lcw-menu-tab-${t}`}
                type="button"
                role="tab"
                className="lcw-menu__tab"
                aria-selected={t === tab}
                aria-controls="lcw-menu-panel"
                tabIndex={t === tab ? 0 : -1}
                onClick={() => onTab(t)}
              >
                <span className="ic" aria-hidden="true">
                  {TAB_ICONS[t]}
                </span>
                <span>
                  {E.tabs[t]}
                  <KoHelp get={(k) => k.tabs[t]} />
                </span>
                {F.keys[t] ? <kbd aria-hidden="true">{F.keys[t]}</kbd> : null}
              </button>
            ))}
          </div>
          <button type="button" className="lcw-menu__x" onClick={onClose} aria-label={F.close}>
            ✕
          </button>
        </div>
        <div className="lcw-menu__body" id="lcw-menu-panel" role="tabpanel" aria-labelledby={`lcw-menu-tab-${tab}`}>
          <Panel {...props} go={onTab} close={onClose} />
        </div>
      </div>
    </div>
  );
}
