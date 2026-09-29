/**
 * Chapter coordinates a digest is valid for. v3 digests used TOC-delimited
 * chapters rather than EPUB spine file indices; v6 follows the chapter map
 * (reading order, chapter level — see foliate-js chapter-map.ts) over the
 * repaired navigation, which moves chapter indices wherever the top TOC level
 * was not the chapter level, or where the navigation had to be rebuilt from the
 * headings. (v4 and v5 were unreleased steps of the same change.)
 */
export const CHAPTER_DIGEST_VERSION = 6;

/** Read-only chapter memory contracts. These are distilled evidence, never verbatim source text. */
export type DigestFlavor = "narrative" | "expository";
/** Local optimistic condition for one chapter and its book classification, plus source identity. */
export type BookDigestSnapshot = {
  bookId: string;
  chapterIndex: number;
  flavor: DigestFlavor;
  revision: string;
  contentVersion?: string | null;
};
/** Names/aliases use this edition's spelling; flavor determines character vs concept semantics. */
export interface DigestCharacter {
  name: string;
  aliases?: string[];
  note?: string;
}
export interface DigestRelation {
  from: string;
  kind: string;
  to: string;
  note?: string;
}
export interface ChapterDigest {
  /** Source hash; absent on legacy summaries, which cannot be reused as current evidence. */
  contentVersion?: string;
  chapterIndex: number;
  /** Persisted provenance, not a content-versioned reading location. */
  chapterHref?: string;
  summary: string;
  characters: DigestCharacter[];
  relations: DigestRelation[];
  digestVersion: number;
  /** Legacy rows without flavor are narrative. */
  flavor?: DigestFlavor;
}
export interface BookGraphEdge extends DigestRelation {
  establishedAt: number;
}
export type BookGraphQuery = { names?: string[]; chapterIndex?: number };
export type BookGraphProfile = DigestCharacter & {
  appearsInChapters: number[];
  relations: BookGraphEdge[];
  relationsTruncated: boolean;
};
export type BookGraphResult = { fence?: string } & (
  | { graph: "empty" | "unavailable" | "miss"; note: string }
  | {
      graph: "chapter";
      contentVersion?: string;
      chapterIndex: number;
      chapterHref?: string;
      summary: string;
      entities: DigestCharacter[];
      relations: DigestRelation[];
    }
  | { graph: "profiles"; profiles: BookGraphProfile[]; notFound: string[]; truncated: boolean; note: string }
  | {
      graph: "overview";
      chaptersDigested: number;
      chapterRange: [number, number];
      entityCount: number;
      edgeCount: number;
      entities: { name: string; aliases?: string[]; chapters: number }[];
      truncated: boolean;
      note: string;
    }
);
