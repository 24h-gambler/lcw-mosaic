/**
 * The edge's SQL on the real Durable Object SQLite (workerd via Miniflare), not only on node:sqlite.
 *
 * Why: the edge tests run the Durable Object storage on node:sqlite (apps/edge/src/__tests__/fake-do.ts). Cloudflare's
 * SQLite is built with tighter limits, and on 11-16 a query that passed every test failed on workerd ("too many terms
 * in compound SELECT", PR 129: the idle sweep never ran). This replays what the tests ran on workerd and fails when a
 * statement that worked in the tests fails there.
 *
 * How:
 *  1. The tests record every statement per fake storage when LCW_SQL_RECORD=<dir> is set (fake-do.ts).
 *  2. `replaySessions` runs each recorded session, in order, on its own SQLite Durable Object in workerd.
 *  3. A statement that was ok in the test and fails on workerd is a divergence (only the first per session counts:
 *     later ones usually follow from it).
 *
 * Run: `pnpm test:workerd-sql [test files…]` (tools/workerd-sql-check.mjs; default: every edge test). docs/09 §배포.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const WORKER = `
export class Sql {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(req) {
    const { stmts } = await req.json();
    const out = [];
    const dec = (v) => (v && typeof v === 'object' && '$bytes' in v) ? Uint8Array.from(atob(v.$bytes), (c) => c.charCodeAt(0)) : v;
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      try {
        this.ctx.storage.sql.exec(s.q, ...(s.b || []).map(dec)).toArray();
      } catch (e) {
        out.push({ i, err: String(e && e.message || e).slice(0, 300) });
      }
    }
    return Response.json(out);
  }
}
export default {
  async fetch(req, env) {
    const name = new URL(req.url).searchParams.get('s') || 'x';
    return env.SQL.get(env.SQL.idFromName(name)).fetch(req);
  }
};
`;

/** Starts workerd with one SQLite Durable Object class. `root` resolves the repo's miniflare. */
export async function startWorkerdSql(root = process.cwd()) {
  const require = createRequire(`${root}/package.json`);
  const { Miniflare } = await import(pathToFileURL(require.resolve('miniflare')).href);
  const mf = new Miniflare({
    modules: true,
    script: WORKER,
    compatibilityDate: '2025-01-01',
    durableObjects: { SQL: { className: 'Sql', useSQLite: true } }
  });
  return {
    /** Runs statements in order on the session's own Durable Object; returns the failures by index. */
    async run(session, stmts) {
      const fails = [];
      for (let at = 0; at < stmts.length; at += 400) {
        const chunk = stmts.slice(at, at + 400);
        const r = await mf.dispatchFetch(`http://sql/?s=${encodeURIComponent(session)}`, {
          method: 'POST',
          body: JSON.stringify({ stmts: chunk.map(({ q, b }) => ({ q, b })) })
        });
        for (const f of await r.json()) fails.push({ i: at + f.i, err: f.err });
      }
      return fails;
    },
    dispose: () => mf.dispose()
  };
}

/**
 * sessions: [{ name, stmts: [{ q, b, ok }] }] (ok = it ran in the test). Returns the first divergence per session:
 * [{ session, index, query, error }].
 */
export async function replaySessions(sessions, root = process.cwd()) {
  const w = await startWorkerdSql(root);
  const out = [];
  try {
    for (const s of sessions) {
      const fails = await w.run(s.name, s.stmts);
      const first = fails.find((f) => s.stmts[f.i]?.ok);
      if (first) out.push({ session: s.name, index: first.i, query: s.stmts[first.i].q.replace(/\s+/g, ' ').slice(0, 400), error: first.err });
    }
  } finally {
    await w.dispose();
  }
  return out;
}
