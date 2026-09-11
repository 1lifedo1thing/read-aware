import { expect, test } from "bun:test";
import { NetworkTransferBudget } from "./network-transfer-budget";

const limits = { windowMs: 1000, maxOwnerRequests: 2, maxHostRequests: 3, maxOwnerBytes: 10, maxHostBytes: 15, maxOwners: 2 };
test("request and upload admission share owner/global windows across activations without charging rejected dispatch", () => {
  let now = 10;
  const budget = new NetworkTransferBudget(limits, () => now);
  budget.charge("plugin:a", 1, 4); budget.charge("plugin:a", 1, 4);
  expect(() => budget.charge("plugin:a", 1, 0)).toThrow();
  budget.charge("agent", 1, 7);
  expect(() => budget.charge("agent", 1, 0)).toThrow();
  expect(() => budget.charge("plugin:a", 0, 1)).toThrow();
  now = 1009; expect(() => budget.charge("plugin:a", 1, 0)).toThrow();
  now = 1010; budget.charge("plugin:a", 1, 10);
  now = 500; expect(() => budget.charge("plugin:a", 0, 1)).toThrow();
});
test("overflowing received chunks retain debt and owner bookkeeping is bounded until expiry", () => {
  let now = 0;
  const budget = new NetworkTransferBudget(limits, () => now);
  expect(() => budget.charge("plugin:a", 0, 11, true)).toThrow();
  expect(() => budget.charge("plugin:a", 1, 0)).toThrow();
  budget.charge("agent", 0, 4, true);
  expect(() => budget.charge("new", 0, 0)).toThrow();
  expect(() => budget.charge("agent", 0, 1, true)).toThrow();
  expect(() => budget.charge("agent", 1, 0)).toThrow();
  now = 1000; budget.charge("new", 1, 1);
  expect(() => budget.charge("invalid", -1, 0)).toThrow();
});
