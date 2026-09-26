/**
 * Visual tokens, copied from the product rather than invented for the video:
 * the app shell's stone palette (apps/web/src/index.css), the built-in reader
 * palettes (BUILTIN_READER_PALETTES in reader-theme.ts) and the landing
 * site's Literata. Keep these in step if the product's palette moves.
 */
export const color = {
  // App shell (light).
  paper: "#f5f5f4",
  surface: "#ffffff",
  fg: "#1c1917",
  fgMuted: "#57534e",
  fgSubtle: "#a8a29e",
  fill: "#f5f5f4",
  fillStrong: "#e7e5e4",
  border: "rgba(28, 25, 23, 0.1)",
  borderStrong: "#d6d3d1",
  stone500: "#78716c",
  // Reader "light" palette.
  page: "#ffffff",
  pageText: "#1c1917",
  pageMuted: "rgba(28, 25, 23, 0.34)",
  selection: "rgba(168, 162, 158, 0.34)",
  focus: "rgba(168, 162, 158, 0.2)",
  // Stage behind the window.
  stage: "#eeedeb",
} as const;

export const font = {
  serif: "Literata, Georgia, serif",
  sans: "Inter, -apple-system, 'Helvetica Neue', sans-serif",
} as const;

/** The window's lift off the stage; `k` fades it in as the camera pulls back. */
export const windowShadow = (k = 1) =>
  [
    `0 0 0 1px rgba(28,25,23,${(0.1 * k).toFixed(3)})`,
    `0 1px 2px rgba(28,25,23,${(0.06 * k).toFixed(3)})`,
    `0 12px 32px -8px rgba(28,25,23,${(0.16 * k).toFixed(3)})`,
    `0 48px 96px -24px rgba(28,25,23,${(0.22 * k).toFixed(3)})`,
  ].join(", ");

export const shadow = {
  float: "0 1px 2px rgba(28,25,23,0.08), 0 10px 28px -6px rgba(28,25,23,0.18)",
} as const;
