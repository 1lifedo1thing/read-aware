import { expect, test } from "bun:test";
import { createFullBackupImport, type BackupPlanReceipt, type BackupSourceReceipt } from "./full-backup-import-task";
import type { BackupReviewPage, BackupReviewQuery } from "./backup-review-types";

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
    read: async (_id: string, query: BackupReviewQuery): Promise<BackupReviewPage> => { calls.push("read");
      if (query.kind === "rowIssues") return { kind: "rowIssues", revision: query.expectedRevision, entries: [], nextAfter: null };
      if (query.kind === "rowDecisions") return { kind: "rowDecisions", revision: "revision", unresolved: 0, source: 0, target: 0 };
      if (query.kind === "rows") return { kind: "rows", decisionRevision: "revision", entries: [], nextAfter: null };
      if (query.kind === "rowField") return { ...query, value: null };
      if (query.kind === "rowFields") return { ...query, policy: "domain-state", restricted: false, entries: [], nextAfter: null };
      return { kind: query.kind, entries: [], nextAfter: null }; },
    checkRows: async (_id: string, expectedRevision: string) => ({ revision: expectedRevision, selectedSourceRows: 0, issues: 0, constraintsPassed: true }),
    chooseRows: async (_id: string, request: import("./backup-review-types").BackupRowChoiceRequest) => ({ revision: "updated", changed: request.edits.length }),
    stageProgram: async () => ({ token: "stage", storage: {} }),
    stageStorage: async <T>() => null as T,
    apply: async () => ({ taskId: "task", format: 2 as const, restoreId: "restore", domainRows: 1, files: 0, plugins: 0, credentials: 0, cleanupPending: false }),
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

test("review reads serialize snapshots of page requests; an individual cancellation preserves the plan", async () => {
  const { deps, run, calls } = fixture();
  const first = Promise.withResolvers<BackupReviewPage>(), entered = Promise.withResolvers<void>();
  const seen: BackupReviewQuery[] = [];
  deps.read = async (_id, query) => { seen.push(query); if (seen.length === 1) { entered.resolve(); return first.promise; } return { kind: "rows", decisionRevision: "revision", entries: [], nextAfter: null }; };
  const review = (await run("a test password"))!;
  const owner = new AbortController();
  const one = review.read({ kind: "events", limit: 1 }, owner.signal).catch(error => error);
  await entered.promise;
  const candidate: BackupReviewQuery = { kind: "rows", table: "books", limit: 1 };
  const two = review.read(candidate); candidate.table = "memories";
  owner.abort(); await Bun.sleep(0); expect(seen).toHaveLength(1);
  first.resolve({ kind: "events", entries: [], nextAfter: null });
  expect((await one).name).toBe("AbortError"); expect((await two).kind).toBe("rows");
  expect(seen[1]).toMatchObject({ table: "books" }); expect(calls).not.toContain("cancel");
  deps.read = async () => { throw new Error("bad page"); };
  await expect(review.read({ kind: "rows", table: "missing", limit: 1 })).rejects.toThrow("bad page");
  deps.read = async () => ({ kind: "programs", entries: [], nextAfter: null });
  expect((await review.read({ kind: "programs", limit: 1 })).kind).toBe("programs");
  await review.dispose();
});

test("review disposal waits for the native read, discards queued reads, and bounds admission", async () => {
  const { deps, run, calls } = fixture(); const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<BackupReviewPage>();
  let physicalReads = 0;
  deps.read = async () => { physicalReads++; entered.resolve(); return release.promise; };
  const review = (await run("a test password"))!;
  const pending = Array.from({ length: 32 }, () => review.read({ kind: "files", limit: 1 }).catch(error => error));
  await entered.promise;
  await expect(review.read({ kind: "files", limit: 1 })).rejects.toMatchObject({ code: "backup/busy" });
  let disposed = false; const closing = review.dispose().then(() => { disposed = true; });
  await Bun.sleep(0); expect(disposed).toBe(false); expect(calls).toContain("cancel");
  release.resolve({ kind: "files", entries: [], nextAfter: null }); await closing;
  expect(physicalReads).toBe(1); expect((await Promise.all(pending)).every(result => result.code === "backup/changed")).toBe(true);
  await expect(review.read({ kind: "files", limit: 1 })).rejects.toMatchObject({ code: "backup/changed" });
});

test("record fields and continuation reads use the same owned serial review without losing typed values", async () => {
  const { deps, run, calls } = fixture();
  const seen: BackupReviewQuery[] = [];
  deps.read = async (_id, query) => {
    seen.push(query);
    if (query.kind === "rowFields") return { ...query, policy: "domain-state", restricted: false, entries: [{ name: "id", primary: 1,
      source: { type: "integer", decimal: "9223372036854775807" }, target: { type: "null" } }], nextAfter: 0 };
    if (query.kind === "rowField") return { ...query, value: { type: "text", base64: "5rGJ", text: "汉", byteLength: 4098, offset: 4095, nextOffset: null } };
    throw new Error("Unexpected request");
  };
  const review = (await run("a test password"))!;
  const page = await review.read({ kind: "rowFields", table: "memories", entryId: 1, limit: 1 });
  expect(page).toMatchObject({ entries: [{ source: { decimal: "9223372036854775807" }, target: { type: "null" } }] });
  const query: BackupReviewQuery = { kind: "rowField", table: "memories", entryId: 1, column: "content", side: "source", offset: 4095 };
  const next = review.read(query); query.offset = 0;
  expect(await next).toMatchObject({ value: { text: "汉", offset: 4095, nextOffset: null } });
  expect(seen[1]).toMatchObject({ offset: 4095 });
  expect(calls).not.toContain("cancel");
  await review.dispose();
});

