import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceClips } from '../VoiceClips.js';
import { ReportBody } from '../ParentReportPage.js';
import { PARENT_STRINGS_KO } from '../parentStrings.js';

const P = PARENT_STRINGS_KO.report;
const clip = (id: string, text: string) => ({ id, text, at: Date.UTC(2026, 10, 16, 6, 5), dur_ms: 2000, stars: 2, url: `/v1/voice/clips/${id}?e=1&s=ab` });
const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('report voice clips (guardian device only)', () => {
  it('lists the child’s turns with a player each, quoted in English, time in KST', () => {
    const html = render(
      React.createElement(VoiceClips, {
        token: 't'.repeat(32),
        guardianToken: 'g',
        initial: { status: 'ok', data: { voice_store: true, clips: [clip('a'.repeat(24), 'can i have a tea'), clip('b'.repeat(24), '')] } }
      })
    );
    expect(html).toContain(P.voiceTitle);
    expect(html).toContain(P.voiceNote);
    expect(html.match(/<audio/g)).toHaveLength(2);
    expect(html).toContain('preload="none"');
    expect(html).toContain(`src="/v1/voice/clips/${'a'.repeat(24)}?e=1&amp;s=ab"`);
    expect(html).toContain('“can i have a tea”');
    expect(html).toContain(P.voiceAt('11월 16일 15:05'));
  });

  it('consent off and empty periods say so; no guardian on this device shows nothing', () => {
    expect(render(React.createElement(VoiceClips, { token: 't', guardianToken: 'g', initial: { status: 'ok', data: { voice_store: false, clips: [] } } }))).toContain(P.voiceOff);
    expect(render(React.createElement(VoiceClips, { token: 't', guardianToken: 'g', initial: { status: 'ok', data: { voice_store: true, clips: [] } } }))).toContain(P.voiceEmpty);
    expect(render(React.createElement(VoiceClips, { token: 't', guardianToken: null }))).toBe('');
    expect(render(React.createElement(VoiceClips, { token: 't', guardianToken: 'g', initial: { status: 'idle' } }))).toBe('');
  });

  it('the teacher preview never asks for clips; the footer tells what is kept', () => {
    const report = { kind: 'weekly', ref_id: 'w', facts: {}, body: 'b', clips: [], created_at: 1, expires_at: 2 } as never;
    const preview = render(React.createElement(ReportBody, { report, preview: true, token: 't'.repeat(32) }));
    expect(preview).not.toContain('report-voice');
    expect(preview).toContain(P.footerPrivacy);
    expect(P.footerPrivacy).toContain('이 링크로는 들을 수 없습니다');
  });
});
