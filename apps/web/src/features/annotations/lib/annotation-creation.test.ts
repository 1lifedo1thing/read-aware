import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import * as events from "../../../platform/domain-events";
import { createHighlight } from "./annotation-db";
import type { Highlight } from "./annotation-types";

const cleanups: (() => void)[] = [];
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const range = { bookId: "book", contentVersion: "sha256:old", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)" };
function fixture() {
  own(spyOn(environment, "isTauri").mockReturnValue(true));
  return {
    mint: own(spyOn(events, "mintEventRows").mockResolvedValue([])),
    broadcast: own(spyOn(events, "broadcastDomainEventDrafts").mockImplementation(() => {})),
    invoke: own(spyOn(ipc, "invoke").mockResolvedValue(undefined)),
  };
}
const create = (source: Parameters<typeof createHighlight>[7]) => createHighlight("book", range.cfi, null, "Quote", "blue", "underline", "agent", source);

test("source failure and cancellation before dispatch do not write or broadcast", async () => {
  const f = fixture();
  await expect(create({ range, beforeDispatch: async () => { throw new AppError("reader/stale-location", "Changed"); } })).rejects.toMatchObject({ code: "reader/stale-location" });
  const controller = new AbortController();
  f.mint.mockImplementation(async () => { controller.abort(); return []; });
  await expect(create({ range, signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

test("native conflict never broadcasts; cancellation after commit still returns stored provenance", async () => {
  const f = fixture();
  f.invoke.mockRejectedValue(new AppError("reader/stale-location", "Native conflict"));
  await expect(create({ range })).rejects.toMatchObject({ code: "reader/stale-location" });
  expect(f.broadcast).not.toHaveBeenCalled();
  const controller = new AbortController();
  const stored: Highlight = { id: "stored", bookId: "book", type: "highlight", range, cfiRange: range.cfi, chapterHref: null,
    createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", text: "Quote", color: "blue", style: "underline" };
  f.invoke.mockImplementation(async <T>(command: string): Promise<T> => {
    if (command === "commit_events") { controller.abort(); return undefined as T; }
    if (command === "annotation_get") return stored as T;
    throw Error(`Unexpected command ${command}`);
  });
  expect(await create({ range, signal: controller.signal })).toEqual(stored);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
  expect(f.mint.mock.calls[0]![0][0]).toMatchObject({ type: "highlight.created", payload: { range, anchor: range.cfi } });
});
