/**
 * Music of the Hushwind Isles — written for LCW (docs/22 1장). Each step is an eighth note: a note name, '-' to hold
 * the one before, '.' for rest. Drums: 'x' hat, 'o' kick + snare, '.' rest.
 */
export type TrackId =
  | 'title'
  | 'story'
  | 'sail'
  | 'woods'
  | 'shore'
  | 'bakery'
  | 'tower'
  | 'shop'
  | 'post'
  | 'battle'
  | 'guardian'
  | 'boss1'
  | 'boss2'
  | 'boss3'
  | 'boss4'
  | 'storm'
  | 'down'
  | 'friend'
  | 'ending';

/** The meeting music of each island's guardian (R2734: every guardian has its own tune; the last stages turn hotter). */
export const BOSS_TRACK: Record<1 | 2 | 3 | 4, TrackId> = { 1: 'boss1', 2: 'boss2', 3: 'boss3', 4: 'boss4' };
/** The guardian's last stages: islands 1–3 share the hot tune, the Hushwind becomes a storm. */
export const BOSS_LAST_TRACK: Record<1 | 2 | 3 | 4, TrackId> = { 1: 'guardian', 2: 'guardian', 3: 'guardian', 4: 'storm' };

export interface Track {
  bpm: number;
  leadWave: OscillatorType;
  lead: string[];
  bass: string[];
  drums: string[];
}

const s = (x: string) => x.trim().split(/\s+/);

