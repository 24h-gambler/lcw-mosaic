/** Player menu contract (frame domain, docs/08 8.6): every tab panel gets the same props. */
import type { WorldHandle } from '../../world/api.js';
import type { PlayerIdentity } from '../../world/identity.js';

export type MenuTab = 'bag' | 'mirror' | 'map' | 'book' | 'repair' | 'settings';
export const MENU_TABS: readonly MenuTab[] = ['bag', 'mirror', 'map', 'book', 'repair', 'settings'];

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
  fetchImpl?: Fetch;
}
