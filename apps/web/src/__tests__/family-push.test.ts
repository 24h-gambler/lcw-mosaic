import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyPush, pushSupport } from '../FamilyPush.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const P = PARENT_STRINGS_KO.push;
const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  kakao: 'Mozilla/5.0 (Linux; Android 14; SM-S918N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.9.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
};
const full = { hasSw: true, hasPush: true, hasNotification: true, standalone: false };

describe('where push can work', () => {
  it('Chrome/Samsung: ok; KakaoTalk in-app: open another browser; iOS Safari tab: install first; installed iOS app: ok', () => {
    expect(pushSupport({ ua: UA.chromeAndroid, ...full })).toBe('ok');
    expect(pushSupport({ ua: UA.kakao, ...full })).toBe('in_app');
    expect(pushSupport({ ua: UA.iphone, ...full, hasPush: false })).toBe('ios_install');
    expect(pushSupport({ ua: UA.ipadDesktop, ...full })).toBe('ios_install');
    expect(pushSupport({ ua: UA.iphone, ...full, standalone: true })).toBe('ok');
    expect(pushSupport({ ua: UA.chromeAndroid, ...full, hasPush: false })).toBe('unsupported');
  });
});

describe('/family notices card', () => {
  const api = {} as never;
  const st = (over: Partial<{ devices: number; this_device: boolean; sending: boolean }> = {}) => ({ public_key: 'B'.repeat(87), devices: 1, this_device: true, sending: true, ...over });
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(FamilyPush, { api, token: 'g', ...props } as never));

  it('off → one button; on → state, test, off; held → says sending starts later and hides the test', () => {
    let html = render({ support: 'ok', initial: { state: st({ devices: 0, this_device: false }), subscribed: false } });
    expect(html).toContain(P.title);
    expect(html).toContain(P.on);
    expect(html).not.toContain(P.off);
    html = render({ support: 'ok', initial: { state: st({ devices: 3 }), subscribed: true } });
    expect(html).toContain(P.onState);
    expect(html).toContain(P.test);
    expect(html).toContain(P.off);
    expect(html).toContain(P.otherDevices(2));
    html = render({ support: 'ok', initial: { state: st({ sending: false }), subscribed: true } });
    expect(html).toContain(P.preparing);
    expect(html).not.toContain(P.test);
  });

  it('KakaoTalk and iPhone tabs get directions instead of a dead button', () => {
    let html = render({ support: 'in_app', initial: { state: st(), subscribed: false } });
    expect(html).toContain(P.inApp.replace(/"/g, '&quot;'));
    expect(html).not.toContain(P.on);
    html = render({ support: 'ios_install', initial: { state: st(), subscribed: false } });
    expect(html).toContain(P.iosInstall.replace(/"/g, '&quot;'));
    expect(html).not.toContain(P.on);
  });

  it('the service worker only shows what the server sent and only opens /family; the manifest scopes the app to /family', () => {
    const sw = readFileSync(fileURLToPath(new URL('../../public/family-sw.js', import.meta.url)), 'utf8');
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("d.url.startsWith('/family')");
    expect(sw).not.toMatch(/addEventListener\('fetch'/);
    const m = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/family.webmanifest', import.meta.url)), 'utf8'));
    expect(m).toMatchObject({ start_url: '/family', scope: '/family', display: 'standalone', lang: 'ko' });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
  });
});
