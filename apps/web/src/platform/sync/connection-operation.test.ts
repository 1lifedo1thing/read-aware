import { actorCause, causalActor, eventCause } from "../domain-actor";
import { describe, expect, test } from "bun:test";
import {
  getSyncConnectionBusy,
  runSyncConnectionOperation,
  subscribeSyncConnectionBusy,
  SyncConnectionBusyError,
} from "./connection-operation";

describe("sync connection operation gate", () => {
  test("serializes operations across callers and publishes busy state", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const states: boolean[] = [], causes: unknown[] = [], origin = causalActor("user");
    const unsubscribe = subscribeSyncConnectionBusy(source => {
      causes.push(eventCause(source));
      states.push(getSyncConnectionBusy());
    });

    const first = runSyncConnectionOperation(async source => {
      expect(source).toBe(origin);
      await held;
      return "first";
    }, origin);
    expect(getSyncConnectionBusy()).toBe(true);
    await expect(runSyncConnectionOperation(async () => "second")).rejects.toThrow(
      SyncConnectionBusyError,
    );

    release();
    expect(await first).toBe("first");
    expect(getSyncConnectionBusy()).toBe(false);
    expect(states).toEqual([true, false]);
    expect(causes).toEqual([actorCause(origin), actorCause(origin)]);

    expect(await runSyncConnectionOperation(async () => "third")).toBe("third");
    unsubscribe();
  });
});
