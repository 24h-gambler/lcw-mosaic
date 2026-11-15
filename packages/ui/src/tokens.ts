export const COLOR_TOKENS = {
  'ink-900': '#1B1F2A',
  'ink-700': '#3A4152',
  'ink-500': '#5F6778',
  'paper-0': '#FFFFFF',
  'paper-50': '#FFF9EE',
  'paper-100': '#F4EBDD',
  'line-200': '#E3D8C6',
  brand: '#FF6B4A',
  'brand-d': '#C73E22',
  sky: '#3FA9F5',
  'sky-d': '#1B6FB8',
  leaf: '#3DBE6B',
  'leaf-d': '#1B7A3E',
  sun: '#FFC53D',
  'sun-d': '#8F6200',
  grape: '#8E5BE8',
  'grape-d': '#6A3CC4',
  'grape-l': '#B9A2F5',
  danger: '#E5484D',
  'danger-d': '#C22F35',
  silver: '#C9CED9',
  'night-900': '#141824',
  'night-700': '#232A3B'
} as const;

export type ColorTokenName = keyof typeof COLOR_TOKENS;

export const SEMANTIC_TOKENS = {
  stars: {
    1: { color: 'silver' as ColorTokenName, starCount: 1, borderWidthPx: 1 },
    2: { color: 'sky' as ColorTokenName, starCount: 2, borderWidthPx: 2 },
    3: { color: 'sun' as ColorTokenName, starCount: 3, borderWidthPx: 3 }
  },
  masterPlan: {
    fill: 'grape' as ColorTokenName,
    border: 'sun' as ColorTokenName,
    icon: 'crown'
  },
  utteranceMode: {
    free: { color: 'brand' as ColorTokenName, pattern: 'solid' },
    guided: { color: 'sun' as ColorTokenName, pattern: 'diagonal' },
    read: { color: 'silver' as ColorTokenName, pattern: 'dots' },
    recall: { color: 'grape' as ColorTokenName, pattern: 'grid' }
  },
  speaker: {
    student: { color: 'brand' as ColorTokenName, row: 'top' },
    teacher: { color: 'sky' as ColorTokenName, row: 'bottom' }
  },
  zone: {
    core: { color: 'sky' as ColorTokenName, pattern: 'shield' },
    city: { color: 'sun' as ColorTokenName, pattern: 'bricks' },
    plot: { color: 'leaf' as ColorTokenName, pattern: 'fence' },
    wild: { color: 'ink-500' as ColorTokenName, pattern: 'none' }
  },
  gauge: {
    hunger: { color: 'sun' as ColorTokenName, icon: 'bread' },
    thirst: { color: 'sky' as ColorTokenName, icon: 'droplet' },
    temperature: { color: 'paper-0' as ColorTokenName, icon: 'snowflake' },
    heat: { color: 'danger' as ColorTokenName, icon: 'flame' },
    oxygen: { color: 'leaf' as ColorTokenName, icon: 'wind' },
    hp: { color: 'brand' as ColorTokenName, icon: 'heart' }
  }
} as const;

export const TYPOGRAPHY_TOKENS = {
  fonts: {
    ui: '"Pretendard", system-ui, -apple-system, sans-serif',
    target: '"Atkinson Hyperlegible", "Pretendard", sans-serif',
    pixel: '"Galmuri11", monospace',
    dyslexic: '"OpenDyslexic", "Atkinson Hyperlegible", sans-serif'
  },
  scale: {
    display: { sizePx: 48, lineHeightPx: 56 },
    h1: { sizePx: 36, lineHeightPx: 44 },
    h2: { sizePx: 28, lineHeightPx: 36 },
    h3: { sizePx: 22, lineHeightPx: 30 }, // target sentence minimum 22px
    'body-l': { sizePx: 18, lineHeightPx: 28 },
    body: { sizePx: 16, lineHeightPx: 24 },
    small: { sizePx: 14, lineHeightPx: 20 },
    micro: { sizePx: 12, lineHeightPx: 16 }
  },
  maxTargetCharsPerLine: 45,
  targetSentenceMinPx: 22
} as const;

export const SPACING_TOKENS = [4, 8, 12, 16, 24, 32, 48, 64] as const;

export const SHAPE_TOKENS = {
  radiusButtonPx: 4,
  radiusCardPx: 8,
  radiusHudSlotPx: 0,
  borderWidthPx: 2,
  focusOutlineWidthPx: 3,
  shadowDefault: `4px 4px 0 ${COLOR_TOKENS['ink-900']}`,
  shadowPressed: `1px 1px 0 ${COLOR_TOKENS['ink-900']}`,
  touchTargetMinPx: 44,
  gameButtonMinPx: 56,
  micButtonPx: 72,
  dashboardMaxWidthPx: 1120,
  dashboardColumns: 12,
  dashboardGutterPx: 24
} as const;

export const MOTION_TOKENS = {
  fastMs: 120,
  baseMs: 200,
  slowMs: 320,
  popMs: 240,
  maxCameraShakeDeg: 0.3,
  maxCameraShakeMs: 300,
  maxFlashesPerSec: 3,
  maxFlashScreenFraction: 0.25
} as const;

export const FORBIDDEN_PLAYER_UI_PATTERNS = [
  '틀렸어요',
  '실패',
  '지금 구매하지 않으면',
  '다른 친구들은',
  '결제하기',
  '구독하기'
] as const;

export const TOKENS = {
  colors: COLOR_TOKENS,
  semantic: SEMANTIC_TOKENS,
  typography: TYPOGRAPHY_TOKENS,
  spacing: SPACING_TOKENS,
  shape: SHAPE_TOKENS,
  motion: MOTION_TOKENS
} as const;
