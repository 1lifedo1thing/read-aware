/**
 * Dependency boundaries for the web app (`bun run lint:deps`).
 *
 * Target layering (docs/archive/reviews/architecture-review-2026-09.html, section 04):
 * platform (infrastructure) <- domain / services / state <- features. Existing violations
 * are recorded in .dependency-cruiser-known-violations.json; the ratchet in
 * scripts/check-dependency-baseline.ts fails on any new violation and on any recorded one
 * that no longer occurs, so the baseline only ever shrinks. After removing violations run
 * `bun run lint:deps:baseline` and commit the smaller baseline.
 *
 * Scope is production source under src/. Tests and stories may reach across layers to
 * build fixtures; the vendored foliate engine and workspace packages are governed on
 * their own and are not followed.
 */
/** Resolved npm paths, hoisted or bun-isolated (node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/). */
const npm = (name) => [`^node_modules/${name}`, `/node_modules/${name}`];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Import cycles make module initialization order-dependent (a cycle through the domain barrel already produced a TDZ error). Break the cycle by importing the defining module or moving the shared piece down a layer.",
      from: {},
      to: { circular: true },
    },
    {
      name: "lower-layers-not-to-features",
      severity: "error",
      comment:
        "domain, platform, services and state sit below features; they must not import feature code, not even types. Move the shared implementation or type down into the lower layer.",
      from: { path: "^src/(domain|platform|services|state)/" },
      to: { path: "^src/features/" },
    },
    {
      name: "platform-not-to-domain-or-services",
      severity: "error",
      comment:
        "platform is infrastructure (IPC, event store, KV, secrets, blobs, sync, OS shell) and depends only on @read-aware/core and other platform modules.",
      from: { path: "^src/platform/" },
      to: { path: "^src/(domain|services)/" },
    },
    {
      name: "features-via-public-index",
      severity: "error",
      comment:
        "A feature may use another feature only through that feature's public src/features/<name>/index.ts. Add the export there instead of reaching into its internals.",
      from: { path: "^src/features/([^/]+)/" },
      to: { path: "^src/features/[^/]+/", pathNot: ["^src/features/$1/", "^src/features/[^/]+/index\\.tsx?$"] },
    },
    {
      name: "tauri-core-only-in-ipc",
      severity: "error",
      comment:
        "platform/ipc.ts is the IPC seam: it normalizes native failures and re-exports Channel. Import invoke/Channel from there.",
      from: { pathNot: "^src/platform/ipc\\.ts$" },
      to: { path: npm("@tauri-apps/api/core\\.") },
    },
    {
      name: "no-jotai-in-domain-or-platform",
      severity: "error",
      comment:
        "Jotai is the React state adapter (src/state). Domain and platform stay framework-free and expose observable reads the state layer mirrors.",
      from: { path: "^src/(domain|platform)/" },
      to: { path: npm("jotai/") },
    },
  ],
  options: {
    exclude: { path: ["\\.(test|stories)\\.tsx?$", "(^|/)story-support/"] },
    doNotFollow: { path: ["node_modules", "^foliate-js/", "^\\.\\./"] },
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
