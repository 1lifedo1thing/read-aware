# ReadAware pitch video

A 30-second, 1920×1080 product film made with [Remotion](https://www.remotion.dev).
It has music and no voiceover. The interface is redrawn in React at the app's
own logical size, from the product's source classes, tokens, copy and Phosphor
icons, so it can be re-rendered whenever the UI or the story changes.

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
- `src/components/Camera.tsx` lays the window out at 1100×700 logical pixels
  (the same values as `apps/web`) and scales it onto the frame. Every window scene
  shares the rest shot, so the dissolves between scenes line up.
- `src/components/app/` restates the product surfaces the film shows: the reader
  header, sentence navigator and selection menu, the chat transcript and
  composer, Settings → Plugins, and the shelf grid. When those change in
  `apps/web`, update the matching file here.
- `src/scenes/` holds one component per section: opening line → reader
  (sentence focus) → ask from the page → memory across books → plugins (Settings,
  then the agent calling the Dictionary plugin's tool) → formats and platforms →
  end card.

## Assets

- `public/covers/`: Project Gutenberg cover images (public domain), extracted
  from each book's EPUB and resized to 600 px wide. File names are Gutenberg ebook
  numbers.
- `public/icon.png`: the desktop app icon (`apps/desktop/src-tauri/icons/icon.png`).
- `public/fonts/`: Literata (from the landing site) and Inter. Both are SIL OFL.

The plugin names, versions and descriptions in the plugins scene come from the
first-party plugin manifests. The permission chips come from
`apps/web/src/i18n/locales/en/plugins.json`. The tool labels come from
`apps/web/src/i18n/locales/en/ai.json` and the Dictionary plugin's `lookup_word`
registration. Update them here when those sources change.
