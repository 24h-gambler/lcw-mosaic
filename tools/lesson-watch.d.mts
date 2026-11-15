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
