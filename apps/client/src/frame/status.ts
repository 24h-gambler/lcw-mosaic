/**
 * Pure read-outs for the HUD's status line and hotbar caption (docs/08 8.1, G01). The world HUD (`world/hud.ts`) draws
 * them; keeping the wording here lets the rules be tested without a DOM.
 */
import { TUNING } from '@lcw/sim-core';
import { BAND_NAMES_KO, WORLD_STRINGS as W } from '../world/strings.js';

export type BandId = (typeof TUNING.verticalBands)[number]['id'];
export type Weather = 'clear' | 'snow';

/** Vertical band at height y (world metres, docs/03 3.2). Out-of-range heights clamp to the nearest band. */
export function bandOf(y: number): BandId {
  const bands = TUNING.verticalBands;
  for (const b of bands) if (y >= b.minY && y < b.maxY + 1) return b.id;
  return y >= bands[0].minY ? bands[0].id : bands[bands.length - 1]!.id;
}

/** "중앙 광장 · 지상": the place first, then the band. */
export function placeLabel(sceneTitleKo: string, band: BandId): string {
  const b = BAND_NAMES_KO[band];
  return sceneTitleKo ? `${sceneTitleKo} · ${b}` : b;
}

/** Night by the sky bands (night 19~05, docs/08 6.2). */
export function isNight(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h < 5 || h >= 19;
}

/** "맑음 10:30" / "밤 21:10" / "눈 10:30" — the word carries what the icon colour shows (docs/08 2.3). */
export function clockLabel(hour: number, weather: Weather): string {
  const total = Math.floor((((hour % 24) + 24) % 24) * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const word = weather === 'snow' ? W.weatherSnow : isNight(hour) ? W.weatherNight : W.weatherClear;
  return `${word} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Caption over the hotbar for the selected slot: the thing's name, "빈 칸" for an empty slot, or — when all five are
 * empty — what the bar is for, so five dark boxes never read as an unfinished screen.
 */
export function hotbarCaption(slots: ReadonlyArray<{ title: string } | null>, selected: number): string {
  const it = slots[selected];
  if (it) return it.title;
  return slots.every((s) => s === null) ? W.hotbarAllEmpty : W.hotbarEmpty;
}
