/**
 * Publish a released app's plugin contract to the marketplace repository.
 *
 *   bun scripts/sync-plugin-dts.ts [--ref vX.Y.Z] [--market ../readaware-plugins] [--check]
 *
 * Plugins target released apps, so everything is generated from the sources
 * at a release tag (default: the tag of the app version in tauri.conf.json),
 * never from the development branch:
 *
 * - `types/plugin-api.d.ts` — the public contract as ONE self-contained
 *   declaration file. TypeScript emits declarations for `@read-aware/plugin-types`
 *   and `@read-aware/core`, then dts-bundle-generator inlines every core type
 *   the contract references (`HostSyncPort`, read models, events…). Nothing is
 *   copied by hand or located by text anchors, so the mirror cannot drift
 *   from the release it names.
 * - `types/host-capabilities.json` — the release's capability catalog: every
 *   domain, contribution, service and schema with its version and the
 *   permission it needs, plus the contribution icon names and the built-in
 *   shortcut chords a command's `defaultShortcut` must avoid. The registry
 *   validator checks manifests against it, and authors read it to choose
 *   `requires` ranges.
 * - `apps/landing/src/lib/released-capabilities.generated.json` — the same
 *   catalog for the website's "latest release" column.
 *
 * Public-contract policy, applied to the bundle's syntax tree:
 * 1. Value exports lose `export`: plugins run in a sandbox without the host's
 *    runtime modules, so a mirror that exported values would invite imports
 *    that cannot resolve. The declarations stay for the types that use them.
 * 2. `reader:modes` and the reader-mode contribution stay out of the public
 *    contract — reserved for bundled first-party plugins, rejected at
 *    activation and by the registry validator.
 *
 * `--check` regenerates in memory and fails when any output differs. Run it,
 * or regenerate, in the release flow (.agents/skills/publishing/SKILL.md).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { generateDtsBundle } from "dts-bundle-generator";
import ts from "typescript";

const repoRoot = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const check = args.includes("--check");
const appVersion = JSON.parse(readFileSync(join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"))
  .version as string;
const ref = option("--ref") ?? `v${appVersion}`;
const marketRoot = resolve(option("--market") ?? join(repoRoot, "../readaware-plugins"));
const landingCatalogPath = join(repoRoot, "apps/landing/src/lib/released-capabilities.generated.json");

const ICONS_PATH = "apps/web/src/features/plugins/lib/plugin-icons.tsx";
const SHORTCUTS_PATH = "apps/web/src/features/settings/lib/shortcuts.ts";
const RESERVED_PERMISSION = "reader:modes";
const RESERVED_CONTRIBUTION = "readerModes";

function git(...gitArgs: string[]): string {
  return execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).trim();
}

/** The release's own sources, outside the working tree. */
function extractRelease(target: string): string {
  const commit = git("rev-parse", "--verify", `${target}^{commit}`);
  const dir = mkdtempSync(join(tmpdir(), "readaware-plugin-contract-"));
  const archive = execFileSync(
    "git",
    [
      "archive",
      commit,
      "packages/core/src",
      "packages/plugin-types/src",
      "packages/tsconfig/base.json",
      ICONS_PATH,
      SHORTCUTS_PATH,
    ],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  return dir;
}

function fail(diagnostics: readonly ts.Diagnostic[], stage: string): never {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  };
  throw new Error(`${stage} failed:\n${ts.formatDiagnostics(diagnostics, host)}`);
}

