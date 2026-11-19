/** Player menu contract (frame domain, docs/08 8.6): every tab panel gets the same props. */
import type { WorldHandle } from '../../world/api.js';
import type { PlayerIdentity } from '../../world/identity.js';

export type MenuTab = 'bag' | 'shop' | 'make' | 'mirror' | 'map' | 'book' | 'repair' | 'settings';
/** The shop and the maker's book sit next to the bag (Dan R326 ⑪: the child goes shopping and building on their own). */
export const MENU_TABS: readonly MenuTab[] = ['bag', 'shop', 'make', 'mirror', 'map', 'book', 'repair', 'settings'];

/** Who asks the server: a linked child's device token, a lesson student's own token, or nobody (guest). */
export interface FrameAuth {
  token: string | null;
  kind: 'child' | 'lesson' | 'guest';
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MenuPanelProps {
  world: WorldHandle | null;
  identity: PlayerIdentity | null;
  auth: FrameAuth;
  /** a lesson is live: panels never start anything that would pull the child out of it */
  lessonOn: boolean;
  /** switch tab (e.g. the bag's "고쳐 줘야 해요" opens the repair tab) */
  go(tab: MenuTab): void;
  close(): void;
  /** the bag changed on the server (a move): the HUD hotbar and coins follow */
  syncBag?(): void;
  fetchImpl?: Fetch;
}

/**
 * Another window holds the screen (an NPC or review dialog, the first-visit card, the seat card, or a lesson dialog
 * marked on the HUD): the menu does not open over it, and closing the menu must not un-pause the world under it.
 * Windows inside the menu itself (the repair review) do not count.
 */
export function otherModalOpen(doc: Pick<Document, 'querySelector' | 'querySelectorAll'> | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc) return false;
  if (doc.querySelector('.lw-hud.dlg')) return true;
  for (const el of Array.from(doc.querySelectorAll('.lcw-dlg, [aria-modal="true"]'))) {
    if (!(el as Element).closest('.lcw-menu')) return true;
  }
  return false;
}
