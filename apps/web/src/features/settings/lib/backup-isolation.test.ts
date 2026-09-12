import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as kv from "../../../platform/local-store";
import * as library from "../../library/lib/library-db";
import * as annotations from "../../annotations/lib/annotation-db";
import * as profile from "../../../domain/user-profile";
import { PluginPreferencePublication } from "../../../platform/plugin-preference-publication";
import { withPluginDataUpdate } from "../../../platform/plugin-data-access";
import { exportBackup, importBackup } from "./backup-io";
import type { LibraryBook } from "../../library/lib/library-types";
const gate = () => Promise.withResolvers<void>();
const document = JSON.stringify({ kind: "backup", version: 1, books: [], kv: { "read-aware-plugin.backup-proof.settings": "true" } });

test("actual backup entries reject migration and quarantined namespaces before any data access", async () => {
  const read = spyOn(kv, "dumpLocalKV").mockResolvedValue({});
  const write = spyOn(kv, "restoreLocalKV").mockResolvedValue();
  const migrating = gate();
  const update = withPluginDataUpdate("backup-proof", () => migrating.promise);
  try {
    await expect(exportBackup()).rejects.toMatchObject({ code: "plugin/data-busy" });
    await expect(importBackup(document)).rejects.toMatchObject({ code: "plugin/data-busy" });
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  } finally { migrating.resolve(); await update; }
  const scope = PluginPreferencePublication.begin("backup-not-in-catalog", {}); scope.quarantine();
  try {
    await expect(exportBackup()).rejects.toMatchObject({ code: "plugin/recovery-required" });
    await expect(importBackup(document)).rejects.toMatchObject({ code: "plugin/recovery-required" });
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  } finally { scope.rollback(); read.mockRestore(); write.mockRestore(); }
});

test("a failed export drains other dispatched reads before allowing a new migration", async () => {
  const pending = gate();
  const mocks = [
    spyOn(kv, "dumpLocalKV").mockRejectedValue(new AppError("db/locked", "read failed")),
    spyOn(library, "listLibraryBooks").mockImplementation(async () => { await pending.promise; return []; }),
    spyOn(library, "listCollections").mockResolvedValue([]),
    spyOn(annotations, "listAnnotations").mockResolvedValue([]),
    spyOn(profile, "readUserProfileSnapshot").mockResolvedValue({ summary: null, revision: "empty" }),
  ];
  const result = exportBackup().catch(error => error);
  try {
    await Bun.sleep(0);
    await expect(withPluginDataUpdate("backup-late-reader", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
    pending.resolve(); expect(await result).toMatchObject({ code: "db/locked" });
    await withPluginDataUpdate("backup-late-reader", async () => {});
  } finally { pending.resolve(); await result; for (const mock of mocks) mock.mockRestore(); }
});

test("the merge retains exclusion through later writes and keeps real results after cancellation", async () => {
  const writing = gate(), controller = new AbortController();
  const write = spyOn(kv, "restoreLocalKV").mockImplementation(async () => { await writing.promise; });
  const result = importBackup(document, controller.signal);
  try {
    await Bun.sleep(0); expect(write).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(withPluginDataUpdate("backup-import-owner", async () => {})).rejects.toMatchObject({ code: "plugin/data-busy" });
    writing.resolve(); expect(await result).toMatchObject({ settings: 1 });
    await withPluginDataUpdate("backup-import-owner", async () => {});
  } finally { writing.resolve(); await result; write.mockRestore(); }
});

test("capture never downloads and rejects a prepared source that disappeared or a new missing book", async () => {
  let reads = 0;
  const books = spyOn(library, "listLibraryBooks").mockResolvedValue([{ id: "prepared" } as LibraryBook]);
  const mocks = [
    spyOn(kv, "dumpLocalKV").mockResolvedValue({}),
    books,
    spyOn(library, "hasLocalBookFile").mockResolvedValue(true),
    spyOn(library, "getStoredBookBlob").mockResolvedValue(null),
    spyOn(library, "listCollections").mockResolvedValue([]),
    spyOn(annotations, "listAnnotations").mockResolvedValue([]),
    spyOn(profile, "readUserProfileSnapshot").mockResolvedValue({ summary: null, revision: "empty" }),
  ];
  try {
    await expect(exportBackup()).rejects.toMatchObject({ code: "backup/changed" });
    expect(library.getStoredBookBlob).toHaveBeenLastCalledWith("prepared", null);
    books.mockImplementation(async () => ++reads === 1 ? [] : [{ id: "new" } as LibraryBook]);
    await expect(exportBackup()).rejects.toMatchObject({ code: "backup/changed" });
    expect(library.getStoredBookBlob).toHaveBeenLastCalledWith("new", null);
  } finally { for (const mock of mocks) mock.mockRestore(); }
});
