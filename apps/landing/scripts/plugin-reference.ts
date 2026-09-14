import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { HOST_CAPABILITY_CATALOG } from "@read-aware/core";

const root = resolve(import.meta.dir, "../../..");
const publicTypes = resolve(root, "packages/plugin-types/src/index.ts");
const output = resolve(import.meta.dir, "../src/lib/plugin-api.generated.json");

export type ApiMethod = {
  path: string;
  signatures: string[];
  source: string;
  line: number;
};
export type ApiReference = Record<string, ApiMethod[]>;

/** Derive callable entrypoints from public types; TypeScript stays out of the browser. */
export function collectPluginReference(): ApiReference {
  const configPath = resolve(root, "packages/plugin-types/tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
  );
  const program = ts.createProgram([publicTypes], parsed.options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(publicTypes)!;
  const aliases = new Map(
    source.statements
      .filter(ts.isTypeAliasDeclaration)
      .map((node) => [node.name.text, node]),
  );
  const families = {
    domains: "PluginDomains",
    contributions: "PluginContributions",
    services: "PluginHostServices",
  } as const;
  const result: ApiReference = {};

  function walk(type: ts.Type, path: string, methods: ApiMethod[], depth = 0) {
    if (depth > 6) throw new Error(`Unbounded public API: ${path}`);
    for (const property of checker.getPropertiesOfType(
      checker.getNonNullableType(type),
    )) {
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration)
        throw new Error(`Missing declaration: ${path}.${property.name}`);
      const child = checker.getNonNullableType(
        checker.getTypeOfSymbolAtLocation(property, declaration),
      );
      const calls = child.getCallSignatures();
      const methodPath = `${path}.${property.name}`;
      if (calls.length) {
        const file = declaration.getSourceFile();
        methods.push({
          path: methodPath,
          signatures: calls.map((call) =>
            checker.signatureToString(
              call,
              declaration,
              ts.TypeFormatFlags.NoTruncation,
            ),
          ),
          source: relative(root, file.fileName),
          line:
            file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
        });
      } else if (child.flags & ts.TypeFlags.Object) {
        walk(child, methodPath, methods, depth + 1);
      }
    }
  }

  for (const [family, catalog] of Object.entries(HOST_CAPABILITY_CATALOG)) {
    const alias =
      family in families
        ? aliases.get(families[family as keyof typeof families])
        : undefined;
    const type = alias && checker.getTypeAtLocation(alias);
    for (const id of Object.keys(catalog)) {
      const methods: ApiMethod[] = [];
      const property = type && checker.getPropertyOfType(type, id);
      const declaration = property?.valueDeclaration;
      if (property && declaration) {
        walk(
          checker.getTypeOfSymbolAtLocation(property, declaration),
          `ctx.${family}.${id}`,
          methods,
        );
      } else if (
        family !== "schemas" &&
        !(family === "contributions" && ["themes", "fonts"].includes(id))
      ) {
        throw new Error(`Catalog entry has no public type: ${family}:${id}`);
      }
      if (family === "services" && id === "storage") {
        walk(
          checker.getTypeAtLocation(aliases.get("PluginDocumentCollection")!),
          "ctx.services.storage.documents(collection)",
          methods,
        );
      }
      result[`${family}:${id}`] = methods.sort((a, b) =>
        a.path.localeCompare(b.path),
      );
    }
  }
  return result;
}

if (import.meta.main) {
  const reference = collectPluginReference();
  const text = JSON.stringify(reference, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== text)
      throw new Error(
        "Plugin reference is stale: run bun scripts/plugin-reference.ts",
      );
  } else writeFileSync(output, text);
  console.log(
    `${process.argv.includes("--check") ? "Verified" : "Generated"} ${Object.keys(reference).length} capability entries and ${Object.values(reference).flat().length} public API methods.`,
  );
}
