import type { LangLevel } from '@lcw/content';
import type { HintLevel, NpcContext } from '@lcw/schemas';

/**
 * docs/19 3: the dialog domain's contract with the world and lesson domains.
 * `NpcRef` is defined by the world domain in `world/api.ts` (docs/19 2); until that file lands on main it is
 * declared here with the same shape, and this file will re-export it from there.
 */
export interface NpcRef {
  id: string;
  ctx: NpcContext;
  nameKo: string;
  nameEn: string;
}

export type Level = LangLevel;
export type DialogMode = 'free' | 'guided' | 'read' | 'recall';
export type DialogHint = HintLevel;
export type SttSource = 'browser' | 'keyboard' | 'board' | 'device' | 'workers_ai';

export interface DialogOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
}

export interface DialogResult {
  pass: boolean;
  stars: number;
  feedbackKo: string;
  coinsTotal?: number;
  /** Words of the target the server did not hear (display only; optional — the lesson route does not send it). */
  missed?: string[];
  /** Item the server actually granted (solo orders); the world gives this one, else the scene default. */
  itemKey?: string;
}

/**
 * Same shape as the POST /v1/lesson/utterance body (docs/18 2). `echo` and `attempt` are dialog meta for the solo
 * route (/v1/converse/score); the lesson submit leaves them out because that body is strict.
 */
export interface UtteranceSubmit {
  target_text: string;
  transcript: string;
  chosen_stars: 1 | 2 | 3;
  hint_level: DialogHint;
  latency_ms: number;
  dur_ms: number;
  stt_source: SttSource;
  confidence: number;
  echo?: boolean;
  attempt?: number;
}

export interface DialogPanelProps {
  npc: NpcRef;
  level: Level;
  mode: DialogMode;
  /** Empty → looked up in the bank by npc.ctx (docs/19 3). */
  offers: DialogOffer[];
  hint: DialogHint;
  submit: (u: UtteranceSubmit) => Promise<DialogResult>;
  onDone: (r: DialogResult) => void;
  onClose: () => void;
  /** Optional extras (not in the docs/19 minimum): the NPC's question and accessibility font scale (1~1.5). */
  npcLine?: string;
  fontScale?: number;
  /** Test/preview seam: replaces the browser speech engine. */
  speech?: import('./speech.js').SpeechEngine;
}
