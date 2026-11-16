import { Hono } from 'hono';
import { z } from 'zod';
import type { SqliteExecutor } from './storage.js';
import { guardianFromRequest, issueGuardianSession } from './family.js';
import {
  OAUTH_PROVIDERS,
  identitiesOf,
  issueOAuthTicket,
  linkIdentity,
  redirectProviders,
  subjectOf,
  unlinkIdentity,
  type OAuthConfig,
  type OAuthProvider,
  type OAuthRoleHandler
} from './oauth.js';

/**
 * Guardian side of the shared sign-in (oauth.ts). A guardian account is a family: the children are profiles under it
 * (players.family_id), whether they came from the teacher's invite, from /family "아이 추가", or from the student
 * sign-up on a lesson device (/signup, lesson lane) — every path ends in the same guardian session.
 *
 * - Known sign-in (provider + sub linked to a guardian) → a new guardian session for that guardian.
 * - Linking (ticket `{link_guardian}` issued by `POST /v1/family/sign-in/link` for the guardian signed in on this
 *   browser, e.g. after the teacher's invite) → this Google/Kakao account now signs in to that same family. A sign-in
 *   already linked to another family is refused (`already_linked`), never moved.
 * - New sign-in, no ticket → a new family and guardian; the service consent is still to give (/family asks first).
 *
 * The handler answers `<return>#g=<token>` or `#linked=<provider>` (the browser keeps the session it had); oauth.ts turns
 * that into `#oauth=<one-use code>` that only this browser can exchange, so no token is ever in the address bar.
 */
export interface GuardianOAuthDeps {
  sql: SqliteExecutor;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (s: string) => Promise<string>;
  config: OAuthConfig;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Public routes of this module (each checks the guardian session itself); platform.ts isPublicRoute lists them. */
export const GUARDIAN_OAUTH_PUBLIC_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ['GET', /^\/v1\/family\/sign-in$/],
  ['POST', /^\/v1\/family\/sign-in\/link$/],
  ['DELETE', /^\/v1\/family\/sign-in\/(google|kakao)$/]
];

export function guardianOAuthHandler(d: GuardianOAuthDeps): OAuthRoleHandler {
  return async (identity, ctx) => {
    const now = ctx.nowMs;
    const linkTo = typeof ctx.ticket?.link_guardian === 'string' ? ctx.ticket.link_guardian : null;
    if (linkTo) {
      const g = d.sql.get<{ id: string }>('select id from guardians where id = ?', [linkTo]);
      if (!g) return { error: 'guardian_not_found', status: 404 };
      const r = linkIdentity(d.sql, { role: 'guardian', identity, subjectId: g.id }, now);
      if (r === 'taken') return { error: 'already_linked', status: 409 };
      return { redirect: `${ctx.returnTo}#linked=${identity.provider}` };
    }
    let guardianId = subjectOf(d.sql, 'guardian', identity.provider, identity.sub);
    let familyId = guardianId ? (d.sql.get<{ family_id: string }>('select family_id from guardians where id = ?', [guardianId])?.family_id ?? null) : null;
    if (guardianId && !familyId) {
      // The sign-in points at a guardian that is gone: drop that mapping so the new family below owns it.
      unlinkIdentity(d.sql, 'guardian', guardianId, identity.provider);
    }
    if (!guardianId || !familyId) {
      familyId = `fam-${hex(d.randomBytes(6))}`;
      guardianId = `g-${hex(d.randomBytes(6))}`;
      d.sql.run('insert into families (id, created_at) values (?, ?)', [familyId, now]);
      // guardians.oauth_sub stays null: oauth_identities is the one record of who signs in (an unlinked account
      // would otherwise collide with its old unique value when it signs in again).
      d.sql.run('insert into guardians (id, family_id, oauth_sub, locale) values (?, ?, null, ?)', [guardianId, familyId, 'ko']);
    }
    if (linkIdentity(d.sql, { role: 'guardian', identity, subjectId: guardianId }, now) === 'taken') return { error: 'already_linked', status: 409 };
    const token = await issueGuardianSession(d, guardianId, familyId, now);
    return { redirect: `${ctx.returnTo}#g=${token}`, token };
  };
}

const LinkSchema = z.object({ provider: z.enum(['google', 'kakao']), return: z.string().max(64).optional() }).strict();

/** /family "로그인 연결": which sign-ins this guardian has, link one more, take one off. */
export function buildGuardianOAuthApp(d: GuardianOAuthDeps): Hono {
  const app = new Hono();
  app.get('/v1/family/sign-in', async (c) => {
    const g = await guardianFromRequest(d, c.req.raw, d.nowMs());
    if (!g) return c.json({ error: 'guardian_only' }, 401);
    const linked = identitiesOf(d.sql, 'guardian', g.guardian_id);
    return c.json({
      available: redirectProviders(d.config),
      linked: linked.map((l) => ({ provider: l.provider, linked_at: l.created_at, last_login_at: l.last_login_at }))
    });
  });
  app.post('/v1/family/sign-in/link', async (c) => {
    const g = await guardianFromRequest(d, c.req.raw, d.nowMs());
    if (!g) return c.json({ error: 'guardian_only' }, 401);
    const p = LinkSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!p.success) return c.json({ error: 'invalid' }, 400);
    if (!redirectProviders(d.config).includes(p.data.provider)) return c.json({ error: 'not_configured' }, 503);
    const t = await issueOAuthTicket(d.sql, d.randomBytes, { role: 'guardian', data: { link_guardian: g.guardian_id } }, d.nowMs());
    const ret = encodeURIComponent(p.data.return ?? '/family');
    // The ticket only works in this browser (cookie): a start_path sent to someone else links nothing.
    c.header('set-cookie', t.setCookie);
    c.header('cache-control', 'no-store');
    return c.json({ start_path: `/v1/oauth/${p.data.provider}/start?role=guardian&return=${ret}&t=${t.ticket}` });
  });
  app.delete('/v1/family/sign-in/:provider', async (c) => {
    const g = await guardianFromRequest(d, c.req.raw, d.nowMs());
    if (!g) return c.json({ error: 'guardian_only' }, 401);
    const provider = c.req.param('provider') as OAuthProvider;
    if (!OAUTH_PROVIDERS.includes(provider)) return c.json({ error: 'invalid' }, 400);
    const linked = identitiesOf(d.sql, 'guardian', g.guardian_id);
    // The last sign-in stays: without it a family made by Google/Kakao would have no way back in.
    if (linked.length === 1 && linked[0]!.provider === provider) return c.json({ error: 'last_sign_in' }, 409);
    return c.json({ ok: unlinkIdentity(d.sql, 'guardian', g.guardian_id, provider) });
  });
  return app;
}
