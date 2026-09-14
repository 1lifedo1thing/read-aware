import { actorCause, causalActor, eventCause, stampEventCause } from "../platform/domain-actor";
import { expect, test } from "bun:test";
import type { AccountResponse, HostSyncSnapshot, OperationCondition } from "@read-aware/core";
import type { SyncStatusSnapshot } from "../platform/sync/sync-scheduler";
import { HostSyncService } from "./sync-controller";

function fixture() {
  let epoch = "1", busy = false, notify: (source: object) => void = () => {}, runs = 0;
  const status: SyncStatusSnapshot = { state: "idle", accountConnected: true, backend: "relay", transportRef: "private-endpoint",
    lastSyncAt: 10, lastErrorCode: null, cycleTotals: { events: 2, blobs: 3 }, lastCycle: null, backfillRemaining: 4,
    progress: { phase: "blobs", pulled: 1, pushed: 2, verified: 3, backfilled: 4, backfillFrontier: 999, backfillCursor: 888,
      blobsDone: 1, blobsTotal: 2, blobKey: "private-book-id", blobDirection: "up", blobPartsDone: 1, blobPartsTotal: 2 } };
  const account: AccountResponse = { accountId: "private-account", email: "private-email", keys: null, tier: "sync", tierExpiresAtMs: null,
    hasBilling: true, blobBytesUsed: 42, eventsUsed: 4, aiCreditsUsed: 0.5,
    limits: { maxBlobBytes: 10, maxAccountBlobBytes: null, maxAccountEvents: 100, aiMonthlyCredits: 5 } };
  const adapter = { supported: () => true, busy: () => busy, epoch: () => epoch, status: () => status,
    subscribe: (handler: (source: object) => void) => { notify = handler; return () => { notify = () => {}; }; },
    backlog: async () => ({ events: 10, blobs: 20 }), account: async () => account,
    run: async (): Promise<object | null> => { runs++; return {}; },
    conditions: async (): Promise<OperationCondition[]> => [{ kind: "provider", state: "unknown", reason: "remote-health-not-checked" }],
    openSettings: async () => ({ snapshot: { selection: { bookIds: ["private-selected-book"] } } }),
    connectionOptions: async () => [{ ref: "test:transport", label: "Test backend" }],
    requestFlow: async (request: import("@read-aware/core").HostSyncFlowRequest) => ({ action: request.action, status: "cancelled" as const }),
  };
  const service = new HostSyncService(adapter, () => {});
  return { service, adapter, status, account, runs: () => runs, change: () => { epoch = "2"; notify(stampEventCause({})); },
    busy: () => { busy = true; notify(stampEventCause({})); }, notify: (source = stampEventCause({})) => notify(source) };
}
test("sync projection contains counters but no account, file, cursor, key or workspace identifiers", async () => {
  const f = fixture();
  try {
    const snapshot = await f.service.snapshot();
    const result = JSON.stringify([snapshot, await f.service.account(), await f.service.openSettings()]);
    expect(result).not.toContain("private"); expect(result).not.toContain("backfillCursor"); expect(result).not.toContain("keys");
    expect(await f.service.backlog()).toEqual({ events: 10, blobs: 20 });
    expect(snapshot.cycleStartBacklog).toEqual({ events: 2, blobs: 3 });
    snapshot.cycleStartBacklog!.events = 99; expect((await f.service.snapshot()).cycleStartBacklog?.events).toBe(2);
    f.account.limits.maxAccountEvents = -1;
    await expect(f.service.account()).rejects.toMatchObject({ code: "sync/server" });
    f.status.backend = "transport"; expect(await f.service.account()).toBeNull();
  } finally { f.service.dispose(); }
});
test("requests distinguish an existing cycle and reject disconnected, pre-cancelled or changed connections", async () => {
  const f = fixture();
  try {
    expect((await f.service.requestSync()).status).toBe("completed"); expect(f.runs()).toBe(1);
    f.adapter.run = async () => null; expect((await f.service.requestSync()).status).toBe("already-running");
    const signal = new AbortController(); signal.abort(Error("cancelled"));
    await expect(f.service.requestSync(signal.signal)).rejects.toThrow("cancelled");
    let finish!: (value: object) => void;
    const started = Promise.withResolvers<void>();
    f.adapter.run = () => new Promise(resolve => { finish = resolve; started.resolve(); });
    const run = f.service.requestSync(); await started.promise; f.change(); finish({});
    await expect(run).rejects.toMatchObject({ code: "ui/superseded" });
    f.status.state = "unauthenticated";
    await expect(f.service.requestSync()).rejects.toMatchObject({ code: "sync/unauthorized" });
    f.status.accountConnected = false;
    await expect(f.service.requestSync()).rejects.toMatchObject({ code: "ui/unavailable" });
  } finally { f.service.dispose(); }
});
test("sync discovery does not run a cycle and execution rechecks withdrawn provider conditions", async () => {
  const f = fixture();
  try {
    expect((await f.service.conditions()).some(value => value.state === "unknown")).toBe(true);
    expect(f.runs()).toBe(0);
    f.adapter.conditions = async () => [{ kind: "provider", state: "unavailable", reason: "provider-retired", errorCode: "ui/unavailable" }];
    await expect(f.service.requestSync()).rejects.toMatchObject({ code: "ui/unavailable" });
    expect(f.runs()).toBe(0);
    f.adapter.conditions = async () => { f.change(); return []; };
    await expect(f.service.requestSync()).rejects.toMatchObject({ code: "ui/superseded" });
    expect(f.runs()).toBe(0);
  } finally { f.service.dispose(); }
});
test("account reads cannot cross a connection epoch; observation is initial, serial and disposable", async () => {
  const f = fixture();
  try {
    let finish!: (account: AccountResponse) => void;
    f.adapter.account = () => new Promise(resolve => { finish = resolve; });
    const pending = f.service.account(); f.change(); finish(f.account);
    await expect(pending).rejects.toMatchObject({ code: "ui/superseded" });
    const seen: HostSyncSnapshot[] = []; let release!: () => void;
    const off = f.service.observe(async snapshot => { seen.push(snapshot); if (seen.length === 1) await new Promise<void>(resolve => { release = resolve; }); });
    const origin = causalActor("plugin:sync"), source = stampEventCause({}, origin);
    await Bun.sleep(0); f.notify(source); f.notify(source); expect(seen).toHaveLength(1);
    release(); await Bun.sleep(0); expect(seen).toHaveLength(2);
    expect(eventCause(seen[1]!)).toEqual(actorCause(origin));
    off(); f.busy(); await Bun.sleep(0); expect(seen).toHaveLength(2);
    f.adapter.backlog = async () => { throw Error("database failed"); };
    await expect(f.service.backlog()).rejects.toThrow("database failed");
  } finally { f.service.dispose(); }
});
