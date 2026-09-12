import { expect, spyOn, test } from "bun:test";
import * as dialog from "@tauri-apps/plugin-dialog";
import * as environment from "./environment";
import * as ipc from "./ipc";
import { initI18n } from "../i18n";
import { openAssociatedResource } from "./resource-external";

test("associated dispatch follows host confirmation, rechecks cancellation and keeps actual late outcomes", async () => {
  const desktop = spyOn(environment, "isTauri").mockReturnValue(true), mobile = spyOn(environment, "isMobileOS").mockReturnValue(false);
  const ask = spyOn(dialog, "ask").mockResolvedValue(false), invoke = spyOn(ipc, "invoke").mockResolvedValue(undefined);
  try {
    await initI18n("en");
    expect(await openAssociatedResource("native-id", "Private Book.epub")).toBe(false);
    expect(invoke).not.toHaveBeenCalled(); expect(String(ask.mock.calls[0]![0])).toContain("Private Book.epub");
    const abort = new AbortController(); ask.mockImplementation(async () => { abort.abort(Error("closed")); return true; });
    await expect(openAssociatedResource("native-id", "Book.epub", abort.signal)).rejects.toThrow("closed");
    expect(invoke).not.toHaveBeenCalled();
    ask.mockResolvedValue(true);
    await expect(openAssociatedResource("native-id", "Book.epub", undefined, () => { throw Error("retired"); })).rejects.toThrow("retired");
    expect(invoke).not.toHaveBeenCalled();
    const late = new AbortController(); invoke.mockImplementation(async <T>() => { late.abort(); return undefined as T; });
    expect(await openAssociatedResource("native-id", "Book.epub", late.signal)).toBe(true);
    expect(invoke.mock.calls[0]).toEqual(["resource_open_associated", { id: "native-id", filename: "Book.epub" }]);
    invoke.mockRejectedValue(Error("association missing"));
    await expect(openAssociatedResource("native-id", "Book.epub")).rejects.toThrow("association missing");
  } finally { ask.mockRestore(); invoke.mockRestore(); desktop.mockRestore(); mobile.mockRestore(); }
});
