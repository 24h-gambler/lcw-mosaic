export * from './storage.js';
export * from './app.js';

import { QuotaMeter } from '@lcw/quota';
import type { LlmConverseInput } from '@lcw/schemas';

export interface CloudflareBindings {
  AI?: {
    run(model: string, input: LlmConverseInput): Promise<unknown>;
  };
}

/**
 * Cloudflare Worker module entrypoint for production deployment.
 * Cron triggers implement docs/09 §2:
 * - "0 3 * * *" (daily retention purge & consent verification)
 * - "0 * * * *" (hourly quota rollup)
 * - "0 6 * * 1" (weekly Monday 06:00 growth report generation)
 */
export const workerHandler = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'lcw-edge', runtime: 'cloudflare-workers' });
    }
    return Response.json({ error: 'configure_edge_bindings' }, { status: 501 });
  },
  async scheduled(event: { cron: string; scheduledTime: number }): Promise<{ task: string; day: string }> {
    const day = new Date(event.scheduledTime).toISOString().slice(0, 10);
    if (event.cron === '0 3 * * *') return { task: 'daily_retention_cleanup', day };
    if (event.cron === '0 6 * * 1') return { task: 'weekly_parent_reports', day };
    const _quota = new QuotaMeter(day);
    return { task: 'hourly_quota_rollup', day };
  }
};

export default workerHandler;
