/**
 * "내 월드 만들기" (docs/08 §8.4 G07, Dan 11-16 R2555): a child does not pick a world from a list. The world is made
 * at random from a seed; the child chooses only its name and a few fun details. The server keeps the choice with the
 * child's home world (edge my-world.ts) and picks the seed itself; the client and the server read this one table.
 *
 * Every option is something the world shows at once: the season's weather drifting past, the time of day in the
 * sky, the animal friend walking next to the player.
 */

export type WorldSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type WorldTime = 'morning' | 'noon' | 'sunset';
export type WorldBuddy = 'puppy' | 'kitten' | 'bunny' | 'chick';

export interface WorldSetupChoice {
  season: WorldSeason;
  time: WorldTime;
  buddy: WorldBuddy;
}

export interface WorldSetup extends WorldSetupChoice {
  name: string;
  /** Picked by the server (or the device for a guest): the 3x3 sector layout and the terrain come from it. */
  seed: string;
}

export interface WorldSetupOption<K extends string> {
  id: K;
  emoji: string;
  labelKo: string;
  /** One short line under the card: what the child will see. */
  hintKo: string;
}

export const WORLD_SEASONS: readonly WorldSetupOption<WorldSeason>[] = [
  { id: 'spring', emoji: '🌸', labelKo: '봄', hintKo: '꽃잎이 날려요' },
  { id: 'summer', emoji: '☀️', labelKo: '여름', hintKo: '햇살이 반짝여요' },
  { id: 'autumn', emoji: '🍁', labelKo: '가을', hintKo: '단풍잎이 떨어져요' },
  { id: 'winter', emoji: '❄️', labelKo: '겨울', hintKo: '눈이 내려요' }
];

export const WORLD_TIMES: readonly WorldSetupOption<WorldTime>[] = [
  { id: 'morning', emoji: '🌅', labelKo: '아침', hintKo: '해가 막 떴어요' },
  { id: 'noon', emoji: '🌞', labelKo: '한낮', hintKo: '하늘이 파래요' },
  { id: 'sunset', emoji: '🌇', labelKo: '노을', hintKo: '하늘이 주황빛이에요' }
];

export const WORLD_BUDDIES: readonly WorldSetupOption<WorldBuddy>[] = [
  { id: 'puppy', emoji: '🐶', labelKo: '강아지', hintKo: '꼬리를 흔들며 따라와요' },
  { id: 'kitten', emoji: '🐱', labelKo: '고양이', hintKo: '살금살금 따라와요' },
  { id: 'bunny', emoji: '🐰', labelKo: '토끼', hintKo: '깡충깡충 따라와요' },
  { id: 'chick', emoji: '🐥', labelKo: '병아리', hintKo: '삐약삐약 따라와요' }
];

/** Hour of the sky for each time of day (the sky never goes to night: a child's town is always lit). */
export const WORLD_TIME_HOUR: Readonly<Record<WorldTime, number>> = { morning: 8, noon: 12.5, sunset: 18 };

export const WORLD_NAME_MAX = 12;

/** What a fresh world looks like when nothing was chosen (a lesson, an old device). */
export const DEFAULT_WORLD_CHOICE: WorldSetupChoice = { season: 'spring', time: 'noon', buddy: 'puppy' };

const pick = <K extends string>(list: readonly WorldSetupOption<K>[], v: unknown): K | null =>
  typeof v === 'string' && list.some((o) => o.id === v) ? (v as K) : null;

/**
 * A world name a child typed: trimmed, inner spaces folded, at most `WORLD_NAME_MAX` characters of Hangul, Latin
 * letters, digits and spaces. Anything else (links, symbols, an empty name) is refused, never silently changed.
 */
export function cleanWorldName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || [...name].length > WORLD_NAME_MAX) return null;
  if (!/^[\p{Script=Hangul}A-Za-z0-9 ]+$/u.test(name)) return null;
  return name;
}

/** The child's choice from a request body, or null when any part is missing or unknown. */
export function readWorldChoice(body: unknown): (WorldSetupChoice & { name: string }) | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const name = cleanWorldName(b.name);
  const season = pick(WORLD_SEASONS, b.season);
  const time = pick(WORLD_TIMES, b.time);
  const buddy = pick(WORLD_BUDDIES, b.buddy);
  return name && season && time && buddy ? { name, season, time, buddy } : null;
}

/** A stored setup read back (server row or device copy); null when it is not a whole, known setup. */
export function readWorldSetup(raw: unknown): WorldSetup | null {
  const c = readWorldChoice(raw);
  const seed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).seed : null;
  return c && typeof seed === 'string' && /^[0-9a-f]{8,32}$/.test(seed) ? { ...c, seed } : null;
}

/** A random choice (the dice on the make screen), from any 0..1 random source. */
export function randomWorldChoice(rand: () => number): WorldSetupChoice {
  const one = <K extends string>(list: readonly WorldSetupOption<K>[]): K => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!.id;
  return { season: one(WORLD_SEASONS), time: one(WORLD_TIMES), buddy: one(WORLD_BUDDIES) };
}
