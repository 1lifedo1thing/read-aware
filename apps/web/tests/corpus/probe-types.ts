/** Shapes exchanged between the corpus probe page (`probe.ts`) and its runner. */

export type OpenSummary = {
  /** The import routing decision: file name / MIME first, then content sniffing. */
  formatHint: string | null;
  sniffed: boolean;
  bytes: number;
  /** Reading the file into memory (the app's IPC transfer is not modeled). */
  readMs: number;
  /** `parseBookFile`: container, metadata, spine and navigation. */
  parseMs: number;
  title: string;
  fixedLayout: boolean;
  writingMode: string | null;
  sections: number;
  linearSections: number;
};

export type OpenFailure = {
  formatHint: string | null;
  sniffed: boolean;
  bytes: number;
  /** Mirrors `BookInspection.status` for a failed initialization. */
  status: "unsupported" | "encrypted" | "failed";
  errorCode: string;
  message: string;
};

export type OpenResult = { ok: true; summary: OpenSummary } | { ok: false; failure: OpenFailure };

export type LabelMismatch = { label: string; found: string };

export type TocSummary = {
  /** Entries at every level as the book's own navigation (nav / NCX / outline / KF8 index) yields them. */
  sourceEntries: number;
  sourceDepth: number;
  /** After `ensureUsableToc`: repaired collapsed targets or synthesized missing entries. */
  entries: number;
  repair: "none" | "relocated" | "synthesized";
  repairMs: number;
  emptyLabels: number;
  unresolved: number;
  unresolvedSamples: string[];
  /** Chapters of the chapter map: what the reader and the text extractor split by. */
  chapterEntries: number;
  /** Deepest TOC level the chapter map took chapters from. */
  chapterDepth: number;
  mapMs: number;
  /** Differently numbered chapters that open the same section. */
  collapsed: string[][];
  labelChecked: number;
  labelMatched: number;
  /** Targets that open with a picture (image heading, title-page scan): not checkable against text. */
  labelPictured: number;
  /** TOC entries inside each chapter's range: finer structure the chapter still holds. */
  chapterNested: { title: string; nested: number }[];
  mismatches: LabelMismatch[];
  ms: number;
};

export type ChapterSummary = {
  /** The snapshot status the app would publish (`ready` / `partial` / `unsupported`). */
  status: string;
  text: string;
  timedOut: boolean;
  required: number;
  completed: number;
  failed: number;
  failureCodes: string[];
  chars: number;
  chapters: { title: string; chars: number }[];
  /** Entries of the outline recovered from page headings (paged books without one). */
  recoveredOutline: number;
  ms: number;
  slowestSectionMs: number;
  error: string | null;
};

export type RenderTarget = { label: string; target: string | number; index: number };

export type Overflow = {
  tag: string;
  width: number;
  limit: number;
  /** Diagnostics: why it cannot wrap or shrink. */
  whiteSpace: string;
  cssWidth: string;
  /** display / position / min-width / float / marker the engine's fit left, for diagnosis. */
  layout: string;
  text: string;
};

export type RenderSample = {
  mode: string;
  label: string;
  index: number;
  ok: boolean;
  /** `goTo` until the section is laid out (and a PDF page rasterized). */
  ms: number;
  error: string | null;
  /** Reflowable only: non-whitespace characters in the rendered section document. */
  textChars: number | null;
  pages: number | null;
  images: number;
  brokenImages: number;
  brokenImageSamples: string[];
  /** Elements wider than the text column (spill into the next column or get clipped). */
  overflows: Overflow[];
  /** Share of characters set smaller than 10.5 px after the reader's size normalization. */
  tinyTextShare: number;
  /** Filled in by the runner from the screenshot: share of non-background pixels. */
  ink?: number;
  shot?: string;
};

export type RenderSetup = { ok: boolean; mode: string; ms: number; error: string | null; targets: RenderTarget[] };

export type CorpusProbeApi = {
  open(input: { url: string; name: string; sniffOnly: boolean }): Promise<OpenResult | { ok: false; skipped: string }>;
  toc(): Promise<TocSummary>;
  /** Open a view in `mode`, or the reader's default mode for the book when omitted. */
  prepareRender(mode?: string): Promise<RenderSetup>;
  render(target: RenderTarget): Promise<RenderSample>;
  /** The view's box in CSS pixels, for the runner's screenshot clip. */
  stageRect(): { x: number; y: number; width: number; height: number };
  /** Share of pixels that differ from the dominant (background) color in a PNG data URL. */
  ink(dataUrl: string): Promise<number>;
  chapters(budgetMs: number): Promise<ChapterSummary>;
  close(): Promise<void>;
};

declare global {
  interface Window {
    corpusProbe?: CorpusProbeApi;
  }
}