test("row choices snapshot submissions and share the read queue and physical disposal", async () => {
  const { deps, run } = fixture();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<{ revision: string; changed: number }>();
  const seen: import("./backup-review-types").BackupRowChoiceRequest[] = [];
  let reads = 0;
  deps.chooseRows = async (_id, request) => { seen.push(request); entered.resolve(); return release.promise; };
  deps.read = async () => { reads++; return { kind: "rowDecisions", revision: "new", unresolved: 0, source: 1, target: 0 }; };
  const review = (await run("a test password"))!;
  const request: import("./backup-review-types").BackupRowChoiceRequest = { expectedRevision: "old", edits: [{ table: "memories", entryId: 1, choice: "source" }] };
  const saving = review.chooseRows(request); request.edits[0]!.choice = "target";
  await entered.promise;
  const read = review.read({ kind: "rowDecisions" });
  await Bun.sleep(0); expect(reads).toBe(0); expect(seen[0]!.edits[0]!.choice).toBe("source");
  release.resolve({ revision: "new", changed: 1 }); expect(await saving).toEqual({ revision: "new", changed: 1 });
  expect(await read).toMatchObject({ revision: "new" });
  deps.chooseRows = async () => { throw Object.assign(new Error("stale"), { code: "backup/changed" }); };
  await expect(review.chooseRows(request)).rejects.toMatchObject({ code: "backup/changed" });
  expect((await review.read({ kind: "rowDecisions" })).kind).toBe("rowDecisions");
  const active = Promise.withResolvers<void>(), receipt = Promise.withResolvers<{ revision: string; changed: number }>();
  deps.chooseRows = async () => { active.resolve(); return receipt.promise; };
  const pending = review.chooseRows(request).catch(error => error); await active.promise;
  let done = false; const closing = review.dispose().then(() => { done = true; });
  await Bun.sleep(0); expect(done).toBe(false);
  receipt.resolve({ revision: "newer", changed: 1 }); await closing;
  expect((await pending).code).toBe("backup/changed");
  await expect(review.chooseRows(request)).rejects.toMatchObject({ code: "backup/changed" });
});

test("row constraint checks keep their submitted revision and share physical review ownership", async () => {
  const { deps, run } = fixture();
  const entered=Promise.withResolvers<void>(), release=Promise.withResolvers<{revision:string;selectedSourceRows:number;issues:number;constraintsPassed:boolean}>();
  const seen:string[]=[];
  deps.checkRows=async (_id, revision) => { seen.push(revision); entered.resolve(); return release.promise; };
  let readCount=0;
  deps.read=async queryId => { expect(queryId).toBe("task"); readCount++; return {kind:"rowIssues",revision:"fixed",entries:[],nextAfter:null}; };
  const review=(await run("a test password"))!;
  const checking=review.checkRows("fixed"); await entered.promise;
  const reading=review.read({kind:"rowIssues",expectedRevision:"fixed",limit:100});
  await Bun.sleep(0); expect(readCount).toBe(0); expect(seen).toEqual(["fixed"]);
  release.resolve({revision:"fixed",selectedSourceRows:2,issues:0,constraintsPassed:true});
  expect(await checking).toMatchObject({constraintsPassed:true}); await reading;
  deps.checkRows=async () => { throw Object.assign(new Error("stale"),{code:"backup/changed"}); };
  await expect(review.checkRows("old")).rejects.toMatchObject({code:"backup/changed"});
  await review.read({kind:"rowIssues",expectedRevision:"fixed",limit:100});
  const active=Promise.withResolvers<void>(), finish=Promise.withResolvers<{revision:string;selectedSourceRows:number;issues:number;constraintsPassed:boolean}>();
  deps.checkRows=async () => {active.resolve();return finish.promise;};
  const pending=review.checkRows("fixed").catch(error=>error); await active.promise;
  let closed=false;const closing=review.dispose().then(()=>{closed=true;});
  await Bun.sleep(0);expect(closed).toBe(false);
  finish.resolve({revision:"fixed",selectedSourceRows:2,issues:1,constraintsPassed:false});
  await closing;expect((await pending).code).toBe("backup/changed");
});

test("restore consumes review once and retains the committed receipt through late cancellation", async () => {
  const { deps, run } = fixture();
  const entered = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<Awaited<ReturnType<typeof deps.apply>>>();
  deps.apply = async () => { entered.resolve(); return decision.promise; };
  const review = (await run("a test password"))!;
  const request = { rowRevision: "fixed", files: {}, programs: {}, programResults: {}, credentials: {} };
  const applied = review.apply(request);
  await entered.promise;
  await expect(review.apply(request)).rejects.toMatchObject({ code: "backup/changed" });
  await expect(review.read({ kind: "rowDecisions" })).rejects.toMatchObject({ code: "backup/changed" });
  let closed = false;
  const disposing = review.dispose().then(() => { closed = true; });
  await Bun.sleep(0); expect(closed).toBe(false);
  decision.resolve({ taskId: "task", format: 2, restoreId: "restore", domainRows: 3, files: 1, plugins: 0, credentials: 0, cleanupPending: false });
  expect(await applied).toMatchObject({ format: 2, domainRows: 3 });
  expect(JSON.stringify(await applied)).not.toContain("taskId");
  await disposing; expect(closed).toBe(true);
});
