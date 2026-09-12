import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, type MemoryRecord } from "@read-aware/core";
import * as events from "../../../../platform/domain-events";
import * as ipc from "../../../../platform/ipc";
import { createMemoryPort } from "./memory-port";
const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });
function own<T extends { mockRestore(): void }>(spy: T): T { restores.push(() => spy.mockRestore()); return spy; }
const existing: MemoryRecord = { id: "existing", scope: "user", kind: "fact", content: "Fact", importance: 0.5, evidenceCount: 1, createdAt: "now", updatedAt: "now" };
function fixture() {
  own(spyOn(events, "mintEventRows").mockResolvedValue([]));
  const broadcast = own(spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {}));
  const native = own(spyOn(ipc, "invoke").mockResolvedValue({ inserted: false, memory: existing }));
  return { native, broadcast, port: createMemoryPort() };
}
test("host uses native admission and only broadcasts actual inserted events", async () => {
  const f = fixture();
  const input = { scope: "user" as const, kind: "fact" as const, content: "Fact", origin: "extraction" as const, sourceThreadKey: "global:test" };
  expect((await f.port.saveMemory(input)).id).toBe("existing");
  expect(f.native).toHaveBeenLastCalledWith("memory_create", expect.objectContaining({ automatic: true }));
  expect(f.broadcast).not.toHaveBeenCalled();
  f.native.mockResolvedValue({ inserted: true, memory: existing });
  await f.port.saveMemory({ ...input, origin: "agent" });
  expect(f.native).toHaveBeenLastCalledWith("memory_create", expect.objectContaining({ automatic: false }));
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});
test("forgotten admission is a failure, never a fabricated successful local row", async () => {
  const f = fixture(); f.native.mockRejectedValue(new AppError("memory/forgotten-suppressed", "Suppressed"));
  await expect(f.port.saveMemory({ scope: "user", kind: "fact", content: "Fact", origin: "plugin", sourceThreadKey: "global:test" })).rejects.toMatchObject({ code: "memory/forgotten-suppressed" });
  expect(f.broadcast).not.toHaveBeenCalled();
});
