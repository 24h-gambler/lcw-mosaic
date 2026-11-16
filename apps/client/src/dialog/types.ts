import type { LangLevel } from '@lcw/content';
import type { HintLevel } from '@lcw/schemas';
import type { NpcRef } from '../world/api.js';

/**
 * docs/19 3: the dialog domain's contract with the world and lesson domains.
 * `NpcRef` is the world domain's (`world/api.ts`, docs/19 2).
 */
export type { NpcRef };

export type Level = LangLevel;
export type DialogMode = 'free' | 'guided' | 'read' | 'recall';
export type DialogHint = HintLevel;
export type SttSource = 'browser' | 'keyboard' | 'board' | 'device' | 'workers_ai';

export interface DialogOffer {
  stars: 1 | 2 | 3;
  text: string;
  hintTags: string[];
  /**
   * The bank's list price in coins for this sentence (better sentence, lower price: "말이 곧 화폐", docs/04 4.2).
   * Shown only; the server decides what is charged (stars actually granted, weekly index, discounts). Absent or 0:
   * the sentence sells nothing (asking the way, barter, errands, lessons).
   */
  price?: number;
}

/** What the world can draw for the dialog window (world api renderPreview; transparent PNG data URL or null). */
export type PreviewRequest = { kind: 'item'; itemKey: string; modifier?: string } | { kind: 'npc'; npcId: string };
export type RenderPreview = (req: PreviewRequest, sizePx: number) => Promise<string | null>;

export interface DialogResult {
  pass: boolean;
  stars: number;
  feedbackKo: string;
  /** The server's own English line (the lesson route's `feedback_en`); shown instead of the table mapping when set. */
  feedbackEn?: string;
  coinsTotal?: number;
  /** Words of the target the server did not hear (display only; optional — the lesson route does not send it). */
  missed?: string[];
  /**
   * Item the server actually granted and recorded (solo orders). The world gives exactly this; when it is missing
   * nothing was bought (short of coins, a miss, or a price-0 sentence) and the world gives nothing.
   */
  itemKey?: string;
  /** Price-0 sentences: what the child asked for (trade shop good to swap via /trades, guide place to point at). */
  askedKey?: string;
  /** Free talk: the bank sentence the server matched the child's words to (shown on the result card). */
  matchedText?: string;
  /** Guest practice (no lesson, no linked device): checked on the device, nothing is granted. */
  practice?: boolean;
  /** First-visit errand step this sentence moved (server state), and coins it paid on hand-over (docs/03 D1). */
  errand?: { state: 'offered' | 'accepted' | 'carrying' | 'done'; rewardCoins?: number };
}

/**
 * Same shape as the POST /v1/lesson/utterance body (docs/18 2). `echo`, `attempt` and `dialogId` are dialog meta
 * for the solo route (/v1/converse/score); the lesson submit leaves them out because that body is strict.
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
  /** One id per opened dialog window: retries and resends of the same order are one purchase on the server. */
  dialogId?: string;
  /**
   * The recorded turn (only with `recordClip`). Never sent in the scoring body: uploaded once afterwards, and only when
   * the server answers with `audio_upload` (voice_store on, edge voice.ts).
   */
  clip?: Promise<Blob | null>;
}

export interface DialogDoneInfo {
  followUpsDone: boolean;
}

export interface DialogPanelProps {
  npc: NpcRef;
  level: Level;
  mode: DialogMode;
  /** Empty → looked up in the bank by npc.ctx (docs/19 3). */
  offers: DialogOffer[];
  hint: DialogHint;
  submit: (u: UtteranceSubmit) => Promise<DialogResult>;
  /**
   * The window is finished (완료 on a result, or ✕/Esc after a pass) with its best result. With `followUps` given, the
   * second argument says the NPC asked all of them (or the child moved past the last one) — the lesson moves on from
   * there (R2625); without `followUps` it is left out.
   */
  onDone: (r: DialogResult, info?: DialogDoneInfo) => void;
  onClose: () => void;
  /**
   * What the NPC asks next in the same window, one per turn, after the opening line's answer passed (R2625: a window
   * never asks the same line twice). Each is answered in the child's own words (free talk, `target_text` ''), can be
   * skipped, and 완료 on the last one ends the window with `{ followUpsDone: true }`. An empty list ends at once.
   */
  followUps?: readonly string[];
  /** Scores the follow-up answers; defaults to `submit` (the lesson route scores free talk). Solo play scores locally. */
  followUpSubmit?: (u: UtteranceSubmit) => Promise<DialogResult>;
  /**
   * Every scored result the moment it shows (pass or not), before 좋아요: the world plays stars, coins and the item
   * then, not on close (outsider capture 2026-11-16). onDone still reports the window's best at the end.
   */
  onResult?: (r: DialogResult) => void;
  /** Optional extras (not in the docs/19 minimum): the NPC's question and accessibility font scale (1~1.5). */
  npcLine?: string;
  fontScale?: number;
  /** false hides the sentence voice buttons (memory-card reviews from the 1-day box on, docs/03 D8). */
  listen?: boolean;
  /** Test/preview seam: replaces the browser speech engine. */
  speech?: import('./speech.js').SpeechEngine;
  /** The guardian turned voice_store on (device /v1/device/me or lesson /v1/join): record spoken turns for replay. */
  recordClip?: boolean;
  /** The world's 3D thumbnails (item the sentence buys, the NPC's face); without it the window shows pictures. */
  renderPreview?: RenderPreview;
}
