/**
 * Visual tokens, copied from the product rather than invented for the video:
 * the app shell's stone palette (apps/web/src/index.css), the built-in warm
 * reader palette (BUILTIN_READER_PALETTES in reader-theme.ts) and the faces the
 * app actually renders with. Keep these in step if the product's palette moves.
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
  inverseFg: "#fafaf9",
  border: "rgba(28, 25, 23, 0.1)",
  borderStrong: "#d6d3d1",
  stone500: "#78716c",
  // Reader "warm" palette, the default page.
  page: "#f5f1e8",
  pageText: "#292524",
  pageMuted: "rgba(41, 37, 36, 0.42)",
  pageRule: "rgba(41, 37, 36, 0.16)",
  pageFocus: "rgba(120, 104, 80, 0.12)",
  selection: "rgba(168, 162, 158, 0.34)",
  // Stage behind the window.
  stage: "#eeedeb",
} as const;

export const font = {
  /** App chrome and chat content: Inter. */
  sans: "Inter, -apple-system, 'Helvetica Neue', sans-serif",
  /** The app's `font-serif` token: the system serif (New York on macOS). */
  appSerif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  /** The book page and the film's own titles: Literata. */
  book: "Literata, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** The window's lift off the stage; `k` fades it in as the camera pulls back. */
export const windowShadow = (k = 1) =>
  [
    `0 0 0 1px rgba(28,25,23,${(0.12 * k).toFixed(3)})`,
    `0 1px 2px rgba(28,25,23,${(0.06 * k).toFixed(3)})`,
    `0 12px 32px -8px rgba(28,25,23,${(0.16 * k).toFixed(3)})`,
    `0 48px 96px -24px rgba(28,25,23,${(0.22 * k).toFixed(3)})`,
  ].join(", ");

export const shadow = {
  /** Popovers and floating bars in the app: a hairline plus a soft drop. */
  float: "0 1px 2px rgba(28,25,23,0.06), 0 8px 24px -6px rgba(28,25,23,0.16)",
  cover: "0 1px 2px rgba(28,25,23,0.12)",
} as const;
