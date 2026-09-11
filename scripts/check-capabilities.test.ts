import { expect, test } from "bun:test";
import { capabilityChecks } from "./check-capabilities";

test("capability gate is repeatable, read-only for evidence and keeps stateful suites isolated", () => {
  expect(new Set(capabilityChecks.map(check => check.name)).size).toBe(capabilityChecks.length);
  for (const script of ["scripts/build-host-capability-matrix.ts", "scripts/build-host-capability-model.ts"]) {
    expect(capabilityChecks.find(check => check.args[0] === script)?.args).toEqual([script, "--check"]);
  }
  for (const path of ["scripts", "packages/core/src", "packages/agent/src", "apps/web/src/domain", "apps/web/src/features/plugins/runtime"]) {
    expect(capabilityChecks.some(check => check.args[0] === "test" && check.args.length === 2 && check.args[1] === path)).toBe(true);
  }
  const worker = capabilityChecks.find(check => check.name === "Worker boundary and actual Worker transport");
  expect(worker?.args).toContain("apps/web/src/features/plugins/runtime/plugin-sandbox.integration.test.ts");
  const manifest = Bun.file(new URL("../package.json", import.meta.url));
  return manifest.json().then(value => expect(value.scripts["check:capabilities"]).toBe("bun scripts/check-capabilities.ts"));
});

test("CI runs the gate on pushes and pull requests without write authority or ignored failures", async () => {
  const workflow = Bun.YAML.parse(await Bun.file(new URL("../.github/workflows/capabilities.yml", import.meta.url)).text()) as {
    on: Record<string, unknown>; permissions: Record<string, string>;
    jobs: Record<string, { strategy?: { matrix: { os: string[] } }; steps: { run?: string; "continue-on-error"?: boolean }[] }>;
  };
  expect(Object.keys(workflow.on)).toEqual(["push", "pull_request", "workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs["source-and-contracts"]!.steps.some(step => step.run === "bun run check:capabilities")).toBe(true);
  expect(workflow.jobs["native-contracts"]!.strategy?.matrix.os).toEqual(["macos-latest", "ubuntu-24.04", "windows-latest"]);
  expect(workflow.jobs["native-contracts"]!.steps.some(step => step.run === "cargo test --locked --lib")).toBe(true);
  expect(Object.values(workflow.jobs).flatMap(job => job.steps).every(step => !step["continue-on-error"])).toBe(true);
});
