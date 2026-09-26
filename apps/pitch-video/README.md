# ReadAware pitch video

A 30-second, 1920×1080 product film made with [Remotion](https://www.remotion.dev).
It has music and no voiceover. The interface is drawn in React from the product's
own tokens, copy and Phosphor icons, so it can be re-rendered whenever the UI or
the story changes.

```sh
bun run studio   # compose the score, then preview in Remotion Studio
bun run render   # compose the score, then write out/readaware-pitch.mp4
bun run still -- out/frame.png --frame=400   # one frame at half scale
```

## How it is built

- `src/timeline.ts` is the single clock. At 100 BPM and 30 fps a beat is exactly
  18 frames. Scene boundaries are written in bars, and the score reads the same
  constants, so every cut lands on a downbeat.
- `scripts/compose-score.ts` synthesizes the music (felt piano, pad, pluck, bass,
  soft drums, bell and a Freeverb room) into `public/score.wav`. It uses a fixed
  seed, so the output is deterministic, and it contains no licensed audio. The WAV
  is generated rather than committed.
- `src/scenes/` holds one component per section: opening line → reader
  (sentence focus) → ask from the page → memory across books → plugins extending
  the agent → formats and platforms → end card.

## Assets

- `public/covers/`: Project Gutenberg cover images (public domain), extracted
  from each book's EPUB and resized to 600 px wide. File names are Gutenberg ebook
  numbers.
- `public/android-reader.png`: the unmodified Android capture from
  `apps/landing/public/screenshots/android-reader-light.png` (provenance in
  `apps/landing/SCREENSHOTS.md`).
- `public/icon.png`: the desktop app icon (`apps/desktop/src-tauri/icons/icon.png`).
- `public/fonts/`: Literata (from the landing site) and Inter. Both are SIL OFL.

The plugin names, versions, permission chips and agent tool names in the plugins
scene come from the first-party plugin manifests. The chat tool labels come from
`apps/web/src/i18n/locales/en/ai.json`. Update them here when those sources change.