/** Stage 1: declarations for the contract and everything it reaches in core. */
function emitDeclarations(source: string, out: string): string {
  const base = ts.readConfigFile(join(source, "packages/tsconfig/base.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(base.config, ts.sys, join(source, "packages/tsconfig"));
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    allowImportingTsExtensions: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    // The repo gets ES2022 error options from Bun's types; name the lib instead.
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    rootDir: join(source, "packages"),
    outDir: out,
    baseUrl: source,
    paths: { "@read-aware/core": ["packages/core/src/index.ts"] },
  };
  const program = ts.createProgram([join(source, "packages/plugin-types/src/index.ts")], options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) fail(diagnostics, "Declaration type check");
  const result = program.emit();
  if (result.diagnostics.length) fail(result.diagnostics, "Declaration emit");
  // `emitSkipped` is also set for the program's JSON modules, which have no
  // declaration output; the contract's own entry is what must exist.
  const entry = join(out, "plugin-types/src/index.d.ts");
  if (!existsSync(entry)) throw new Error("Declaration emit produced no plugin-types entry");
  return entry;
}

/** Stage 2: inline every referenced core type into one file. */
function bundle(entry: string, out: string): string {
  const config = join(out, "tsconfig.bundle.json");
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        lib: ["ES2020", "DOM"],
        types: [],
        baseUrl: ".",
        paths: { "@read-aware/core": ["core/src/index.d.ts"] },
      },
      files: [relative(out, entry)],
    }),
  );
  const [text] = generateDtsBundle(
    [{ filePath: entry, libraries: { inlinedLibraries: ["@read-aware/core"] }, output: { noBanner: true } }],
    { preferredConfigPath: config },
  );
  if (!text) throw new Error("dts-bundle-generator produced no output");
  return text;
}

type Edit = { start: number; end: number; text: string };

/** Stage 3: the public-contract policy, as edits on the bundle's syntax tree. */
function applyPolicy(text: string): string {
  const file = ts.createSourceFile("plugin-api.d.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Edit[] = [];
  const removeExport = (node: ts.VariableStatement | ts.FunctionDeclaration) => {
    const exported = node.modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported) edits.push({ start: exported.getStart(file), end: exported.getEnd() + 1, text: "" });
  };
  let permission = false;
  let readerModes = false;
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) removeExport(statement);
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text === "PluginPermission" && hasExport(statement)) {
      const type = statement.type;
      edits.push({
        start: type.getStart(file),
        end: type.getEnd(),
        text: `Exclude<${type.getText(file)}, "${RESERVED_PERMISSION}">`,
      });
      permission = true;
    }
    if (statement.name.text === "PluginContributions" && ts.isTypeLiteralNode(statement.type)) {
      for (const member of statement.type.members) {
        if (member.name && ts.isIdentifier(member.name) && member.name.text === RESERVED_CONTRIBUTION) {
          edits.push({ start: member.getFullStart(), end: member.getEnd(), text: "" });
          readerModes = true;
        }
      }
    }
  }
  // The contract re-exports a few core types under their own names
  // (`type PluginPermission = CorePluginPermission`). The bundler exports the
  // core declaration and then a renamed identity alias (`PluginPermission$1`)
  // under the same name again; drop the alias and its duplicate export.
  const exported = new Set(
    file.statements
      .filter((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && hasExport(node))
      .map((node) => node.name.text),
  );
  const identityAliases = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      !hasExport(statement) &&
      ts.isTypeReferenceNode(statement.type) &&
      !statement.type.typeArguments &&
      ts.isIdentifier(statement.type.typeName) &&
      statement.name.text.startsWith(`${statement.type.typeName.text}$`) &&
      exported.has(statement.type.typeName.text)
    ) {
      identityAliases.add(statement.name.text);
      edits.push({ start: statement.getFullStart(), end: statement.getEnd(), text: "" });
    }
  }
  const aliasTargets = new Map(
    [...identityAliases].map((alias) => [alias, alias.slice(0, alias.lastIndexOf("$"))] as const),
  );
  const rename = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const target = aliasTargets.get(node.typeName.text);
      if (target) edits.push({ start: node.typeName.getStart(file), end: node.typeName.getEnd(), text: target });
    }
    ts.forEachChild(node, rename);
  };
  for (const statement of file.statements) {
    if (!(ts.isTypeAliasDeclaration(statement) && identityAliases.has(statement.name.text))) rename(statement);
  }
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      continue;
    }
    const kept = statement.exportClause.elements.filter(
      (element) => !(element.propertyName && identityAliases.has(element.propertyName.text)),
    );
    if (kept.length === statement.exportClause.elements.length) continue;
    edits.push({
      start: statement.getFullStart(),
      end: statement.getEnd(),
      text: kept.length ? `\nexport {\n${kept.map((element) => `\t${element.getText(file)},`).join("\n")}\n};` : "",
    });
  }
  if (!permission) throw new Error("public PluginPermission alias not found");
  if (!readerModes) throw new Error(`PluginContributions.${RESERVED_CONTRIBUTION} not found`);
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function hasExport(node: ts.TypeAliasDeclaration): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** The mirror must stand alone: no imports, and it type-checks by itself. */
function verifyMirror(text: string, out: string): void {
  if (/^\s*import\s/m.test(text) || /\bimport\("/.test(text)) throw new Error("mirror still imports modules");
  const path = join(out, "plugin-api.d.ts");
  writeFileSync(path, text);
  const program = ts.createProgram([path], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) fail(diagnostics, "Mirror type check");
}

/** A literal-only expression (strings, booleans, numbers, arrays, objects) as data. */
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) throw new Error(`non-literal property: ${property.getText()}`);
        return [property.name.getText().replace(/^["']|["']$/g, ""), literal(property.initializer)];
      }),
    );
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  throw new Error(`non-literal expression: ${node.getText()}`);
}

