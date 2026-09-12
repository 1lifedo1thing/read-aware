import { expect, test } from "bun:test";
import { createFullBackupImport, type BackupPlanReceipt, type BackupSourceReceipt } from "./full-backup-import-task";

const source: BackupSourceReceipt = { taskId: "task", format: 2, schemaVersion: 42, tables: { books: 1 }, events: 1, blobs: 1, credentials: 0, pluginPrograms: 0 };
const plan: BackupPlanReceipt = { taskId: "task", newEvents: 1, existingEvents: 0, conflictingEvents: 0, tables: {},
  files: { sourceOnly: 1, targetOnly: 0, same: 0, different: 0, unavailable: 0 }, pluginPrograms: 0 };
function fixture() {
  const calls: string[] = [];
  const deps = {
    id: () => "task",
    selectSource: async (): Promise<string | null> => { calls.push("pick"); return "/source.age"; },
    open: async (_id: string, path: string, password: string): Promise<BackupSourceReceipt> => {
      expect([path, password]).toEqual(["/source.age", "a test password"]); calls.push("open"); return source;
    },
    plan: async (): Promise<BackupPlanReceipt> => { calls.push("plan"); return plan; },
    cancel: async () => { calls.push("cancel"); },
    warn: (_message: string, _error: unknown) => { calls.push("warn"); },
  };
  return { deps, calls, run: createFullBackupImport(deps) };
}
test("import preparation retains only a count review and native lifetime, then disposes once", async () => {
  const { run, calls } = fixture();
  const review = (await run("a test password"))!;
  expect(calls).toEqual(["pick", "open", "plan"]);
  expect(Object.keys(review.source)).not.toContain("taskId"); expect(Object.keys(review.plan)).not.toContain("taskId");
  expect(JSON.stringify(review)).not.toContain("/source.age"); expect(JSON.stringify(review)).not.toContain("password");
  expect(review.disposed).toBe(false); await Promise.all([review.dispose(), review.dispose()]);
  expect(review.disposed).toBe(true); expect(calls.at(-1)).toBe("cancel"); expect(calls.filter(value => value === "cancel")).toHaveLength(1);
});
test("abort waits for physical decryption before retrying cancellation, never plans its source", async () => {
  const { deps, run, calls } = fixture(); const controller = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<BackupSourceReceipt>();
  deps.open = async () => { entered.resolve(); return release.promise; };
  let done = false; const pending = run("a test password", controller.signal).catch(error => { done = true; return error; });
  await entered.promise; controller.abort(); await Bun.sleep(0); expect(done).toBe(false);
  release.resolve(source); expect((await pending).name).toBe("AbortError");
  expect(calls).not.toContain("plan"); expect(calls.filter(value => value === "cancel")).toHaveLength(2);
});
test("abort during plan retains physical completion; abort during review disposes the retained native task", async () => {
  const { deps, run, calls } = fixture(); const controller = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<BackupPlanReceipt>();
  deps.plan = async () => { entered.resolve(); return release.promise; };
  let done = false; const pending = run("a test password", controller.signal).catch(error => { done = true; return error; });
  await entered.promise; controller.abort(); await Bun.sleep(0); expect(done).toBe(false);
  release.resolve(plan); expect((await pending).name).toBe("AbortError");
  expect(calls.filter(value => value === "cancel")).toHaveLength(2);
  const next = fixture(), owner = new AbortController();
  const review = (await next.run("a test password", owner.signal))!; owner.abort(); await review.dispose();
  expect(review.disposed).toBe(true); expect(next.calls.at(-1)).toBe("cancel");
});
test("cancelled file choice does not reserve; mismatched receipts and plan failures release preparation", async () => {
  const { deps, run, calls } = fixture();
  await expect(run("short")).rejects.toMatchObject({ code: "backup/password-policy" }); expect(calls).toEqual([]);
  deps.selectSource = async () => null; expect(await run("a test password")).toBeNull(); expect(calls).toEqual([]);
  deps.selectSource = async () => "/source.age";
  deps.open = async () => ({ ...source, taskId: "foreign" });
  await expect(run("a test password")).rejects.toMatchObject({ code: "backup/changed" }); expect(calls).toEqual(["cancel"]);
  deps.open = async () => source; deps.plan = async () => { throw new Error("plan failed"); };
  await expect(run("a test password")).rejects.toThrow("plan failed"); expect(calls).toEqual(["cancel", "cancel"]);
});
