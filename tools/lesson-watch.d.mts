export declare const WATCH_LIMITS: { slowMs: number; studentGoneMs: number; quietMs: number; quietAfterMs: number };
export declare function maskUrl(u: string | null | undefined): string;
export interface WatchAlert {
  key: string;
  msg: string;
  lesson?: string | null;
}
export declare function checkLesson(
  l: { lesson_id: string; player_id?: string; plan_id?: string; stage_id?: string | null; started_at?: number; stage_started_at?: number },
  f: { status: number; body: unknown },
  now: number,
  prev: number | undefined
): { row: Record<string, unknown> & { utterances: number }; alerts: WatchAlert[] };
export declare function tick(): Promise<unknown>;
export declare function tailVerdict(ev: unknown): {
  status: number | null;
  outcome: string | null;
  method: string;
  url: string;
  exceptions: string[];
  exceptionNames: string[];
  errorLogs: string[];
  s5xx: boolean;
  s4xx: boolean;
  killed: boolean;
  serverBad: boolean;
};

export interface WatchCard {
  source: string;
  ref: string;
  title: string;
  body: string;
  importance: number;
  actions: Array<Record<string, unknown>>;
}
export interface SeenAlert {
  scope: string;
  kind: string;
  msg: string;
  first: string;
  last: string;
  count: number;
}
export interface CardState {
  day: string;
  spine: string;
  seen: Record<string, SeenAlert>;
  posted: Record<string, { id: string; sig: string; at: string; state?: string | null; closed?: string }>;
  lastTick: string[];
  summary: { id: string; at: string } | null;
  lessonCardsOff?: string;
}
export declare const CARD_SOURCE: string;
export declare const LESSON_CARD_IMPORTANCE: number;
export declare const SUMMARY_IMPORTANCE: number;
export declare const TEST_CARD_IMPORTANCE: number;
export declare const EVENT_ALERTS: Set<string>;
export declare function alertScope(a: WatchAlert, dayStr: string): string;
export declare function scopeRef(scope: string): string;
export declare function emptyCardState(dayStr: string, spine: string): CardState;
export declare function scopeCard(st: CardState, scope: string, o: { base: string; out: string }): WatchCard;
export declare function planTick(st: CardState, alerts: WatchAlert[], at: string, o: { base: string; out: string }): Array<{ card: WatchCard; sig: string }>;
export declare function planWindowEnd(
  st: CardState,
  o: { base: string; from: string; to: string; out: string }
): { summary: WatchCard | null; closeRefs: string[]; standing: number; cleared: number };
export interface SettleHow {
  start?: number;
  max: number;
  tries: number;
  closeTooHigh?: boolean;
}
export interface SourceAdjust {
  hi: number;
  delta: number | null;
  muted: boolean;
  known: string;
  ceiling: boolean;
}
export declare function adjustFromFeedback(items: unknown, nowMs: number, limit: number, source?: string): SourceAdjust;
export declare function readAdjust(get: (path: string) => Promise<{ status: number; body: any }>, nowMs: number, source?: string): Promise<SourceAdjust>;
export declare function planSettle(target: number, adj: SourceAdjust, how: SettleHow): { skip: boolean; start: number; tries: number; ceiling?: number };
export declare function recordPosted<T extends { id?: string; closed?: string }>(prev: T | undefined, id: string, fields: Record<string, unknown>): Record<string, unknown>;
export declare const LESSON_SETTLE: SettleHow;
export declare const SUMMARY_SETTLE: SettleHow;
export interface SpineReply {
  status: number;
  body: any;
}
export interface ReadBack {
  state: string | null;
  importance: number | null;
}
export declare function settleImportance(
  o: SettleHow & {
    target: number;
    post: (importance: number) => Promise<SpineReply>;
    read: (id: string) => Promise<ReadBack>;
    close?: () => Promise<{ status: number }>;
    log?: (row: Record<string, unknown>) => void;
  }
): Promise<{ r: SpineReply; rb: ReadBack | null; asked: number; landed: Array<number | null>; tooHigh: boolean }>;
