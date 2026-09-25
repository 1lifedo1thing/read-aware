import { expect, test } from "bun:test";
import type { RegisteredPluginFont } from "../../plugins/lib/plugin-types";
import { readerFontLabel } from "./reader-font-label";

const GARAMOND: RegisteredPluginFont = {
  key: "editorial-themes:eb-garamond",
  pluginId: "editorial-themes",
  pluginName: "Editorial Themes",
  id: "eb-garamond",
  family: "EB Garamond",
  files: [],
};

test("curated, installed and plugin fonts each show their own name", () => {
  expect(readerFontLabel("curated:lxgw", [])).toBe("霞鹜文楷 LXGW WenKai");
  expect(readerFontLabel("system:Songti SC", [])).toBe("Songti SC");
  expect(readerFontLabel("plugin:editorial-themes:eb-garamond", [GARAMOND])).toBe("EB Garamond");
});

test("a plugin font whose plugin is gone falls back to its stored id", () => {
  expect(readerFontLabel("plugin:editorial-themes:eb-garamond", [])).toBe("eb-garamond");
});
