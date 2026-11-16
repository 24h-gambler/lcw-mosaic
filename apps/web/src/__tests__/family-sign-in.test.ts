import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LessonApiError } from '../lessonApi.js';
import { oauthCodeFromHash, oauthResultFromHash, oauthStartPath, takeOAuthResult } from '../familyApi.js';
import { FamilyPage } from '../FamilyPage.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

/** /family sign-in with Kakao / Google (edge oauth.ts): what comes back in the fragment, where the buttons go. */
describe('guardian sign-in on /family', () => {
  it('reads the session, a linked sign-in, or an error from the fragment; nothing else', () => {
    const t = 'a'.repeat(64);
    expect(oauthResultFromHash(`#g=${t}`)).toEqual({ token: t });
    expect(oauthResultFromHash('#linked=kakao')).toEqual({ linked: 'kakao' });
    expect(oauthResultFromHash('#oauth_error=cancelled')).toEqual({ error: 'cancelled' });
    // an unknown code becomes the generic one; short or odd tokens are ignored
    expect(oauthResultFromHash('#oauth_error=whatever')).toEqual({ error: 'provider_error' });
    expect(oauthResultFromHash('#g=abc')).toBeNull();
    expect(oauthResultFromHash('#k=' + 'b'.repeat(48))).toBeNull();
    expect(oauthResultFromHash('')).toBeNull();
    // every server error code has a sentence
    for (const code of ['not_configured', 'state_mismatch', 'provider_error', 'token_invalid', 'cancelled', 'ticket_invalid', 'already_linked', 'guardian_not_found', 'handoff_invalid'])
      expect(PARENT_STRINGS_KO.family.signInErrors[code]).toBeTruthy();
  });

  it('a #g= token in the address bar is never taken as a sign-in; only the #oauth= code, traded by this browser', async () => {
    const t = 'a'.repeat(64);
    const code = 'c'.repeat(32);
    expect(oauthCodeFromHash(`#oauth=${code}`)).toBe(code);
    expect(oauthCodeFromHash('#oauth=zz')).toBeNull();
    const asked: string[] = [];
    const api = { oauthExchange: async (c: string) => (asked.push(c), { result: `g=${t}` }) };
    expect(await takeOAuthResult(api, `#oauth=${code}`)).toEqual({ token: t });
    expect(asked).toEqual([code]);
    // a link someone sent with their own session in it: ignored
    expect(await takeOAuthResult(api, `#g=${t}`)).toBeNull();
    expect(await takeOAuthResult(api, '#linked=kakao')).toBeNull();
    expect(await takeOAuthResult(api, '#oauth_error=cancelled')).toEqual({ error: 'cancelled' });
    const refused = { oauthExchange: async () => Promise.reject(new LessonApiError('handoff_invalid', 400)) };
    expect(await takeOAuthResult(refused, `#oauth=${code}`)).toEqual({ error: 'handoff_invalid' });
  });

  it('start paths carry the guardian role and an allowed return', () => {
    expect(oauthStartPath('kakao')).toBe('/v1/oauth/kakao/start?role=guardian&return=%2Ffamily');
    expect(oauthStartPath('google', '/signup')).toBe('/v1/oauth/google/start?role=guardian&return=%2Fsignup');
  });

  it('signed out: the invite text stays; no provider buttons before the server says which exist', () => {
    const html = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'no_session' }, initialToken: null }));
    expect(html).toContain(PARENT_STRINGS_KO.family.noSessionBody);
    expect(html).not.toContain(PARENT_STRINGS_KO.family.signInKakao);
  });
});
