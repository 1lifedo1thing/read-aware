/**
 * The single clock shared by the picture and the score.
 *
 * At 100 BPM and 30 fps one beat is exactly 18 frames, so every cut, word and
 * toggle can land on a beat without rounding. `scripts/compose-score.ts`
 * imports the same constants, which keeps the music and the edit in lockstep
 * if either is re-timed.
 */
export const FPS = 30;
export const BPM = 100;
export const BEAT = (FPS * 60) / BPM; // 18 frames
export const BAR = BEAT * 4; // 72 frames, 2.4 s

export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Frame at the start of a 1-based bar, plus an optional beat offset. */
export const at = (bar: number, beat = 0) => (bar - 1) * BAR + beat * BEAT;

/**
 * Scene boundaries in bars. The score's arrangement follows the same map:
 * piano alone under the opening line, the pulse entering with the reader,
 * the full groove through memory and plugins, and a held chord for the card.
 */
export const SCENES = {
  opening: { from: at(1), to: at(3) },
  reader: { from: at(3), to: at(5) },
  ask: { from: at(5), to: at(7) },
  memory: { from: at(7), to: at(9) },
  plugins: { from: at(9), to: at(11) },
  anywhere: { from: at(11), to: at(12) },
  card: { from: at(12), to: at(12) + 108 },
} as const;

export const DURATION = SCENES.card.to; // 900 frames, 30 s

export const seconds = (frames: number) => frames / FPS;
