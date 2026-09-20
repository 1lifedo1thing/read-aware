import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools, buildModelTools, createAgentTurnState } from "./registry";
import type { Id } from "@read-aware/core";

for (const scope of [{ kind: "global", threadId: "tools" }, { kind: "book", bookId: "b" as Id }] as const) {
  test(`${scope.kind}: compact model surface preserves the complete discoverable catalog`, async () => {
    const { deps } = createInMemoryDeps();
    const state = createAgentTurnState();
    const initial = buildModelTools(scope, deps, state);
    expect(initial.length).toBeLessThanOrEqual(23);
    expect(JSON.stringify(initial.map(({ name, description, parameters }) => ({ name, description, parameters }))).length).toBeLessThan(32_000);
    expect(initial.some(t => t.name === "request_backup")).toBe(false);
    const discover = initial.find(t => t.name === "get_host_capabilities")!;
    const catalog = buildAgentTools(scope, deps, state).map(t => t.name).sort();
    const found: string[] = [];
    let offset = 0, revision: string | undefined;
    do {
      const result = await discover.execute("discover", { catalog: "tools", limit: 20, offset, revision });
      const page = JSON.parse((result.content[0] as { text: string }).text);
      found.push(...page.items.map((t: { name: string }) => t.name));
      expect(buildModelTools(scope, deps, state).length).toBeLessThanOrEqual(35);
      offset = page.nextOffset; revision = page.revision;
    } while (offset !== null);
    expect(found.sort()).toEqual(catalog);
    await discover.execute("load", { catalog: "tools", query: "request_backup" });
    expect(buildModelTools(scope, deps, state).some(t => t.name === "request_backup")).toBe(true);
    expect(buildModelTools(scope, deps, createAgentTurnState()).some(t => t.name === "request_backup")).toBe(false);
  });
}
