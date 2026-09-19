export type CuratedFontKind = "sans" | "serif" | "cjk";

export type CuratedFont = {
  id: string;
  label: string;
  /** CSS font-family name — matches the family in the generated @font-face data. */
  family: string;
  kind: CuratedFontKind;
  /** Weights supplied by the generated face registry, in ascending order. */
  weights: readonly number[];
};

/** Lightweight catalog; the large generated face table stays in curated-fonts.ts. */
export const CURATED_FONTS: CuratedFont[] = [
  {
    id: "inter", label: "Inter", family: "Inter", kind: "sans",
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  {
    id: "atkinson", label: "Atkinson Hyperlegible", family: "Atkinson Hyperlegible", kind: "sans",
    weights: [400, 700],
  },
  {
    id: "literata", label: "Literata", family: "Literata", kind: "serif",
    weights: [300, 400, 500, 600, 700, 800, 900],
  },
  {
    id: "lora", label: "Lora", family: "Lora", kind: "serif",
    weights: [400, 500, 600, 700],
  },
  {
    id: "lxgw", label: "霞鹜文楷 LXGW WenKai", family: "LXGW WenKai", kind: "cjk",
    weights: [300, 400, 700],
  },
];

const CURATED_BY_ID = new Map(CURATED_FONTS.map((font) => [font.id, font]));

export function getCuratedFont(id: string): CuratedFont | undefined {
  return CURATED_BY_ID.get(id);
}

/** Generic CSS fallback appended after a curated family, chosen by its kind. */
export function curatedFallback(kind: CuratedFontKind): string {
  switch (kind) {
    case "serif":
      return "ui-serif, Georgia, serif";
    case "cjk":
      return '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-sans-serif, sans-serif';
    default:
      return "ui-sans-serif, system-ui, sans-serif";
  }
}
