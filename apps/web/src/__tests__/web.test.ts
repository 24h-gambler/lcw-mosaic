import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { App, CONSENT_SCOPE_LABELS, DIRECTOR_EVENTS } from '../App.js';

describe('apps/web (WP-305, WP-307, WP-309, WP-701, WP-702)', () => {
  it('enforces zero payment/price/deadline copy on child /play and /try routes (AGENTS.md 4.9)', () => {
    for (const route of ['/play', '/try'] as const) {
      const html = renderToStaticMarkup(React.createElement(App, { initialRoute: route }));
      expect(html).toContain('부모님께 소개 보내기');
      for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) {
        expect(html).not.toContain(pattern);
      }
      expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(html)).toBe(false);
    }
  });

  it('renders parent dashboard with AccessibleChartWithTable table toggle and granular consents (no agree-all button)', () => {
    const chartHtml = renderToStaticMarkup(
      React.createElement(App, { initialRoute: '/dashboard', initialShowChartTables: false })
    );
    expect(chartHtml).toContain('표 보기');
    expect(chartHtml).not.toContain('전체 동의');
    expect(chartHtml).not.toContain('모두 동의');

    for (const consent of CONSENT_SCOPE_LABELS) {
      expect(chartHtml).toContain(consent.title);
    }

    const tableHtml = renderToStaticMarkup(
      React.createElement(App, { initialRoute: '/dashboard', initialShowChartTables: true })
    );
    expect(tableHtml).toContain('<table');
    expect(tableHtml).toContain('그래프 보기');
    expect(tableHtml).toContain('42');
  });

  it('renders teacher director console with all 6 events, E/C/H pins, and fact verifier', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialRoute: '/director' }));
    for (const ev of DIRECTOR_EVENTS) {
      expect(html).toContain(ev.label);
    }
    expect(html).toContain('E 핀 추가');
    expect(html).toContain('C 핀 추가');
    expect(html).toContain('H 핀 추가');
    expect(html).toContain('사실 일치');
  });

  it('displays transparent pricing without dark patterns on /parents and 0% commission on /teachers (docs/14)', () => {
    const parentsHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/parents' }));
    expect(parentsHtml).toContain('19,900원');
    expect(parentsHtml).toContain('29,900원');
    expect(parentsHtml).toContain('14일 이내 무조건 전액 환불');

    const teachersHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/teachers' }));
    expect(teachersHtml).toContain('25,000원');
    expect(teachersHtml).toContain('0%');
  });
});
