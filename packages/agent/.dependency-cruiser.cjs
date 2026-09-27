/**
 * Dependency boundaries for the agent package (`bun run lint:deps`).
 *
 * Existing cycles (ports.ts <-> runtime/*, memory/build-policy.ts <-> ports.ts) are
 * recorded in .dependency-cruiser-known-violations.json. The ratchet in
 * scripts/check-dependency-baseline.ts fails on any new cycle and on any recorded one that
 * no longer occurs; after breaking a cycle run `bun run lint:deps:baseline` and commit the
 * smaller baseline. Tests are excluded; workspace packages are not followed.
 */
/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Import cycles make module initialization order-dependent. Port contracts belong below the runtime: move the shared type into ports (or a leaf module) instead of importing the runtime back.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    exclude: { path: ["\\.test\\.tsx?$"] },
    doNotFollow: { path: ["node_modules", "^\\.\\./"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    cache: false,
  },
};
