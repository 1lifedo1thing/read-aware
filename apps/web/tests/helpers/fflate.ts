import type * as Fflate from "../../foliate-js/src/vendor/fflate.js";

/**
 * The vendored fflate runtime ships untouched under public/foliate-js/vendor, while its
 * declarations live beside the engine source that imports it. Load the served runtime and
 * type it with those declarations so fixtures inflate exactly as the engine does.
 */
const vendored: typeof Fflate = await import(new URL("../../public/foliate-js/vendor/fflate.js", import.meta.url).href);

export const { unzlibSync } = vendored;
