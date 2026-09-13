import { expect, spyOn, test } from "bun:test";
import * as environment from "../../../platform/environment";
import * as events from "../../../platform/domain-events";
import * as ipc from "../../../platform/ipc";
import { clearConversation } from "./conversation-store";
import { deferred } from "../../../../tests/helpers/entity-host";

test("conversation clear checks cancellation after envelope preparation, before native dispatch", async () => {
  const entered = deferred(), gate = deferred(), controller = new AbortController();
  const native = spyOn(environment, "isTauri").mockReturnValue(true), calls: string[] = [];
  const mint = spyOn(events, "mintEventRows").mockImplementation(async drafts => {
    expect(drafts).toEqual([{ type: "aiConversation.cleared", payload: { conversationId: "a" }, origin: "plugin:clear-proof" }]);
    entered.resolve(); await gate.promise; return [];
  });
  const invoke = spyOn(ipc, "invoke").mockImplementation(async command => { calls.push(command); return undefined as never; });
  try {
    const pending = clearConversation("a", "plugin:clear-proof", controller.signal); await entered.promise;
    controller.abort(new Error("book grant changed")); gate.resolve();
    await expect(pending).rejects.toThrow("book grant changed"); expect(calls).toEqual([]);
  } finally { gate.resolve(); invoke.mockRestore(); mint.mockRestore(); native.mockRestore(); }
});

test("a dispatched clear retains its receipt and uses one event transaction, without a second projection clear", async () => {
  const entered = deferred(), gate = deferred(), controller = new AbortController(), calls: string[] = [], observed: unknown[] = [];
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const mint = spyOn(events, "mintEventRows").mockResolvedValue([]);
  const invoke = spyOn(ipc, "invoke").mockImplementation(async command => { calls.push(command); entered.resolve(); await gate.promise; return undefined as never; });
  const off = events.onDomainEventBroadcast(event => { if (event.type === "aiConversation.cleared") observed.push(event.payload); });
  try {
    const pending = clearConversation("a", "plugin:clear-proof", controller.signal); await entered.promise;
    controller.abort(new Error("after dispatch")); gate.resolve(); await pending;
    expect(calls).toEqual(["commit_events"]); expect(observed).toEqual([{ conversationId: "a" }]);
  } finally { gate.resolve(); off(); invoke.mockRestore(); mint.mockRestore(); native.mockRestore(); }
});
