import { expect, test } from "bun:test";
import type { RuntimeDeps } from "../ports";
import { buildDurableJobTools } from "./durable-job-tools";

test("saved jobs dispatch only the approved cloned plan; declined resume stays stopped", async () => {
  const plan = { title: "Prepare book", steps: [{ id: "text", kind: "library.text.prepare", bookId: "book" }] };
  const starts: unknown[] = [], controls: unknown[] = [], shown: unknown[] = [];
  let approve = false;
  const deps = { jobs: () => ({
    start: async (input: unknown) => { starts.push(input); return { id: "saved" }; },
    inspectPlan: async () => ({ title: "Stored plan", steps: [{ id: "text", kind: "library.text.prepare", bookId: "book" }] }),
    control: async (...args: unknown[]) => { controls.push(args); },
  }), interactions: { request: async (request: { action: string; subject: string }) => {
    expect(request.action).toBe("manage-job"); shown.push(JSON.parse(request.subject));
    plan.steps[0]!.bookId = "changed-after-prompt";
    return { optionId: approve ? "approve" : "decline" };
  } } } as unknown as RuntimeDeps;
  const tools = buildDurableJobTools({ kind: "book", bookId: "book" }, deps);
  const start = tools.find(tool => tool.name === "start_durable_job")!;
  await start.execute("decline", { plan });
  expect(starts).toHaveLength(0);
  plan.steps[0]!.bookId = "book"; approve = true;
  await start.execute("approve", { plan });
  expect(starts).toEqual([{ title: "Prepare book", steps: [{ id: "text", kind: "library.text.prepare", bookId: "book", options: { rebuild: false, priority: "normal", timeoutMs: 1800000 } }] }]);
  approve = false;
  await tools.find(tool => tool.name === "control_durable_job")!.execute("resume", { id: "saved", action: "resume" });
  expect(controls).toHaveLength(0);
  expect(shown.at(-1)).toMatchObject({ action: "resume", id: "saved", plan: { title: "Stored plan" } });
});
