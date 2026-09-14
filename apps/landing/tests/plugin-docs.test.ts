import { expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";
import { PLUGIN_PERMISSIONS } from "@read-aware/core";
import en from "../src/i18n/resources/en.docs.json";
import {
  CAPABILITIES,
  capabilityManifest,
  filterCapabilities,
  groupCapabilityMethods,
  validateExplorerSearch,
  type CapabilityDescriptions,
} from "../src/lib/plugin-capabilities";
import {
  inspectManifest,
  type PluginPermissionPreviewCopy,
} from "../src/lib/plugin-manifest-preview";
import { docHeadings } from "../src/lib/doc-headings";
import { LOCALES } from "../src/lib/i18n";

const descriptions = Object.fromEntries(
  Object.entries(en.capabilityBrowser.descriptions).map(([key, value]) => [
    key.replace("__", ":"),
    value,
  ]),
) as CapabilityDescriptions;
const keys = (object: object, prefix = ""): string[] =>
  Object.entries(object)
    .flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? keys(value, `${prefix}${key}.`)
        : [`${prefix}${key}:${typeof value}`],
    )
    .sort();
const blocks = (text: string) =>
  Array.from(text.matchAll(/```[^\n]*\n[\s\S]*?```/g), (match) => match[0]);
const structure = (text: string) =>
  Array.from(
    text.matchAll(/^(#{1,3}) |^```([^\n]*)|^(READAWARE_\w+_SLOT)$/gm),
    (match) =>
      match[1]
        ? `heading:${match[1].length}`
        : (match[3] ?? `fence:${match[2]}`),
  );
const links = (text: string) =>
  Array.from(text.matchAll(/\]\(([^)]+)\)/g), (match) => match[1]).sort();
const placeholders = (text: string) =>
  text.match(/\{\{[^}]+\}\}/g)?.sort() ?? [];
const sourceCopy = en.permissionPreview;
const copy = Object.fromEntries(
  Object.entries(sourceCopy).map(([key, value]) => [
    key,
    typeof value === "string" && value.includes("{{")
      ? (input: string) => value.replace(/\{\{(?:value|count)\}\}/g, input)
      : value,
  ]),
) as PluginPermissionPreviewCopy;

for (const locale of LOCALES) {
  test(`${locale} docs cover the English contract without changing code or destinations`, async () => {
    const translated = await Bun.file(
      new URL(`../src/i18n/resources/${locale}.docs.json`, import.meta.url),
    ).json();
    expect(keys(translated)).toEqual(keys(en));
    expect(translated.sampleManifest).toBe(en.sampleManifest);
    for (const [key, page] of Object.entries(en.pages)) {
      if (key === "privacy") continue;
      const body = translated.pages[key].body;
      expect(structure(body), `${locale}:${key} section order`).toEqual(
        structure(page.body),
      );
      expect(body).not.toMatch(/ZX(?:KEEP|保持|保留)\d*ZX/);
      expect(blocks(body), `${locale}:${key} code`).toEqual(blocks(page.body));
      expect(links(body), `${locale}:${key} links`).toEqual(links(page.body));
      expect(docHeadings(body).length, `${locale}:${key} sections`).toBe(
        docHeadings(page.body).length,
      );
      const headings = docHeadings(body);
      expect(
        new Set(headings.map((item) => item.id)).size,
        `${locale}:${key} duplicate anchors`,
      ).toBe(headings.length);
      expect(body.match(/READAWARE_\w+_SLOT/g) ?? []).toEqual(
        page.body.match(/READAWARE_\w+_SLOT/g) ?? [],
      );
    }
    for (const group of ["capabilityBrowser", "permissionPreview"] as const) {
      for (const [key, value] of Object.entries(en[group])) {
        if (typeof value === "string")
          expect(
            placeholders(translated[group][key]),
            `${locale}:${key}`,
          ).toEqual(placeholders(value));
      }
    }
    expect(
      Object.keys(translated.capabilityBrowser.descriptions)
        .map((key) => key.replace("__", ":"))
        .sort(),
    ).toEqual(CAPABILITIES.map((entry) => entry.key).sort());
    expect(
      Object.keys(translated.permissionPreview.permissionDescriptions)
        .map((key) => key.replace("__", ":"))
        .sort(),
    ).toEqual([...PLUGIN_PERMISSIONS].sort());
  });
}

