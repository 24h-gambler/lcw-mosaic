import { COLOR_TOKENS, type ColorTokenName } from './tokens.js';

function srgbChannelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export interface ContrastSpecRow {
  fg: ColorTokenName;
  bg: ColorTokenName;
  expectedApprox: number;
  purpose: string;
  shouldPass: boolean;
}

/**
 * All 26 passing pairs + 2 explicitly forbidden pairs from docs/08-design-system.md 2.2
 */
export const CONTRAST_SPEC_ROWS: readonly ContrastSpecRow[] = [
  { fg: 'ink-900', bg: 'paper-50', expectedApprox: 15.7, purpose: '본문', shouldPass: true },
  { fg: 'ink-700', bg: 'paper-50', expectedApprox: 9.74, purpose: '보조 글자', shouldPass: true },
  { fg: 'ink-500', bg: 'paper-50', expectedApprox: 5.42, purpose: '설명 글자', shouldPass: true },
  { fg: 'ink-500', bg: 'paper-100', expectedApprox: 4.81, purpose: '구획 배경 위 설명', shouldPass: true },
  { fg: 'paper-0', bg: 'brand-d', expectedApprox: 5.07, purpose: '주요 버튼 글자', shouldPass: true },
  { fg: 'paper-0', bg: 'sky-d', expectedApprox: 5.23, purpose: '정보 버튼', shouldPass: true },
  { fg: 'paper-0', bg: 'leaf-d', expectedApprox: 5.38, purpose: '성공 버튼', shouldPass: true },
  { fg: 'paper-0', bg: 'grape-d', expectedApprox: 6.87, purpose: '마스터 꼬리표', shouldPass: true },
  { fg: 'paper-0', bg: 'danger-d', expectedApprox: 5.6, purpose: '경고 버튼', shouldPass: true },
  { fg: 'ink-900', bg: 'brand', expectedApprox: 5.84, purpose: '산호 면 위 글자', shouldPass: true },
  { fg: 'ink-900', bg: 'sky', expectedApprox: 6.43, purpose: '하늘 면 위 글자', shouldPass: true },
  { fg: 'ink-900', bg: 'leaf', expectedApprox: 6.88, purpose: '초록 면 위 글자', shouldPass: true },
  { fg: 'ink-900', bg: 'sun', expectedApprox: 10.43, purpose: '코인·3성 꼬리표', shouldPass: true },
  { fg: 'brand-d', bg: 'paper-50', expectedApprox: 4.84, purpose: '크림 위 산호 글자', shouldPass: true },
  { fg: 'sky-d', bg: 'paper-50', expectedApprox: 4.99, purpose: '크림 위 파랑 글자', shouldPass: true },
  { fg: 'leaf-d', bg: 'paper-50', expectedApprox: 5.14, purpose: '크림 위 초록 글자', shouldPass: true },
  { fg: 'sun-d', bg: 'paper-50', expectedApprox: 5.12, purpose: '크림 위 노랑 글자', shouldPass: true },
  { fg: 'grape-d', bg: 'paper-50', expectedApprox: 6.56, purpose: '크림 위 보라 글자', shouldPass: true },
  { fg: 'danger-d', bg: 'paper-50', expectedApprox: 5.34, purpose: '크림 위 빨강 글자', shouldPass: true },
  { fg: 'paper-0', bg: 'night-900', expectedApprox: 17.71, purpose: 'HUD 글자', shouldPass: true },
  { fg: 'sun', bg: 'night-900', expectedApprox: 11.22, purpose: 'HUD 코인', shouldPass: true },
  { fg: 'sky', bg: 'night-900', expectedApprox: 6.92, purpose: 'HUD 2성', shouldPass: true },
  { fg: 'silver', bg: 'night-900', expectedApprox: 11.23, purpose: 'HUD 1성', shouldPass: true },
  { fg: 'brand', bg: 'night-900', expectedApprox: 6.29, purpose: 'HUD 체력', shouldPass: true },
  { fg: 'leaf', bg: 'night-900', expectedApprox: 7.4, purpose: 'HUD 성공', shouldPass: true },
  { fg: 'grape-l', bg: 'night-900', expectedApprox: 8.05, purpose: 'HUD 마스터', shouldPass: true },
  { fg: 'paper-0', bg: 'brand', expectedApprox: 2.82, purpose: '(금지) 산호 면 위 흰 글자', shouldPass: false },
  { fg: 'grape', bg: 'night-900', expectedApprox: 4.06, purpose: '(금지) HUD 위 기본 보라', shouldPass: false }
];

export function checkAllContrastPairs(): {
  passed: number;
  failedRows: Array<ContrastSpecRow & { actual: number }>;
} {
  const failedRows: Array<ContrastSpecRow & { actual: number }> = [];
  let passed = 0;

  for (const row of CONTRAST_SPEC_ROWS) {
    const actual = contrastRatio(COLOR_TOKENS[row.fg], COLOR_TOKENS[row.bg]);
    const meetsAa = actual >= 4.5;
    if (meetsAa === row.shouldPass) {
      passed++;
    } else {
      failedRows.push({ ...row, actual });
    }
  }
  return { passed, failedRows };
}
