/**
 * Music of the Hushwind Isles — written for LCW (docs/22 1장). Each step is an eighth note: a note name, '-' to hold
 * the one before, '.' for rest. Drums: 'x' hat, 'o' kick + snare, '.' rest.
 */
export type TrackId = 'title' | 'woods' | 'shore' | 'bakery' | 'tower' | 'battle' | 'guardian' | 'friend';

export interface Track {
  bpm: number;
  leadWave: OscillatorType;
  lead: string[];
  bass: string[];
  drums: string[];
}

const s = (x: string) => x.trim().split(/\s+/);

export const TRACKS: Record<TrackId, Track> = {
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
