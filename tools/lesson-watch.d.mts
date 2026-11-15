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
  key: string;
  lesson: string | null;
  msg: string;
  first: string;
  last: string;
  count: number;
}
export declare const CARD_SOURCE: string;
export declare const CARD_IMPORTANCE: number;
export declare const TEST_CARD_IMPORTANCE: number;
export declare const EVENT_ALERTS: Set<string>;
export declare function alertRef(a: WatchAlert, dayStr: string): string;
export declare function alertCard(a: WatchAlert, o: { base: string; dayStr: string; at: string; out: string }): WatchCard;
export declare function summaryCard(
  standing: Array<SeenAlert & { ref: string }>,
  cleared: Array<SeenAlert & { ref: string }>,
  o: { base: string; dayStr: string; from: string; to: string; out: string }
): WatchCard;
export declare function standingAlerts(
  seen: Record<string, SeenAlert>,
  lastTick: string[]
): { standing: Array<SeenAlert & { ref: string }>; cleared: Array<SeenAlert & { ref: string }> };
