import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CsvExportRow } from '../LessonDirector.js';
import { LessonApiError, createLessonApi, type FetchLike } from '../lessonApi.js';

describe("'오늘 기록 CSV 받기' (operator CSV export)", () => {
  it('fetches the CSV with the Bearer token and returns the blob with the server filename', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      return new Response('﻿at_kst,nickname\r\n2026-11-16T15:01:01+09:00,Oreo\r\n', {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="lcw-utterances-2026-11-16.csv"' }
      });
    };
    const api = createLessonApi({ fetch });
    const f = await api.exportCsv('op-secret', 'utterances');
    expect(calls).toEqual([{ url: '/v1/admin/export/utterances.csv', auth: 'Bearer op-secret' }]);
    expect(f.filename).toBe('lcw-utterances-2026-11-16.csv');
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the BOM reaches the saved file
    await api.exportCsv('op-secret', 'lesson-minutes', '2026-11-15');
    expect(calls[1]!.url).toBe('/v1/admin/export/lesson-minutes.csv?day=2026-11-15');
  });

  it('turns a server error into LessonApiError with its code (operator_only → key prompt)', async () => {
    const api = createLessonApi({
      fetch: async () => new Response(JSON.stringify({ error: 'operator_only' }), { status: 401, headers: { 'content-type': 'application/json' } })
    });
    const err = await api.exportCsv('wrong', 'utterances').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LessonApiError);
    expect(err).toMatchObject({ code: 'operator_only', status: 401 });
    const down = createLessonApi({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      }
    });
    await expect(down.exportCsv('op', 'utterances')).rejects.toMatchObject({ status: 0 });
  });

  it('the console row shows both buttons and the privacy note', () => {
    const html = renderToStaticMarkup(
      React.createElement(CsvExportRow, { api: { exportCsv: async () => ({ blob: new Blob([]), filename: 'x.csv' }) }, token: 'op', onAuthError: () => undefined })
    );
    expect(html).toContain('오늘 기록 CSV 받기');
    expect(html).toContain('오늘 진행표 CSV');
    expect(html).toContain('별명·id 로만');
    expect(html).toContain('data-testid="csv-utterances"');
  });
});
