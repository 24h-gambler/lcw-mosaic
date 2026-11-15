export declare const WATCH_LIMITS: { slowMs: number; studentGoneMs: number; quietMs: number; quietAfterMs: number };
export declare function maskUrl(u: string | null | undefined): string;
export interface WatchAlert {
  key: string;
  msg: string;
}
export declare function checkLesson(
  l: { lesson_id: string; player_id?: string; plan_id?: string; stage_id?: string | null; started_at?: number; stage_started_at?: number },
  f: { status: number; body: unknown },
  now: number,
  prev: number | undefined
): { row: Record<string, unknown> & { utterances: number }; alerts: WatchAlert[] };
export declare function tick(): Promise<unknown>;
