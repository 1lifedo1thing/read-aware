import { findRegisteredByRef, parsePluginRef } from "../../plugins/lib/plugin-theme";
import type { RegisteredPluginFont } from "../../plugins/lib/plugin-types";
import { getCuratedFont } from "./curated-font-catalog";
import { curatedFontId, isPluginFont, systemFontFamily, type ReaderFontFamily } from "./reader-settings";

/**
 * The name to show for a reader font selection, where a surface names the
 * current font without listing the choices (FontField owns the list): a
 * curated font's label, an installed family's own name, a plugin font's
 * family, or, while its plugin is gone, the id it was stored under.
 */
export function readerFontLabel(font: ReaderFontFamily, pluginFonts: readonly RegisteredPluginFont[]): string {
  const curated = curatedFontId(font);
  if (curated !== null) return getCuratedFont(curated)?.label ?? curated;
  const system = systemFontFamily(font);
  if (system !== null) return system;
  if (isPluginFont(font)) {
    return findRegisteredByRef(font, pluginFonts)?.family ?? parsePluginRef(font)?.partId ?? font;
  }
  return font;
}
