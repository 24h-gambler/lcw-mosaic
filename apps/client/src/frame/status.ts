/**
 * Pure read-outs for the HUD's status line and hotbar caption (docs/08 8.1, G01). The world HUD (`world/hud.ts`) draws
 * them; keeping the wording here lets the rules be tested without a DOM.
 */
import { TUNING } from '@lcw/sim-core';
import { BAND_NAMES_KO, WORLD_STRINGS as W, nameBi, worldSay } from '../world/strings.js';
import { helpKoOn } from '../world/lang.js';

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

/**
 * The status chip's place line as the screen line (English) and its Korean help line (null while the help is off, or
 * when the place has no Korean name): "Town Square · Ground" over "중앙 광장 · 지상".
 */
export function placeBi(sceneTitle: string, band: BandId, help = helpKoOn()): { en: string; ko: string | null } {
  const b = nameBi(BAND_NAMES_KO[band]);
  const s = sceneTitle ? nameBi(sceneTitle) : null;
  const en = [sceneTitle ? (s?.en ?? sceneTitle) : '', b?.en ?? BAND_NAMES_KO[band]].filter(Boolean).join(' · ');
  if (!help || !b || (sceneTitle && !s)) return { en, ko: null };
  return { en, ko: [s?.ko ?? '', b.ko].filter(Boolean).join(' · ') };
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
  // the short chip line keeps the learn language only (the Korean help sits on the place line above it)
  const word = worldSay(weather === 'snow' ? 'weatherSnow' : isNight(hour) ? 'weatherNight' : 'weatherClear').text;
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
