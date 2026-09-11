import { expect, test } from "bun:test";
import { PluginCallbackBudget } from "./plugin-callback-budget";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";

test("authoritative callback capacity cannot be bypassed by new messages or reused handle names", () => {
  const budget = new PluginCallbackBudget();
  const wire = { data: null, callbacks: Array.from({ length: PLUGIN_WIRE_LIMITS.callbacksPerMessage }, (_, index) => ({ ref: {}, handle: `h${index + 1}` })) };
  const first = budget.acquire(wire), second = budget.acquire(wire);
  expect(budget.size).toBe(PLUGIN_WIRE_LIMITS.retainedCallbacks);
  expect(() => budget.acquire({ data: null, callbacks: [{ ref: {}, handle: "h1" }] })).toThrow();
  first.release(["h1", "h1", "foreign"]);
  expect(budget.size).toBe(PLUGIN_WIRE_LIMITS.retainedCallbacks - 1);
  const third = budget.acquire({ data: null, callbacks: [{ ref: {}, handle: "h1" }] });
  first.dispose(); first.dispose(); second.dispose(); third.dispose();
  expect(budget.size).toBe(0);
});

test("malformed callback aliases do not reserve capacity and late release cannot underflow a closed owner", () => {
  const budget = new PluginCallbackBudget();
  expect(() => budget.acquire({ data: null, callbacks: [{ ref: {}, handle: "h1" }, { ref: {}, handle: "h1" }] })).toThrow();
  expect(budget.size).toBe(0);
  const lease = budget.acquire({ data: null, callbacks: [{ ref: {}, handle: "h1" }] });
  budget.close(); lease.dispose();
  expect(budget.size).toBe(0);
  expect(() => budget.acquire({ data: null, callbacks: [] })).toThrow();
});