/** The initializer of a top-level `const <name> = …` in a release source file. */
function constInitializer(source: string, path: string, name: string): ts.Expression {
  const file = ts.createSourceFile(path, readFileSync(join(source, path), "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return declaration.initializer;
      }
    }
  }
  throw new Error(`${name} not found in ${path}`);
}

type Chord = { key: string; mod?: boolean; alt?: boolean; shift?: boolean };
type BuiltInShortcut = { id: string; chords: Chord[] };

function builtInShortcuts(source: string): BuiltInShortcut[] {
  const rows = literal(constInitializer(source, SHORTCUTS_PATH, "EDITABLE_SHORTCUTS")) as Array<{
    id: string;
    defaultBinding?: Chord;
    defaultAlternates?: Chord[];
  }>;
  return rows
    .filter((row) => row.defaultBinding)
    .map((row) => ({ id: row.id, chords: [row.defaultBinding!, ...(row.defaultAlternates ?? [])] }));
}

function iconNames(source: string): string[] {
  const icons = constInitializer(source, ICONS_PATH, "PLUGIN_ICONS");
  const object = ts.isAsExpression(icons) || ts.isSatisfiesExpression(icons) ? icons.expression : icons;
  if (!ts.isObjectLiteralExpression(object)) throw new Error("PLUGIN_ICONS is not an object literal");
  return object.properties.map((property) => property.name!.getText().replace(/^["']|["']$/g, "")).sort();
}

/** `permissions`: any one of them makes the capability available; empty means every plugin has it. */
type CatalogEntry = { version: string; permissions: string[] };
type ReleasedCapabilities = {
  appVersion: string;
  ref: string;
  commit: string;
  permissions: string[];
  capabilities: Record<"domains" | "contributions" | "services" | "schemas", Record<string, CatalogEntry>>;
  /** Names accepted by contribution `icon` fields; anything else renders as a puzzle piece. */
  icons: string[];
  /** Built-in default chords. A command whose chord matches another runs neither until the user rebinds one. */
  builtInShortcuts: BuiltInShortcut[];
  /** Keys a `ui:themes` theme may set: app tokens, and the reader palette (all required). */
  themeTokens: { app: string[]; readerPalette: string[] };
};

/** Property names of an exported object type in the mirror (one source of truth for validators). */
function typeKeys(mirror: string, name: string): string[] {
  const file = ts.createSourceFile("plugin-api.d.ts", mirror, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name && ts.isTypeLiteralNode(statement.type)) {
      return statement.type.members.map((member) => member.name!.getText(file));
    }
  }
  throw new Error(`type ${name} not found in the mirror`);
}

async function releasedCapabilities(source: string, commit: string, mirror: string): Promise<ReleasedCapabilities> {
  const core = await import(join(source, "packages/core/src/capabilities.ts"));
  const permissionsOf = (family: string, entry: Record<string, unknown>, id: string): string[] => {
    if (family === "domains") return ((entry.pluginAccess as string[]) ?? []).map((access) => `${id}:${access}`);
    // Mirrors resolvePluginCapabilities: the themes schema is visible only with ui:themes.
    if (family === "schemas") return id === "themes" ? ["ui:themes"] : [];
    return typeof entry.permission === "string" ? [entry.permission] : [];
  };
  const capabilities = {} as ReleasedCapabilities["capabilities"];
  for (const [family, catalog] of Object.entries(core.HOST_CAPABILITY_CATALOG as Record<string, object>)) {
    const entries: Record<string, CatalogEntry> = {};
    for (const [id, raw] of Object.entries(catalog as Record<string, Record<string, unknown>>)) {
      if (id === RESERVED_CONTRIBUTION) continue;
      entries[id] = { version: String(raw.version), permissions: permissionsOf(family, raw, id) };
    }
    capabilities[family as keyof ReleasedCapabilities["capabilities"]] = entries;
  }
  return {
    appVersion: ref.replace(/^v/, ""),
    ref,
    commit,
    permissions: (core.PLUGIN_PERMISSIONS as string[]).filter((permission) => permission !== RESERVED_PERMISSION),
    capabilities,
    icons: iconNames(source),
    builtInShortcuts: builtInShortcuts(source),
    themeTokens: {
      app: typeKeys(mirror, "PluginAppThemeTokens"),
      readerPalette: typeKeys(mirror, "PluginReaderPalette"),
    },
  };
}

function header(release: ReleasedCapabilities): string {
  return `/**
 * ReadAware plugin API — the public contract of ReadAware ${release.appVersion}.
 *
 * GENERATED from ahpxex/read-aware at ${release.ref} (${release.commit.slice(0, 12)}) by
 * scripts/sync-plugin-dts.ts. Do not edit: regenerate for each app release.
 * Capability versions for \`manifest.requires\` are in ./host-capabilities.json.
 *
 * Import with \`import type\` only — plugins run in a sandbox where none of the
 * host's modules exist at runtime.
 */

`;
}

const source = extractRelease(ref);
const work = mkdtempSync(join(tmpdir(), "readaware-plugin-contract-out-"));
try {
  const commit = git("rev-parse", "--verify", `${ref}^{commit}`);
  const contract = applyPolicy(bundle(emitDeclarations(source, work), work));
  const release = await releasedCapabilities(source, commit, contract);
  const mirror = header(release) + contract;
  verifyMirror(mirror, work);
  const catalog = `${JSON.stringify(release, null, 2)}\n`;
  const outputs: Array<[string, string]> = [
    [join(marketRoot, "types/plugin-api.d.ts"), mirror],
    [join(marketRoot, "types/host-capabilities.json"), catalog],
    [landingCatalogPath, catalog],
  ];
  if (check) {
    const stale = outputs.filter(([path, text]) => !existsSync(path) || readFileSync(path, "utf8") !== text);
    for (const [path] of stale) console.error(`stale: ${path}`);
    if (stale.length) {
      console.error(`regenerate with: bun scripts/sync-plugin-dts.ts --ref ${ref}`);
      process.exit(1);
    }
    console.log(`plugin contract for ${ref} is current`);
  } else {
    if (!existsSync(join(marketRoot, "registry.json"))) throw new Error(`not a marketplace checkout: ${marketRoot}`);
    for (const [path, text] of outputs) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      console.log(`wrote ${relative(process.cwd(), path)} (${text.split("\n").length} lines)`);
    }
    console.log(`next: cd ${marketRoot} && bun run typecheck && bun run validate`);
  }
} finally {
  rmSync(source, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
