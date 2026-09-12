import { afterEach, expect, spyOn, test } from "bun:test";
import type { BookTextTaskSnapshot } from "@read-aware/core";
import type { PluginPermission } from "@read-aware/plugin-types";
import { BookTextTaskOwner } from "../features/library/lib/book-text-tasks";
import { createBookTextPort } from "../features/ai/agent/ports/book-text-port";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };
const task: BookTextTaskSnapshot = { bookId: "book", taskId: "task", mode: "prepare", priority: "normal", timeoutMs: 1800000, deadlineAt: "2026-09-12T12:30:00Z", waitReason: null, status: "paused", revision: 2,
  createdAt: "now", updatedAt: "now", textState: { bookId: "book", contentVersion: "v", status: "preparing", text: "unknown", chapterCount: 0, progress: null } };
function plugin(permission: PluginPermission) {
  const runtime = buildPluginContext({ id: "text-control", name: "Text", version: "1.0.0", schemaVersion: 1,
    permissions: [permission], requires: { domains: { library: "^1.22.0" } } }, "0.5.4", []);
  runtime.lifecycle.promote(); cleanups.push(() => runtime.lifecycle.stop()); return runtime;
}

test("Agent and authorized plugin task controls use the same owner seam and retirement guard", async () => {
  const priority = own(spyOn(BookTextTaskOwner.prototype, "setPriority").mockReturnValue({ ...task, priority: "background" }));
  const pause = own(spyOn(BookTextTaskOwner.prototype, "pause").mockReturnValue(task));
  const resume = own(spyOn(BookTextTaskOwner.prototype, "resume").mockReturnValue({ ...task, status: "running", revision: 3 }));
  expect(plugin("library:read").context.domains.library!.commands).toBeUndefined();
  const writer = plugin("library:write"), commands = writer.context.domains.library!.commands!.books;
  const agent = createBookTextPort().preparation!;
  expect(await agent.setPriority("book", "task", "background")).toMatchObject({ priority: "background" });
  expect(await commands.setTextTaskPriority("book", "task", "background")).toMatchObject({ priority: "background" });
  expect(priority.mock.calls).toEqual([["book", "task", "background"], ["book", "task", "background"]]);
  expect(await agent.pause("book", "task")).toEqual(task);
  expect(await commands.pauseTextTask("book", "task")).toEqual(task);
  expect(await agent.resume("book", "task")).toMatchObject({ status: "running", revision: 3 });
  expect(await commands.resumeTextTask("book", "task")).toMatchObject({ status: "running", revision: 3 });
  expect(pause.mock.calls).toEqual([["book", "task"], ["book", "task"]]);
  expect(resume.mock.calls).toEqual([["book", "task"], ["book", "task"]]);
  writer.lifecycle.stop();
  expect(() => commands.setTextTaskPriority("book", "task", "normal")).toThrow();
  expect(() => commands.resumeTextTask("book", "task")).toThrow();
  expect(resume).toHaveBeenCalledTimes(2);
});
