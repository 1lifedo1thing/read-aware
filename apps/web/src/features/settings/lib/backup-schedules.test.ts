import { expect, spyOn, test } from "bun:test";
import * as kv from "../../../platform/local-store";
import * as library from "../../library/lib/library-db";
import * as annotations from "../../annotations/lib/annotation-db";
import * as profile from "../../../domain/user-profile";
import { pluginSchedules } from "../../plugins/runtime/plugin-scheduler";
import { exportBackup, importBackup } from "./backup-io";

const local = { "read-aware-plugin.backup-schedule.schedule-state": '{"job":{"deferred":{"requestId":"foreign"}}}',
  "read-aware-plugin.backup-schedule.schedule-runs": '{"job":"old"}',
  "read-aware-plugin.backup-schedule.settings": '{"chosen":true}',
  "read-aware-plugin.backup-schedule.schedule-state-extra": '"user data"' };

function reads() {
  return [spyOn(kv, "dumpLocalKV").mockResolvedValue(local),
    spyOn(library, "listLibraryBooks").mockResolvedValue([]), spyOn(library, "listCollections").mockResolvedValue([]),
    spyOn(annotations, "listAnnotations").mockResolvedValue([]),
    spyOn(profile, "readUserProfileSnapshot").mockResolvedValue({ summary: null, revision: "empty" })];
}

test("a production schedule can await the complete export path without joining its own flight", async () => {
  const mocks = reads(), write = spyOn(kv.localKV, "setItemAsync").mockResolvedValue();
  let exported: Record<string, unknown> | undefined;
  const owner = pluginSchedules.register("backup-schedule", { id: "export", label: "Export", everyMinutes: 60 }, async () => {
    exported = JSON.parse(await exportBackup()).kv;
  });
  try {
    expect((await pluginSchedules.control({ pluginId: "backup-schedule", id: "export", action: "run" })).status).toBe("completed");
    expect(exported).toEqual({ "read-aware-plugin.backup-schedule.settings": '{"chosen":true}',
      "read-aware-plugin.backup-schedule.schedule-state-extra": '"user data"' });
    expect(write).toHaveBeenCalledTimes(2);
  } finally { owner.dispose(); await pluginSchedules.drainWrites("backup-schedule"); write.mockRestore(); for (const mock of mocks) mock.mockRestore(); }
});

test("production export holds a task's final receipt until capture ends", async () => {
  const mocks = reads(), write = spyOn(kv.localKV, "setItemAsync").mockResolvedValue();
  const callback = Promise.withResolvers<void>(), capture = Promise.withResolvers<void>();
  const dump = spyOn(kv, "dumpLocalKV").mockImplementation(async () => { await capture.promise; return local; });
  const owner = pluginSchedules.register("backup-schedule", { id: "late", label: "Late", everyMinutes: 60 }, () => callback.promise);
  const execution = pluginSchedules.control({ pluginId: "backup-schedule", id: "late", action: "run" });
  let backup: Promise<string> | undefined;
  try {
    await Bun.sleep(0); expect(write).toHaveBeenCalledTimes(1);
    backup = exportBackup(); await Bun.sleep(0);
    callback.resolve(); await Bun.sleep(0); expect(write).toHaveBeenCalledTimes(1);
    capture.resolve(); await backup; expect((await execution).schedule.lastOutcome).toBe("succeeded");
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    callback.resolve(); capture.resolve(); await Promise.allSettled([execution, backup]);
    owner.dispose(); await pluginSchedules.drainWrites("backup-schedule");
    dump.mockRestore(); write.mockRestore(); for (const mock of mocks) mock.mockRestore();
  }
});

test("legacy v1 import preserves device task identity while importing ordinary plugin settings", async () => {
  const write = spyOn(kv, "restoreLocalKV").mockResolvedValue();
  try {
    const result = await importBackup(JSON.stringify({ kind: "backup", books: [], kv: local }));
    expect(result.settings).toBe(2);
    expect(write).toHaveBeenCalledWith({ "read-aware-plugin.backup-schedule.settings": '{"chosen":true}',
      "read-aware-plugin.backup-schedule.schedule-state-extra": '"user data"' });
  } finally { write.mockRestore(); }
});
