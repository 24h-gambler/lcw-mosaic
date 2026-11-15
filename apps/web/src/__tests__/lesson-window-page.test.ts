import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { FamilyPage } from '../FamilyPage.js';
import { DensityBand, LessonWindowPage, mergeCaptions, minuteShare } from '../LessonWindowPage.js';
import { createFamilyApi, type FamilyChild, type LessonWindowPayload } from '../familyApi.js';
import type { FetchLike } from '../lessonApi.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const W = PARENT_STRINGS_KO.window;
const NOW = 1_800_000_000_000;
const child: FamilyChild = {
  player_id: 'kid-1',
  nickname: 'Juno',
  level: 'L1',
  birth_year: 2016,
  consents: { voice_store: false, lesson_window: true, showroom_public: false, public_server: false, friend_voice: false },
  devices: [],
  lessons: 1,
  last_lesson_at: null,
  reports: []
};
const live: LessonWindowPayload = {
  live: true,
  status: {
    type: 'lesson.window_status',
    lesson_id: 'les-1',
    place: '꿀차 카페',
    situation: '선생님이 카페 주인 역할 중 · 카페 주문',
    target_sentence: 'Can I have a warm honey tea so I stay warm?',
    scene_icon: 'cafe',
    sent_at: NOW
  },
  started_at: NOW - 23 * 60_000,
  minutes: [
    { minute: 0, student_ms: 6000, teacher_ms: 30000 },
    { minute: 1, student_ms: 0, teacher_ms: 0 },
    { minute: 2, student_ms: 42000, teacher_ms: 9000 }
  ],
  captions: [
    { id: 'l1', at: NOW - 2000, who: 'teacher', speaker_ko: '카페 주인(선생님)', text: 'Welcome! What would you like?' },
    { id: 'u1', at: NOW - 1000, who: 'child', speaker_ko: '아이', text: 'can i have a tea', pass: true, stars: 1 }
  ],
  next_lesson_at: null,
  audio: { direction: 'recvonly', available: false, reason: 'realtime_not_configured' },
  poll_ms: 10_000,
  server_now: NOW
};

describe('parent lesson window page (WP-307)', () => {
  it('live: status bar with place · situation, goal sentence, density band, captions, listen-only note — no media elements', () => {
    const html = renderToStaticMarkup(
      React.createElement(LessonWindowPage, { initial: { state: 'ok', child, data: live, receivedAt: NOW }, nowMs: NOW + 5000 })
    );
    expect(html).toContain(W.title('Juno'));
    expect(html).toContain('꿀차 카페 · 선생님이 카페 주인 역할 중 · 카페 주문');
    expect(html).toContain('Can I have a warm honey tea so I stay warm?');
    expect(html).toContain('data-testid="density-band"');
    expect(html).toContain('data-testid="captions"');
    expect(html).toContain('Welcome! What would you like?');
    expect(html).toContain(W.passed(1));
    expect(html).toContain(W.elapsed(23));
    expect(html).toContain(W.audioOff);
    expect(html).not.toMatch(/<video|<audio/);
  });

  it('a status older than 30 s reads "waiting for signal" (docs/08 P04)', () => {
    const fresh = renderToStaticMarkup(
      React.createElement(LessonWindowPage, { initial: { state: 'ok', child, data: live, receivedAt: NOW - 29_000 }, nowMs: NOW })
    );
    expect(fresh).toContain('data-testid="status-line"');
    const stale = renderToStaticMarkup(
      React.createElement(LessonWindowPage, { initial: { state: 'ok', child, data: live, receivedAt: NOW - 31_000 }, nowMs: NOW })
    );
    expect(stale).not.toContain('data-testid="status-line"');
    expect(stale).toContain('신호를 기다리는 중');
  });

  it('idle shows the next lesson; consent off shows one explicit switch-on button; no session points to /family', () => {
    const idle = renderToStaticMarkup(
      React.createElement(LessonWindowPage, {
        initial: { state: 'ok', child, data: { ...live, live: false, status: null, minutes: [], captions: [], next_lesson_at: '11월 19일 목요일 17:30' }, receivedAt: NOW },
        nowMs: NOW
      })
    );
    expect(idle).toContain(W.idleTitle);
    expect(idle).toContain(W.nextLesson('11월 19일 목요일 17:30'));
    expect(idle).not.toContain('density-band');
    const consent = renderToStaticMarkup(React.createElement(LessonWindowPage, { initial: { state: 'consent', child }, nowMs: NOW }));
    expect(consent).toContain('data-testid="window-consent"');
    expect(consent).toContain(W.consentOn);
    expect(consent).not.toContain('Welcome!');
    const none = renderToStaticMarkup(React.createElement(LessonWindowPage, { initial: { state: 'no_session' }, nowMs: NOW }));
    expect(none).toContain('href="/family"');
  });

  it('density band: one 4px cell per minute in two rows, shade by share of the minute; legend + note', () => {
    const html = renderToStaticMarkup(React.createElement(DensityBand, { minutes: live.minutes }));
    expect(html.match(/<rect/g)?.length).toBe(6);
    expect(html).toContain('width="12"');
    expect(html).toContain(W.showTable);
    expect(minuteShare(30_000)).toBe(0.5);
    expect(minuteShare(90_000)).toBe(1);
    expect(minuteShare(-5)).toBe(0);
  });

  it('captions merge by id across polls, oldest first, capped', () => {
    const a = [{ id: 'a', at: 1, who: 'child' as const, speaker_ko: '아이', text: 'x' }];
    const b = [
      { id: 'a', at: 1, who: 'child' as const, speaker_ko: '아이', text: 'x' },
      { id: 'b', at: 3, who: 'teacher' as const, speaker_ko: '선생님', text: 'y' },
      { id: 'c', at: 2, who: 'child' as const, speaker_ko: '아이', text: 'z' }
    ];
    expect(mergeCaptions(a, b).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(mergeCaptions([], b, 2).map((c) => c.id)).toEqual(['c', 'b']);
  });

  it('listen-only by construction: the page source never asks for a microphone or camera', () => {
    const src = readFileSync(fileURLToPath(new URL('../LessonWindowPage.tsx', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/getUserMedia|mediaDevices|addTrack|sendrecv|sendonly/);
  });

  it('/window route renders the real page; /family links to the window only when the consent is on', () => {
    expect(renderToStaticMarkup(React.createElement(App, { initialRoute: '/window' }))).toContain('lesson-window-page');
    const me = { service_consented: true, children: [child, { ...child, player_id: 'kid-2', consents: { ...child.consents, lesson_window: false } }] };
    const html = renderToStaticMarkup(React.createElement(FamilyPage, { initial: { status: 'ok', me }, initialToken: 'g' }));
    expect(html).toContain('href="/window?child=kid-1"');
    expect(html).not.toContain('/window?child=kid-2');
  });

  it('api: guardian bearer, after= cursor only when set', async () => {
    const seen: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push(`${url} ${new Headers(init?.headers).get('authorization')}`);
      return new Response(JSON.stringify(live));
    };
    const api = createFamilyApi({ fetch });
    await api.lessonWindow('gtok', 'kid-1');
    await api.lessonWindow('gtok', 'kid-1', 123);
    expect(seen).toEqual(['/v1/family/children/kid-1/lesson-window Bearer gtok', '/v1/family/children/kid-1/lesson-window?after=123 Bearer gtok']);
  });
});
