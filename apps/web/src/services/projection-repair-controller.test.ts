import { expect, test } from "bun:test";
import { AppError, type ProjectionVerification } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";
import { ProjectionRepairController } from "./projection-repair-controller";

const report: ProjectionVerification = { scope: "event-projections", checkedAt: "2026-09-12", consistent: false,
  eventsReplayed: 4, driftedTables: 1, onlyLiveRows: 1, onlyReplayedRows: 2 };
const tick = () => Bun.sleep(0);
function setup(verify = async () => report) {
  let calls = 0;
  const native = Promise.withResolvers<void>();
  const flow = new HostActionFlow<{ action: "repair" }, "rebuilt-reload-required">({
    navigate: async () => {}, normalize: request => request, completion: () => "rebuilt-reload-required",
  });
  const controller = new ProjectionRepairController(flow, verify, async () => { calls++; await native.promise; }, () => {});
  const off = flow.bind(controller);
  return { flow, controller, off, native, calls: () => calls };
}

test("request previews differences; only native confirmation starts repair; durable result survives unmount", async () => {
  const f = setup();
  const request = f.flow.request({ action: "repair" }); await tick();
  expect(f.controller.snapshot()).toEqual({ step: "preview", report }); expect(f.calls()).toBe(0);
  const run = f.controller.confirm();
  expect(f.calls()).toBe(1); expect(f.controller.snapshot()?.step).toBe("working");
  f.off(); f.controller.close(); // Settings navigation must not abandon confirmed work.
  expect(f.controller.snapshot()?.step).toBe("working");
  f.native.resolve(); await run;
  expect(await request).toEqual({ action: "repair", status: "rebuilt-reload-required" });
  expect(f.controller.snapshot()?.step).toBe("done");
  f.controller.close(); expect(f.controller.snapshot()?.step).toBe("done");
  expect(() => f.controller.open({ action: "repair" })).toThrow();
});

test("cancelled preparation cannot produce late preview or repair", async () => {
  const pending = Promise.withResolvers<ProjectionVerification>();
  const f = setup(() => pending.promise), caller = new AbortController();
  const request = f.flow.request({ action: "repair" }, caller.signal).catch(error => error); await tick();
  caller.abort(Error("cancel")); await request;
  pending.resolve(report); await tick(); await f.controller.confirm();
  expect(f.controller.snapshot()).toBeNull(); expect(f.calls()).toBe(0); f.off();
});

test("cancel after confirmation stops the wait but preserves the host reload result", async () => {
  const f = setup(), caller = new AbortController();
  const request = f.flow.request({ action: "repair" }, caller.signal).catch(error => error); await tick();
  const run = f.controller.confirm(); caller.abort(Error("stopped waiting"));
  f.native.resolve(); await run;
  expect((await request).message).toBe("stopped waiting");
  expect(f.controller.snapshot()?.step).toBe("done"); f.off();
});

test("incomplete log refuses preparation; native rollback failure never yields a committed receipt", async () => {
  const error = new AppError("sync/log-incomplete", "raw detail");
  const incomplete = setup(async () => { throw error; });
  const rejected = incomplete.flow.request({ action: "repair" }).catch(value => value); await tick();
  expect(await rejected).toBe(error); expect(incomplete.calls()).toBe(0);
  expect(incomplete.controller.snapshot()?.step).toBe("failed"); incomplete.off();
  const f = setup();
  const request = f.flow.request({ action: "repair" }).catch(value => value); await tick();
  const run = f.controller.confirm(); f.native.reject(error); await run;
  expect(await request).toBe(error); expect(f.controller.snapshot()?.step).toBe("failed");
  f.controller.close(); expect(f.controller.snapshot()).toBeNull(); f.off();
});

test("healthy projections cannot trigger an unnecessary rebuild", async () => {
  const f = setup(async () => ({ ...report, consistent: true, driftedTables: 0, onlyLiveRows: 0, onlyReplayedRows: 0 }));
  const request = f.flow.request({ action: "repair" }); await tick();
  await f.controller.confirm(); expect(f.calls()).toBe(0);
  f.controller.close(); expect((await request).status).toBe("cancelled"); f.off();
});
