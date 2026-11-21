import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeviceLinkPage, FamilyPage, edLinkErrorText, redeemEdTicket } from '../FamilyPage.js';
import { GUARDIAN_CONSENT_SCOPES, createFamilyApi, edTicketFromSearch, inviteFromHash, type FamilyMe } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const F = PARENT_STRINGS_KO.family;

const child = (consents: Partial<Record<(typeof GUARDIAN_CONSENT_SCOPES)[number], boolean>> = {}) => ({
  player_id: 'kid-1',
  nickname: 'Juno',
  level: 'A1',
  birth_year: 2016,
  consents: { voice_store: false, lesson_window: false, showroom_public: false, public_server: false, friend_voice: false, ...consents },
  devices: [{ id: 'dev-1', label: 'iPad', created_at: Date.parse('2026-11-16T05:00:00Z'), last_seen_at: null }],
  lessons: 1,
  last_lesson_at: Date.parse('2026-11-16T06:00:00Z'),
  reports: [{ share_path: '/r/abc', lesson_day: '2026-11-16', created_at: Date.parse('2026-11-16T07:00:00Z'), opened: true, expired: false, revoked: false }]
});

describe('family page (WP-301, docs/16 §3)', () => {
  it('without the required service consent: the service box first, every child switch disabled, no add-child', () => {
    const me: FamilyMe = { service_consented: false, children: [child()] };
    const html = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'ok', me }, initialToken: 'g' }));
    expect(html).toContain('data-testid="family-service"');
    expect(html.indexOf('data-testid="family-service"')).toBeLessThan(html.indexOf('data-testid="family-child-kid-1"'));
    const switches = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
    expect(switches.length).toBe(GUARDIAN_CONSENT_SCOPES.length);
    for (const b of switches) expect(b).toContain('disabled');
    expect(html).not.toContain('data-testid="family-add-child"');
  });

  it('after service consent: five optional consents, each its own switch, all off by default, no "all on" control', () => {
    const me: FamilyMe = { service_consented: true, children: [child({ voice_store: true })] };
    const html = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'ok', me }, initialToken: 'g' }));
    for (const s of GUARDIAN_CONSENT_SCOPES) expect(html).toContain(`data-testid="switch-${s}"`);
    expect(html.match(/role="switch"/g)?.length).toBe(GUARDIAN_CONSENT_SCOPES.length);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="switch-voice_store"/);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/모두 (켜기|동의)/);
    for (const s of GUARDIAN_CONSENT_SCOPES) expect(html).toContain(F.consents[s].refuse);
    expect(html).toContain('iPad');
    expect(html).toContain('11월 16일 (월)');
    expect(html).toContain('data-testid="family-add-child"');
  });

  it('no session (or a bad invite) asks for the teacher link, never a password form', () => {
    const html = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'no_session', inviteInvalid: true }, initialToken: null }));
    expect(html).toContain('data-testid="family-no-session"');
    expect(html).not.toContain('type="password"');
  });

  it('device link page renders a 6-digit code field', () => {
    const html = renderToStaticMarkup(React.createElement(DeviceLinkPage, {}));
    expect(html).toContain('data-testid="device-link-page"');
    expect(html).toMatch(/inputmode="numeric"/i);
  });

  it('English Day hand-off: /link?edt= shows the opening state, trades the ticket once and goes to the world', async () => {
    const T = `${'a'.repeat(20)}.${'0f'.repeat(32)}`;
    expect(edTicketFromSearch(`?edt=${T}`)).toBe(T);
    expect(edTicketFromSearch('?edt=abc')).toBeNull();
    expect(edTicketFromSearch('')).toBeNull();
    const html = renderToStaticMarkup(React.createElement(DeviceLinkPage, { edTicket: T }));
    expect(html).toContain('data-testid="device-ed-link"');
    expect(html).toContain(PARENT_STRINGS_KO.link.edBusy);
    expect(html).not.toContain(T);

    const sent: unknown[] = [];
    const saved: string[] = [];
    const went: string[] = [];
    const api = createFamilyApi({
      fetch: async (url, init) => {
        sent.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ device_token: 'd'.repeat(64), nickname: 'Pico', level: 'L2' }));
      }
    });
    const err = await redeemEdTicket(T, { api, save: (t, n) => saved.push(`${t.length}:${n}`), go: (p) => went.push(p) });
    expect(err).toBeNull();
    expect(sent).toEqual([{ url: '/v1/device/ed-link', body: { ticket: T } }]);
    expect(saved).toEqual(['64:Pico']);
    expect(went).toEqual(['/world/']);

    // a refusal names what to do and stays on the page (the code form is the fallback)
    const deny = (error: string, status = 403) =>
      createFamilyApi({ fetch: async () => new Response(JSON.stringify({ error }), { status }) });
    for (const [code, text] of [
      ['not_linked', PARENT_STRINGS_KO.link.edNotLinked],
      ['service_consent_required', PARENT_STRINGS_KO.link.edConsent],
      ['ticket_used', PARENT_STRINGS_KO.link.edExpired],
      ['invalid_ticket', PARENT_STRINGS_KO.link.edExpired]
    ] as const) {
      const w: string[] = [];
      expect(await redeemEdTicket(T, { api: deny(code), save: () => undefined, go: (p) => w.push(p) })).toBe(text);
      expect(w).toEqual([]);
    }
    expect(await redeemEdTicket(T, { api: deny('engday_unreachable', 503), save: () => undefined, go: () => undefined })).toBe(PARENT_STRINGS_KO.link.edDown);
    expect(edLinkErrorText('network')).toBe(PARENT_STRINGS_KO.link.edDown);
  });
});

describe('family api client', () => {
  it('invite comes only from a 48-hex #k= fragment', () => {
    const k = 'a'.repeat(48);
    expect(inviteFromHash(`#k=${k}`)).toBe(k);
    expect(inviteFromHash(`#x=1&k=${k}`)).toBe(k);
    expect(inviteFromHash('#k=abc')).toBeNull();
    expect(inviteFromHash(`#k=${'Z'.repeat(48)}`)).toBeNull();
  });

  it('sends the guardian token as bearer, one consent per request, and revokes by token not path', async () => {
    const seen: Array<{ method: string; url: string; auth: string | null; body: unknown }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ ok: true }));
    };
    const api = createFamilyApi({ fetch });
    await api.setConsent('gtok', 'kid-1', 'voice_store', true);
    await api.revokeReport('gtok', '/r/abc');
    await api.linkDevice('123456', 'iPad');
    expect(seen).toEqual([
      { method: 'PUT', url: '/v1/family/children/kid-1/consents/voice_store', auth: 'Bearer gtok', body: { granted: true } },
      { method: 'POST', url: '/v1/family/reports/abc/revoke', auth: 'Bearer gtok', body: {} },
      { method: 'POST', url: '/v1/device/link', auth: null, body: { code: '123456', label: 'iPad' } }
    ]);
  });

  it('server errors surface the error code', async () => {
    const api = createFamilyApi({ fetch: async () => new Response(JSON.stringify({ error: 'service_consent_required' }), { status: 403 }) });
    await expect(api.addChild('g', { nickname: 'a', birth_year: 2016 })).rejects.toMatchObject({ code: 'service_consent_required' });
  });
});
