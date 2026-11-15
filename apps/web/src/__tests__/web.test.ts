import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PLAYER_UI_PATTERNS } from '@lcw/ui';
import { App, CONSENT_SCOPE_LABELS, DEFAULT_PARENT_REPORT_STATE, DIRECTOR_EVENTS, ParentDashboardView } from '../App.js';

describe('apps/web (WP-305, WP-307, WP-309, WP-701, WP-702)', () => {
  it('enforces zero payment/price/deadline copy on child /play and /try routes (AGENTS.md 4.9)', () => {
    for (const route of ['/play', '/try'] as const) {
      const html = renderToStaticMarkup(React.createElement(App, { initialRoute: route }));
      // /play always offers the parent hand-off; /try shows it only after the child finishes the order
      if (route === '/play') expect(html).toContain('부모님께 소개 보내기');
      else expect(html).not.toContain('오늘 체험이 끝났어요');
      for (const pattern of FORBIDDEN_PLAYER_UI_PATTERNS) {
        expect(html).not.toContain(pattern);
      }
      expect(/[0-9,]+\s*원|결제|할인|구독|만료/.test(html)).toBe(false);
    }
  });

  it('renders parent dashboard with AccessibleChartWithTable table toggle and granular consents (no agree-all button)', () => {
    // /dashboard is the real guardian dashboard now (WP-309, dashboard.test.ts); the sample view is tested directly.
    const chartHtml = renderToStaticMarkup(React.createElement(ParentDashboardView, { initialShowTables: false }));
    expect(chartHtml).toContain('표 보기');
    expect(chartHtml).not.toContain('전체 동의');
    expect(chartHtml).not.toContain('모두 동의');

    for (const consent of CONSENT_SCOPE_LABELS) {
      expect(chartHtml).toContain(consent.title);
    }

    const tableHtml = renderToStaticMarkup(React.createElement(ParentDashboardView, { initialShowTables: true }));
    expect(tableHtml).toContain('<table');
    expect(tableHtml).toContain('그래프 보기');
    expect(tableHtml).toContain('42');
  });

  it('renders teacher director console with 7-stage arc, teacher scripts, bilateral barter, events/pins, and report tracker', () => {
    const html = renderToStaticMarkup(React.createElement(App, { initialRoute: '/director' }));
    expect(html).toContain('T01 120분 7단계 연속 수업 아크');
    expect(html).toContain('선생님 회화 대본');
    expect(html).toContain('선생-학생 물물교환');
    expect(html).toContain('철광석 3개 ↔ 따뜻한 꿀차 2잔 물물교환');
    expect(html).toContain('봉인 복습 상자 심기');
    expect(html).toContain('멘토 던전 정보 격차');
    expect(html).toContain('학부모에게 리포트 발송');
    for (const ev of DIRECTOR_EVENTS) {
      expect(html).toContain(ev.label);
    }
    expect(html).toContain('E 핀 추가');
    expect(html).toContain('C 핀 추가');
    expect(html).toContain('H 핀 추가');
    expect(html).toContain('사실 일치');
  });

  it('renders parent report delivery, 4-week anchor comparison, solo reuse, and opened target refresh on /report', () => {
    const sentHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/report' }));
    expect(sentHtml).toContain('W09 주간·수업 성장 리포트');
    expect(sentHtml).toContain('발송 완료 (학부모 수신 확인 대기)');
    expect(sentHtml).toContain('4/6');
    expect(sentHtml).toContain('직접 말한 시간: 22분');

    const openedHtml = renderToStaticMarkup(
      React.createElement(App, {
        initialRoute: '/report',
        initialReportState: {
          ...DEFAULT_PARENT_REPORT_STATE,
          deliveryStatus: 'opened',
          openedAtMs: 1_763_205_000_000,
          nextTargetsUpdated: true
        }
      })
    );
    expect(openedHtml).toContain('열람 확인됨 (교사 다음 수업 타깃 자동 갱신 완료)');
    expect(openedHtml).toContain('다음 수업 타깃 반영: 완료');
  });

  it('displays transparent pricing without dark patterns on /parents and the tutoring page on /teachers (docs/14)', () => {
    const parentsHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/parents' }));
    expect(parentsHtml).toContain('14,900원');
    expect(parentsHtml).toContain('119,000원');
    expect(parentsHtml).toContain('19,900원');
    expect(parentsHtml).toContain('159,000원');
    expect(parentsHtml).toContain('7일 이내 전액 환불');

    // /teachers is the old link to the tutoring page (docs/14 W04). The tutoring fee is set by the teacher
    // (docs/01 §4), so the page shows the lesson arc and the consult form instead of an invented seat price.
    const teachersHtml = renderToStaticMarkup(React.createElement(App, { initialRoute: '/teachers' }));
    expect(teachersHtml).toContain('120분');
    expect(teachersHtml).toContain('상담 신청');
    expect(teachersHtml).not.toContain('25,000원');
  });
});
