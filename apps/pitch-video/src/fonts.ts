import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * Local copies of the product's faces: Literata (landing site, SIL OFL) and
 * Inter (app chrome, SIL OFL). Loaded from public/ so rendering never waits
 * on a network font request. loadFont holds the render until they are ready.
 */
export const fontsReady = Promise.all([
  loadFont({
    family: "Literata",
    url: staticFile("fonts/literata-normal-latin.woff2"),
    weight: "400 600",
    style: "normal",
  }),
  loadFont({
    family: "Literata",
    url: staticFile("fonts/literata-italic-latin.woff2"),
    weight: "400 500",
    style: "italic",
  }),
  ...(["400", "500", "600"] as const).map((weight) =>
    loadFont({
      family: "Inter",
      url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`),
      weight,
    }),
  ),
]);
