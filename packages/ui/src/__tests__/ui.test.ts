import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  AccessibleChartWithTable,
  calculateDialogBoxHeightPx,
  checkAllContrastPairs,
  CONTRAST_SPEC_ROWS,
  FORBIDDEN_PLAYER_UI_PATTERNS,
  GuestPassEndModal,
  TOKENS
} from '../index.js';

describe('@lcw/ui WP-005 & WP-109 acceptance', () => {
  it('passes all 26 WCAG contrast pairs and rejects the 2 forbidden pairs from docs/08 2.2', () => {
    const result = checkAllContrastPairs();
    expect(result.failedRows).toEqual([]);
    expect(result.passed).toBe(CONTRAST_SPEC_ROWS.length);
  });

  it('enforces target sentence minimum 22px and 150% scale fits within 720px height (WP-109)', () => {
    expect(TOKENS.typography.targetSentenceMinPx).toBe(22);
    expect(TOKENS.typography.scale.h3.sizePx).toBeGreaterThanOrEqual(22);
    expect(calculateDialogBoxHeightPx(1.0)).toBeLessThanOrEqual(720);
    expect(calculateDialogBoxHeightPx(1.5)).toBeLessThanOrEqual(720);
  });

  it('renders GuestPassEndModal without any price, payment, or deadline pressure (AGENTS.md 4.9)', () => {
    const html = renderToStaticMarkup(
      React.createElement(GuestPassEndModal, { shareUrl: 'https://lcw.example/parents' })
    );
    expect(html).toContain('부모님께 소개 보내기');
    for (const forbidden of FORBIDDEN_PLAYER_UI_PATTERNS) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toMatch(/원|달러|\$|결제|할인|마감/);
  });

  it('renders a full data table when showTable is enabled for accessibility (WP-309)', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessibleChartWithTable, {
        title: '생각말하기 지수',
        unit: '점',
        showTable: true,
        points: [
          { label: '1주', value: 100 },
          { label: '2주', value: 112 }
        ]
      })
    );
    expect(html).toContain('<table');
    expect(html).toContain('112');
    expect(html).toContain('그래프 보기');
  });
});

describe('colour-vision assist palette (docs/08 11장, G14)', () => {
  it('keeps the docs/08 2.2 contrast rules for every token it swaps', async () => {
    const { COLOR_ASSIST_TOKENS, COLOR_TOKENS, contrastRatio } = await import('../index.js');
    const swapped = Object.keys(COLOR_ASSIST_TOKENS);
    expect(swapped.length).toBeGreaterThan(0);
    for (const base of ['leaf', 'danger'] as const) {
      const fill = COLOR_ASSIST_TOKENS[base]!;
      const deep = COLOR_ASSIST_TOKENS[`${base}-d`]!;
      expect(fill).not.toBe(COLOR_TOKENS[base]);
      expect(contrastRatio(COLOR_TOKENS['ink-900'], fill)).toBeGreaterThanOrEqual(4.5); // ink text on the light fill
      expect(contrastRatio(COLOR_TOKENS['paper-0'], deep)).toBeGreaterThanOrEqual(4.5); // white text on the deep shade
      expect(contrastRatio(deep, COLOR_TOKENS['paper-50'])).toBeGreaterThanOrEqual(4.5); // deep text on cream
      expect(contrastRatio(fill, COLOR_TOKENS['night-900'])).toBeGreaterThanOrEqual(4.5); // the fill on the night HUD
    }
  });
});
