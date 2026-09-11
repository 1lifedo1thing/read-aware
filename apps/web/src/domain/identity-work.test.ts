import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { deferred } from "../../tests/helpers/entity-host";
import { identityHost, identityRevision } from "../../tests/helpers/identity-host";
import { durableWrites } from "../platform/write-settlement";

test("work append freezes input, joins shutdown settlement, and drains post-dispatch cancellation", async () => {
  const host = identityHost(), start = deferred(), gate = deferred(), entered = deferred(), controller = new AbortController();
  host.controls.beforeInitialize = () => start.promise;
  host.controls.beforeCommit = () => { entered.resolve(); return gate.promise; };
  const input = { expectedRevision: identityRevision, index: 0, json: '{"cursor":1}' };
  const pending = host.service.work.append(input, controller.signal);
  input.json = "{}"; start.resolve(); await entered.promise;
  expect(host.calls).toEqual([{ command: "identity_work_append", args: { expectedRevision: identityRevision, index: 0, json: '{"cursor":1}' } }]);
  let settled = false;
  const settling = durableWrites.settle().then(() => { settled = true; });
  controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
  gate.resolve(); expect(await pending).toMatchObject({ status: "appended", pageCount: 1 }); await settling;
  expect(host.minted).toHaveLength(0); expect(host.broadcasts).toHaveLength(0);
});

test("work rejects invalid and pre-dispatch input; source errors and late reads do not become empty work", async () => {
  const host = identityHost(), controller = new AbortController();
  await expect(host.service.work.append({ expectedRevision: identityRevision, index: 0, json: "null" })).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(host.initialized()).toBe(0);
  host.controls.beforeInitialize = async () => { controller.abort(); };
  await expect(host.service.work.append({ expectedRevision: identityRevision, index: 0, json: "{}" }, controller.signal)).rejects.toBeDefined();
  expect(host.calls).toHaveLength(0);
  host.controls.beforeInitialize = async () => {};
  host.controls.beforeRead = async () => { throw new AppError("memory/conflict", "Source changed"); };
  await expect(host.service.work.read({ expectedRevision: identityRevision, index: 0 })).rejects.toMatchObject({ code: "memory/conflict" });
  const cancelRead = new AbortController(); host.controls.beforeRead = async () => { cancelRead.abort(); };
  await expect(host.service.work.read({ expectedRevision: identityRevision, index: 0 }, cancelRead.signal)).rejects.toBeDefined();
  host.controls.beforeCommit = async () => { throw new AppError("db/locked", "Write failed"); };
  await expect(host.service.work.append({ expectedRevision: identityRevision, index: 0, json: "{}" })).rejects.toMatchObject({ code: "db/locked" });
});
