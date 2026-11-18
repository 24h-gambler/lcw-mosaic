import { COLOR_TOKENS as T } from '@lcw/ui';

/**
 * The adventure's pixel palette: one table for every sprite and tile (AGENTS 6: colours live in one place). UI colours
 * come from @lcw/ui tokens; the extra art shades below exist only inside the pixel pictures.
 */
export const PAL = {
  ink: T['ink-900'],
  ink2: T['ink-700'],
  ink3: T['ink-500'],
  white: T['paper-0'],
  cream: T['paper-50'],
  paper: T['paper-100'],
  line: T['line-200'],
  brand: T.brand,
  brandD: T['brand-d'],
  sky: T.sky,
  skyD: T['sky-d'],
  leaf: T.leaf,
  leafD: T['leaf-d'],
  sun: T.sun,
  sunD: T['sun-d'],
  grape: T.grape,
  grapeD: T['grape-d'],
  grapeL: T['grape-l'],
  danger: T.danger,
  silver: T.silver,
  night: T['night-900'],
  night2: T['night-700'],
  // art-only shades
  moss: '#5E9C3F',
  mossD: '#356B2A',
  mossL: '#9BCB62',
  bark: '#7A4E2D',
  barkD: '#4E2F1B',
  sand: '#EED9A4',
  sandD: '#CDB176',
  sea: '#4FB3D9',
  seaD: '#2A7FA8',
  foam: '#D8F3FA',
  bread: '#D99A4E',
  breadD: '#A8692E',
  crust: '#7E4A20',
  pink: '#F49AC1',
  pinkD: '#C9628F',
  stone: '#9AA3B5',
  stoneD: '#6B7488',
  brick: '#B96A55',
  brickD: '#84463A',
  fog: '#B8BCCB',
  fogD: '#8A8FA3',
  glow: '#FFF2A8',
  shadow: 'rgba(27,31,42,0.22)'
} as const;

export type PalKey = keyof typeof PAL;
