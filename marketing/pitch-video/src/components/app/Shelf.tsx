import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { WINDOW } from "../Camera";
import { color, font, shadow } from "../../theme";

/**
 * The shelf, restated from apps/web/src/features/shelf: the lg grid (six
 * columns, gap-x-6, gap-y-8), BookCover (a 2:3, rounded-sm cover) and
 * CollectionTile (a 2×2 montage with its name band). Collections lead the
 * grid, as they do in the app.
 *
 * Covers are Project Gutenberg editions (public domain), named by ebook number.
 */

type Collection = { collection: string; count: number; covers: number[] };
export type Tile = number | Collection;

export const SHELF: Tile[][] = [
  [{ collection: "Gutenberg classics", count: 12, covers: [84, 345, 11, 1400] }, 1342, 65661, 2641, 2000, 28054],
  [45304, 1184, 1513, 13951, 2554, 2701],
  [174, 64317, 5200, 1399, 1260, 1661],
];

const COLS = 6;
const PAD = 24;
const GAP_X = 24;
const GAP_Y = 32;
export const COVER_W = (WINDOW.w - PAD * 2 - GAP_X * (COLS - 1)) / COLS;
export const COVER_H = COVER_W * 1.5;

/** A tile's top-left in the shelf's content box. */
export const tileBox = (r: number, c: number) => ({ x: PAD + c * (COVER_W + GAP_X), y: 25 + r * (COVER_H + GAP_Y) });

export function findBook(id: number) {
  for (let r = 0; r < SHELF.length; r++) {
    const c = SHELF[r]!.indexOf(id);
    if (c >= 0) return { r, c };
  }
  throw new Error(`Book ${id} is not on the shelf`);
}

/** The grid; `tileStyle` lets a scene lift, dim or animate individual tiles. */
export function ShelfGrid({ tileStyle }: { tileStyle?: (tile: Tile, r: number, c: number) => CSSProperties }) {
  return (
    <>
      {SHELF.flatMap((row, r) =>
        row.map((tile, c) => {
          const b = tileBox(r, c);
          return (
            <div
              key={`${r}-${c}`}
              style={{
                position: "absolute",
                left: b.x,
                top: b.y,
                width: COVER_W,
                borderRadius: 2,
                boxShadow: shadow.cover,
                ...tileStyle?.(tile, r, c),
              }}
            >
              {typeof tile === "number" ? <BookCover id={tile} /> : <CollectionTile {...tile} />}
            </div>
          );
        }),
      )}
    </>
  );
}

export function BookCover({ id, style }: { id: number; style?: CSSProperties }) {
  return (
    <div style={{ borderRadius: 2, overflow: "hidden", aspectRatio: "2 / 3", ...style }}>
      <Img
        src={staticFile(`covers/${id}.jpg`)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

function CollectionTile({ collection, count, covers }: Collection) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "2 / 3",
        borderRadius: 2,
        overflow: "hidden",
        background: color.fill,
        boxShadow: `inset 0 0 0 1px ${color.border}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 1,
        }}
      >
        {covers.slice(0, 4).map((id) => (
          <Img
            key={id}
            src={staticFile(`covers/${id}.jpg`)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ))}
      </div>
      <div
        style={{ position: "absolute", insetInline: 0, bottom: 0, background: "rgba(12,10,9,0.7)", padding: "6px 8px" }}
      >
        <div style={{ fontFamily: font.appSerif, fontSize: 12, fontWeight: 500, lineHeight: 1.25, color: "#ffffff" }}>
          {collection}
        </div>
        <div style={{ marginTop: 2, fontFamily: font.sans, fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
          {count} books
        </div>
      </div>
    </div>
  );
}