test("method search and combined filters find current contracts and recover from unknown URLs", () => {
  const search = (input: object) =>
    filterCapabilities(
      validateExplorerSearch(input),
      descriptions,
      en.capabilityBrowser.topicNames,
    ).map((item) => item.key);
  expect(search({ q: "searchLocations" })).toEqual(["domains:library"]);
  expect(
    search({ q: "domains:MEMORY", topic: "intelligence", family: "domains" }),
  ).toEqual(["domains:memory"]);
  expect(search({ authority: "settings-grant" })).toEqual(["domains:settings"]);
  expect(search({ q: "does-not-exist" })).toEqual([]);
  expect(
    search({ family: "garbage", q: ["memory"], topic: "invalid" }),
  ).toHaveLength(CAPABILITIES.length);
  expect(validateExplorerSearch({ cap: "services:jobs", q: "jobs" }).cap).toBe(
    "services:jobs",
  );
  expect(
    validateExplorerSearch({ cap: "services:invented" }).cap,
  ).toBeUndefined();
  expect(validateExplorerSearch({ view: "manifest" }).view).toBe("manifest");
  expect(validateExplorerSearch({ view: "unknown" }).view).toBeUndefined();
});

test("API groups preserve nested paths and filtered methods without losing overloads", () => {
  const library = CAPABILITIES.find(
    (entry) => entry.key === "domains:library",
  )!;
  const groups = groupCapabilityMethods(library, library.methods);
  expect(
    groups
      .flatMap((group) => group.methods.map((method) => method.path))
      .sort(),
  ).toEqual(library.methods.map((method) => method.path).sort());
  const method = library.methods.find((method) =>
    method.path.endsWith("searchLocations"),
  )!;
  const filtered = groupCapabilityMethods(library, [method]);
  expect(filtered).toHaveLength(1);
  expect(filtered[0].name).toBe("queries.books");
  expect(filtered[0].methods[0]).toEqual({
    ...method,
    name: "searchLocations",
  });
  const storage = CAPABILITIES.find(
    (entry) => entry.key === "services:storage",
  )!;
  expect(
    groupCapabilityMethods(storage, storage.methods).some((group) =>
      group.name.includes("documents("),
    ),
  ).toBe(true);
});

test("manifest preview identifies incompatible contracts, authority gaps, and invalid network origins", () => {
  const sample = JSON.parse(en.sampleManifest);
  expect(inspectManifest(sample, copy).issues).toEqual([]);
  expect(
    inspectManifest(
      { ...sample, requires: { services: { network: "^1.0.0", fake: "*" } } },
      copy,
    ).issues,
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("services:network"),
      expect.stringContaining("services:fake"),
    ]),
  );
  expect(inspectManifest({ ...sample, permissions: [] }, copy).issues).toEqual(
    expect.arrayContaining([expect.stringContaining("service:network")]),
  );
  for (const networkAccess of [
    { origins: ["https://example.com/path"] },
    { origins: ["*", "https://example.com"] },
    { origins: [], extra: true },
  ]) {
    expect(
      inspectManifest({ ...sample, networkAccess }, copy).issues,
    ).toContain(copy.invalidNetworkAccess);
  }
  expect(
    inspectManifest(
      { ...sample, networkAccess: { origins: ["https://example.com/"] } },
      copy,
    ).origins,
  ).toEqual(["https://example.com"]);
  expect(
    inspectManifest({ ...sample, requires: "invalid" }, copy).issues,
  ).toContain(copy.invalidRequires);
  expect(
    inspectManifest({ ...sample, networkAccess: undefined }, copy).issues,
  ).toContain(copy.missingNetworkAccess);
});

test("starting fragments use catalog versions and distinguish domain access from origin and setting grants", () => {
  const get = (key: string) => CAPABILITIES.find((entry) => entry.key === key)!;
  expect(
    capabilityManifest(get("domains:memory"), "write").permissions,
  ).toEqual(["memory:write"]);
  expect(capabilityManifest(get("domains:memory")).permissions).toEqual([
    "memory:read",
  ]);
  expect(capabilityManifest(get("services:network")).networkAccess).toEqual({
    origins: ["https://api.example.com"],
  });
  expect(capabilityManifest(get("domains:settings")).settingsAccess).toEqual({
    read: ["appearance.theme"],
  });
  expect(capabilityManifest(get("schemas:themes")).permissions).toEqual([
    "ui:themes",
  ]);
});

test("minimal command example typechecks against the actual public PluginModule", () => {
  const example = blocks(en.pages.pluginsDevelop.body).find((block) =>
    block.startsWith("```typescript"),
  )!;
  const code = example
    .replace(/^```typescript\n/, "")
    .replace(/```$/, "")
    .replace(
      "export default",
      'const plugin: import("./index").PluginModule =',
    );
  const file = resolve(
    import.meta.dir,
    "../../../packages/plugin-types/src/__docs_example.ts",
  );
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, onError, shouldCreate) =>
    name === file
      ? ts.createSourceFile(file, code, language, true)
      : original(name, language, onError, shouldCreate);
  const program = ts.createProgram([file], options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((error) => error.file?.fileName === file);
  expect(
    errors.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    ),
  ).toEqual([]);
});
