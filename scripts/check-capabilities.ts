import { resolve } from "node:path";

/** Separate processes keep module mocks and browser globals out of sibling suites. */
export const capabilityChecks = [
  { name: "Prepare generated Foliate runtime", args: ["run", "--filter", "@read-aware/web", "build:foliate"] },
  { name: "Matrix source and generated evidence", args: ["scripts/build-host-capability-matrix.ts", "--check"] },
  { name: "Ownership model and generated evidence", args: ["scripts/build-host-capability-model.ts", "--check"] },
  { name: "Inventory omission and ownership guards", args: ["test", "scripts"] },
  { name: "Core contracts", args: ["test", "packages/core/src"] },
  { name: "Agent contracts", args: ["test", "packages/agent/src"] },
  { name: "Host domains", args: ["test", "apps/web/src/domain"] },
  { name: "Network transfer and approved download contracts", args: ["test", "apps/web/src/services/network-transfer-budget.test.ts",
    "apps/web/src/services/network-retry.test.ts", "apps/web/src/services/resource-download.test.ts"] },
  { name: "Plugin runtime contracts", args: ["test", "apps/web/src/features/plugins/runtime"] },
  { name: "Worker boundary and actual Worker transport", args: ["test",
    "apps/web/src/features/plugins/runtime/plugin-worker-host.test.ts",
    "apps/web/src/features/plugins/runtime/plugin-sandbox.integration.test.ts"] },
  { name: "Native migration bridge and KV ordering", args: ["test", "apps/web/tests/plugin-data-snapshot.test.ts", "apps/web/src/platform/kv-write-queue.test.ts"] },
  { name: "Actor and desktop type contracts", args: ["run", "typecheck", "--filter=@read-aware/core", "--filter=@read-aware/agent",
    "--filter=@read-aware/plugin-types", "--filter=@read-aware/web", "--filter=@read-aware/desktop"] },
] as const;

if (import.meta.main) {
  for (const check of capabilityChecks) {
    console.log(`\n[capabilities] ${check.name}`);
    const child = Bun.spawn([process.execPath, ...check.args], {
      cwd: resolve(import.meta.dir, ".."), stdin: "ignore", stdout: "inherit", stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) {
      console.error(`[capabilities] Failed: ${check.name} (exit ${code})`);
      process.exit(code || 1);
    }
  }
  console.log("\n[capabilities] Source and contract checks passed. Desktop product acceptance is separate.");
}
