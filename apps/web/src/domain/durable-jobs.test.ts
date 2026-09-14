import { expect, test } from "bun:test";
import { DurableJobRunner, type DurableJobExecutor } from "./durable-jobs";
import type { DurableJobRecord, DurableJobStore } from "../platform/durable-jobs";

test("cancel survives an interrupted dispatch and reconciliation never starts the next step", async () => {
  let row: DurableJobRecord;
  let revision = 0;
  let completed!: () => void;
  const completion = new Promise<void>(resolve => { completed = resolve; });
  const store: DurableJobStore = {
    async create(id, plan) { row = { owner: "owner", id, plan, state: { status: "queued", nextStep: 0, attempt: null, results: [], errorCode: null }, revision: String(++revision), createdAt: "now", updatedAt: "now" }; return structuredClone(row); },
    async get() { return structuredClone(row); },
    async list() { return row ? [structuredClone(row)] : []; },
    async checkpoint(before, state) { expect(before.revision).toBe(row.revision); row = { ...row, state: structuredClone(state), revision: String(++revision) }; if (state.status === "cancelled") completed(); return structuredClone(row); },
  };
  let dispatched!: () => void;
  const dispatch = new Promise<void>(resolve => { dispatched = resolve; });
  let aborted!: () => void;
  const abort = new Promise<void>(resolve => { aborted = resolve; });
  let release!: () => void;
  const settlement = new Promise<void>(resolve => { release = resolve; });
  let executions = 0;
  const executor: DurableJobExecutor = {
    async authorize() { return { assert() {}, dispose() {} }; },
    async prepare() { return {}; },
    async execute(_step, _attempt, signal) {
      executions++; dispatched();
      signal.addEventListener("abort", aborted, { once: true });
      await settlement;
      throw new Error("receipt lost");
    },
    async reconcile() { return { status: "complete", receipt: { persisted: true } }; },
    report(error) { throw error; },
  };
  const runner = new DurableJobRunner(store, executor);
  const job = await runner.start({ title: "Prepare books", steps: ["a", "b"].map(id => ({ id, kind: "library.text.prepare", bookId: id })) });
  await dispatch;
  const cancelling = runner.control(job.id, "cancel");
  await abort;
  expect((await store.get(job.id)).state.requestedAction).toBe("cancel");
  release();
  expect((await cancelling).status).toBe("needs-attention");
  await runner.stop();
  const restarted = new DurableJobRunner(store, executor);
  await restarted.control(job.id, "resume");
  await completion;
  await restarted.stop();
  expect((await store.get(job.id)).state.nextStep).toBe(1);
  expect((await store.get(job.id)).state.status).toBe("cancelled");
  expect(executions).toBe(1);
  expect((await store.get(job.id)).state.requestedAction).toBe("cancel");
});
