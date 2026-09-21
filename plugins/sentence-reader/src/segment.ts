import type {
  PluginReaderTextSegment,
  PluginReaderTextSegmentInput,
} from "@read-aware/plugin-types";

// Minimal Intl.Segmenter surface: the workspace's ES2020 lib predates its
// typings, while every shipping WKWebView/Chromium runtime supports it.
type SentenceSegments = Iterable<{ index: number; segment: string }>;
type SentenceSegmenter = { segment: (input: string) => SentenceSegments };
type SegmenterConstructor = new (
  locales?: string,
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => SentenceSegmenter;

function segmenterConstructor(): SegmenterConstructor | null {
  if (typeof Intl === "undefined") return null;
  return (Intl as { Segmenter?: SegmenterConstructor }).Segmenter ?? null;
}

const segmenters = new Map<string, SentenceSegmenter>();

function sentenceSegmenter(language?: string): SentenceSegmenter | null {
  const Segmenter = segmenterConstructor();
  if (!Segmenter) return null;
  const key = language || "";
  const cached = segmenters.get(key);
  if (cached) return cached;

  let segmenter: SentenceSegmenter;
  try {
    segmenter = new Segmenter(language || undefined, { granularity: "sentence" });
  } catch {
    segmenter = segmenters.get("") ?? new Segmenter(undefined, { granularity: "sentence" });
    segmenters.set("", segmenter);
  }
  segmenters.set(key, segmenter);
  return segmenter;
}

function trimmedSpan(text: string): PluginReaderTextSegment[] {
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  const end = text.length - trailing;
  return end > leading ? [{ start: leading, end }] : [];
}

/**
 * Plugin-owned segmentation policy. Newlines from pretty-printed book source
 * are replaced with equal-width spaces before UAX #29 segmentation so a hard
 * source wrap cannot split a visual sentence; offsets still map to the host's
 * original text exactly.
 */
export function segmentTextUnits({
  text,
  language,
  unitId,
}: PluginReaderTextSegmentInput): PluginReaderTextSegment[] {
  if (unitId === "paragraph") return trimmedSpan(text);
  if (unitId !== "sentence") return [];

  const segmenter = sentenceSegmenter(language);
  if (!segmenter) return trimmedSpan(text);

  const segmentable = text.replace(/[\r\n\u0085\u2028\u2029]/g, " ");
  const result: PluginReaderTextSegment[] = [];
  for (const { index, segment } of segmenter.segment(segmentable)) {
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    const start = index + leading;
    const end = index + segment.length - trailing;
    if (end > start) result.push({ start, end });
  }
  return reattachOpeningQuotes(segmentable, mergeAbbreviationBreaks(segmentable, result));
}

// Abbreviations that a shipping ICU (Android WebView, WKWebView) breaks a
// sentence after, although they practically never end one: honorifics and
// ranks, Latin shorthands, references. Matched in their written case so
// that "I said no." or "plan b." keep their sentence end; `etc.` is left
// out on purpose because it closes sentences all the time.
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "Mr", "Mrs", "Ms", "Mx", "Dr", "Prof", "Sr", "Jr", "St", "Mt", "Ft",
  "Rev", "Fr", "Gen", "Col", "Maj", "Capt", "Lt", "Sgt", "Cpl", "Pvt", "Hon", "Pres", "Gov", "Sen", "Rep",
  "Messrs", "Mme", "Mlle", "Msgr",
  "vs", "cf", "viz", "e.g", "i.e", "ca", "approx", "No", "Nos", "Fig", "Figs", "Vol", "Vols", "Ch", "Chap", "Sec",
  "p", "pp", "ed", "eds", "op", "loc", "Inc", "Ltd", "Co", "Corp", "Bros",
]);
// The last word of a segment when it ends in a period: "Mr." / "e.g." / "J.".
const ABBREVIATION_TAIL = /(?:^|[\s(\[\u201C\u2018])([A-Za-z](?:\.[A-Za-z])?|[A-Za-z][a-z]{0,5})\.$/;

/**
 * UAX #29 has no abbreviation knowledge of its own; the exception data that
 * would keep "Mr. Smith" together is locale dictionary data that mobile
 * WebViews ship without. Re-join a segment that ends in a known non-terminal
 * abbreviation, or in a single capital initial ("J. K. Rowling"), with the
 * segment that follows it.
 */
function mergeAbbreviationBreaks(text: string, segments: PluginReaderTextSegment[]): PluginReaderTextSegment[] {
  const merged: PluginReaderTextSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && endsWithAbbreviation(text.slice(previous.start, previous.end))) {
      previous.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function endsWithAbbreviation(segment: string): boolean {
  const match = ABBREVIATION_TAIL.exec(segment);
  if (!match) return false;
  const word = match[1]!;
  // A lone capital is an initial ("J. K. Rowling"); "U.S." and other dotted
  // forms stay sentence ends, they close sentences as often as not.
  if (/^[A-Z]$/.test(word)) return true;
  return NON_TERMINAL_ABBREVIATIONS.has(word);
}

// Unambiguous opening quotes and brackets (curly and CJK forms). ASCII
// quotes are left alone: they open and close alike.
const OPENING_MARKS = /[\u201c\u2018\u300c\u300e\u301d\u3008\u300a\u3010\u3014\u3016\u3018\u301a\uff08\uff3b\uff5b\uff5f\ufe41\ufe43]/u;

/**
 * UAX #29 attaches an opening quote that follows a terminator to the sentence
 * before it, so dialogue-heavy prose segments as `他说。“` / `再见！”`. The
 * opening mark belongs to the utterance it opens: move a trailing run of
 * opening marks (and the whitespace before it) onto the next segment.
 */
function reattachOpeningQuotes(text: string, segments: PluginReaderTextSegment[]): PluginReaderTextSegment[] {
  for (let i = 0; i + 1 < segments.length; i++) {
    const current = segments[i]!;
    const next = segments[i + 1]!;
    let cut = current.end;
    while (cut > current.start && OPENING_MARKS.test(text[cut - 1]!)) cut--;
    if (cut === current.end) continue;
    const moved = cut;
    while (cut > current.start && /\s/.test(text[cut - 1]!)) cut--;
    if (cut === current.start) continue; // A segment that is only an opener stays put.
    current.end = cut;
    next.start = moved;
  }
  return segments;
}