export const TRACKS: Record<TrackId, Track> = {
  story: {
    bpm: 76,
    leadWave: 'triangle',
    lead: s('E5 - - - D5 - C5 - D5 - E5 - G5 - - - A5 - G5 - E5 - D5 - C5 - - - - - . . F5 - - - E5 - D5 - E5 - G5 - C6 - - - B5 - A5 - G5 - E5 - D5 - - - - - . .'),
    bass: s('C3 - - - - - - - A2 - - - - - - - F2 - - - - - - - G2 - - - - - - -'),
    drums: s('. . . . . . . .')
  },
  sail: {
    bpm: 104,
    leadWave: 'triangle',
    lead: s('D5 G5 B5 A5 G5 D5 E5 G5 A5 B5 - - D6 B5 G5 A5 F#5 D5 G5 - - - . . B5 D6 B5 A5 G5 E5 F#5 A5 D6 C6 B5 A5 G5 - - D5 - - G5 - - - . .'),
    bass: s('G2 - D3 - B2 - C3 - G3 - E3 - D3 - A2 - F#3 - G2 - D3 - B2 -'),
    drums: s('o . x . x .')
  },
  shop: {
    bpm: 116,
    leadWave: 'square',
    lead: s('C5 F5 A5 F5 C6 - A5 - A#5 G5 E5 G5 F5 - - . C5 F5 A5 C6 D6 - C6 - A#5 A5 G5 E5 F5 - - .'),
    bass: s('F2 . C3 . F2 . C3 . C2 . G2 . F2 . C3 .'),
    drums: s('o . x x o . x .')
  },
  post: {
    bpm: 70,
    leadWave: 'sine',
    lead: s('G5 - - - D6 - - - B5 - - - A5 - - - G5 - - - E5 - - - D5 - - - - - - -'),
    bass: s('G2 - - - - - - - E2 - - - - - - - C2 - - - - - - - D2 - - - - - - -'),
    drums: s('. . . . . . . .')
  },
  boss1: {
    bpm: 144,
    leadWave: 'square',
    lead: s('A4 . C5 E5 . A5 G5 E5 F5 . E5 . D5 . C5 . B4 . D5 F5 . B5 A5 F5 G#5 - - - E5 - - - A4 . C5 E5 . A5 C6 B5 A5 . G5 . F5 . E5 . D5 E5 F5 . G#5 . B5 . A5 - - - - - . .'),
    bass: s('A2 A3 A2 A3 F2 F3 F2 F3 D2 D3 D2 D3 E2 E3 E2 E3'),
    drums: s('o x x o x x o x')
  },
  boss2: {
    bpm: 150,
    leadWave: 'square',
    lead: s('D5 . D5 F5 . A5 G5 . F5 E5 . C5 D5 - - . . . A5 . A5 C6 . A5 A#5 . A5 G5 . E5 F5 - - . . . D6 . C6 A#5 . A5 G5 . A5 F5 . E5 D5 . C#5 D5 - - - - -'),
    bass: s('D2 . A2 . D3 . A#1 . F2 . A#2 . C2 . G2 . C3 . A1 . E2 . A2 .'),
    drums: s('o x x o x x')
  },
  boss3: {
    bpm: 156,
    leadWave: 'square',
    lead: s('E5 G5 B5 . A5 G5 F#5 . G5 . E5 . D5 E5 . . E5 G5 B5 . C6 B5 A5 . B5 . G5 . F#5 . . . G5 A5 B5 D6 . C6 B5 A5 G5 A5 B5 . E5 . . . C6 . B5 . A5 . G5 . F#5 . D#5 . E5 - - -'),
    bass: s('E2 E2 E3 E2 C2 C2 C3 C2 D2 D2 D3 D2 B1 B1 B2 B1'),
    drums: s('o x o x o x o o')
  },
  boss4: {
    bpm: 132,
    leadWave: 'triangle',
    lead: s('F#5 - - C#6 - - A5 - G#5 - F#5 - E5 - - - F#5 - - A5 - - C#6 - D6 - C#6 - A5 - - - B5 - - G#5 - - E5 - D#5 - E5 - F#5 - - - C#5 - - F#5 - - A5 - G#5 - - - - - . .'),
    bass: s('F#2 - F#2 - F#2 - F#2 - D2 - D2 - D2 - D2 - E2 - E2 - E2 - E2 - C#2 - C#2 - F2 - C#2 -'),
    drums: s('o . x . o x x .')
  },
  storm: {
    bpm: 168,
    leadWave: 'square',
    lead: s('F#5 A5 C#6 F#6 . E6 C#6 A5 D6 . C#6 . B5 A5 G#5 . F#5 A5 C#6 F#6 . G#6 A6 . G#6 - - - F6 - - - A6 . G#6 F#6 . E6 D6 . C#6 . B5 A5 . G#5 A5 . F#5 . A5 . C#6 . F#6 . F6 - - - C#6 - - -'),
    bass: s('F#1 F#2 F#1 F#2 F#1 F#2 F#1 F#2 D1 D2 D1 D2 D1 D2 D1 D2 E1 E2 E1 E2 E1 E2 E1 E2 C#2 C#3 C#2 C#3 F2 C#3 G#2 C#3'),
    drums: s('o x o x o o o x')
  },
  down: {
    bpm: 64,
    leadWave: 'triangle',
    lead: s('A4 - - - C5 - B4 - A4 - - - E4 - - - F4 - - - A4 - G4 - E4 - - - - - - - F4 - - - E4 - D4 - E4 - - - A4 - - - C5 - - - B4 - - - A4 - - - - - - -'),
    bass: s('A2 - - - - - - - F2 - - - - - - - D2 - - - - - - - E2 - - - - - - -'),
    drums: s('. . . . . . . .')
  },
  ending: {
    bpm: 96,
    leadWave: 'triangle',
    lead: s('G4 C5 E5 G5 - - E5 - F5 - A5 - G5 - - - E5 G5 C6 - B5 - A5 - G5 - F5 - E5 - - - F5 - A5 - C6 - A5 - G5 - E5 - C5 - D5 - E5 - G5 - C6 - B5 - C6 - - - - - - -'),
    bass: s('C3 - G3 - E3 - G3 - F3 - C4 - A3 - C4 - G2 - D3 - B2 - D3 - C3 - G3 - C3 - - -'),
    drums: s('o . x . o x x .')
  },
  title: {
    bpm: 90,
    leadWave: 'triangle',
    lead: s('E5 - G5 - A5 - G5 E5 D5 - - - C5 - D5 - E5 - G5 - C6 - B5 A5 G5 - - - - - . .'),
    bass: s('C3 - - - G3 - - - F3 - - - G3 - - - A3 - - - E3 - - - F3 - - - G3 - - -'),
    drums: s('x . . . x . . .')
  },
  woods: {
    bpm: 100,
    leadWave: 'square',
    lead: s('G5 . B5 D6 - B5 A5 . G5 - E5 - D5 - . . E5 G5 A5 - B5 A5 G5 . D5 - - - . . . . G5 . B5 D6 - E6 D6 B5 A5 - G5 - E5 - . . D5 E5 G5 - A5 - B5 . G5 - - - - - . .'),
    bass: s('G2 - D3 - G2 - D3 - C3 - G3 - C3 - G3 - E3 - B2 - E3 - B2 - D3 - A2 - D3 - A2 -'),
    drums: s('x . x . o . x .')
  },
  shore: {
    bpm: 112,
    leadWave: 'square',
    lead: s('F5 A5 C6 - A5 - F5 . G5 A5 A#5 - A5 - G5 . F5 - C5 - F5 G5 A5 - G5 - - - . . . . A5 C6 D6 - C6 - A5 . A#5 A5 G5 - E5 - C5 . F5 - A5 - G5 - E5 - F5 - - - . . . .'),
    bass: s('F2 . C3 . F2 . C3 . C3 . G2 . C3 . G2 . A#2 . F3 . A#2 . F3 . C3 . G2 . C3 . E3 .'),
    drums: s('o . x x o . x x')
  },
  bakery: {
    bpm: 126,
    leadWave: 'triangle',
    lead: s('D5 - F#5 - A5 - B5 - A5 - F#5 - G5 - E5 - C#5 - D5 - - - - - A5 - B5 - D6 - C#6 - B5 - A5 - G5 - F#5 - E5 - D5 - - - . .'),
    bass: s('D3 - A3 - A3 - G3 - D3 - D3 - A2 - E3 - E3 - D3 - A3 - A3 -'),
    drums: s('o . x . x .')
  },
  tower: {
    bpm: 84,
    leadWave: 'triangle',
    lead: s('A4 - - - C5 - E5 - D5 - - - B4 - - - C5 - E5 - A5 - G5 - E5 - - - - - . . F5 - - - E5 - C5 - D5 - B4 - G#4 - - - A4 - C5 - E5 - D5 - A4 - - - - - . .'),
    bass: s('A2 - - - - - - - G2 - - - - - - - F2 - - - - - - - E2 - - - - - - -'),
    drums: s('x . . . . . . .')
  },
  battle: {
    bpm: 138,
    leadWave: 'square',
    lead: s('E5 . E5 G5 . E5 B5 A5 G5 . F#5 . E5 . D5 . E5 . E5 G5 . A5 B5 D6 B5 - - - A5 - G5 - C6 . B5 A5 . G5 A5 . B5 . A5 G5 F#5 . D5 . E5 . G5 . B5 . E6 . D#6 - - - B5 - - -'),
    bass: s('E2 E3 E2 E3 E2 E3 E2 E3 D2 D3 D2 D3 D2 D3 D2 D3 C2 C3 C2 C3 C2 C3 C2 C3 B1 B2 B1 B2 B1 B2 D#3 B2'),
    drums: s('o x x x o x o x')
  },
  guardian: {
    bpm: 150,
    leadWave: 'square',
    lead: s('D5 F5 A5 D6 . C6 A5 . A#5 . A5 . G5 F5 E5 . D5 F5 A5 D6 . E6 F6 . E6 - - - C#6 - - - F6 . E6 D6 . C6 A#5 . A5 . G5 F5 . E5 F5 . D5 . F5 . A5 . D6 . C#6 - - - A5 - - -'),
    bass: s('D2 D3 D2 D3 D2 D3 D2 D3 A#1 A#2 A#1 A#2 A#1 A#2 A#1 A#2 G1 G2 G1 G2 G1 G2 G1 G2 A1 A2 A1 A2 C#3 A2 E3 A2'),
    drums: s('o x o x o x o x')
  },
  friend: {
    bpm: 120,
    leadWave: 'triangle',
    lead: s('C5 E5 G5 C6 - - B5 - A5 G5 F5 A5 G5 - - - E5 G5 C6 E6 - - D6 - C6 B5 A5 B5 C6 - - -'),
    bass: s('C3 - G3 - C3 - G3 - F3 - C3 - G3 - D3 - A3 - E3 - A3 - E3 - F3 - G3 - C3 - - -'),
    drums: s('o . x . o . x x')
  }
};
