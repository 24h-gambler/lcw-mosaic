export interface GuardianCheckRow {
  key: string;
  level: 'ok' | 'warn' | 'fail';
  msg: string;
}
export declare function maskShare(p: string | null | undefined): string | null;
export declare function checkGuardian(
  view: unknown,
  report: { status: number; body: unknown } | null,
  page: { status: number; type: string } | null,
  opts?: { lesson?: string; before?: boolean }
): GuardianCheckRow[];
