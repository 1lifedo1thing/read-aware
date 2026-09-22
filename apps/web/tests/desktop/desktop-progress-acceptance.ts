/** Real Tauri storage/reader with the existing encrypted loopback relay fixture.
 * This proves the desktop merge/resume path, not a deployed relay or tablet. */
import { appDataDir } from "@tauri-apps/api/path";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { getBookRecord } from "../../src/features/library/lib/library-db";
import type { FoliateView } from "../../src/features/reader/lib/foliate-engine";
import { invoke } from "../../src/platform/ipc";
import { observeRemoteHlcStamps } from "../../src/platform/domain-events";
import { sealEvent, type PlainEvent } from "../../src/platform/sync-envelope";
import { createSyncEngine } from "../../src/platform/sync/sync-engine";
import { createIpcSyncStore } from "../../src/platform/sync/sync-store";
import { fakeRelay } from "../../src/platform/sync/sync-test-kit";

async function isolated() {
  const path = (await appDataDir()).replace(/[/\\]$/, "");
  if (!path.endsWith("/com.readaware.app.progress-acceptance-20260920")) throw Error("Requires disposable progress acceptance profile");
  return path;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export async function verifyProgressResume(bookId: string, page: number, sectionIndex: number) {
  const path = await isolated();
  const reader = createReadingDomain("user").commands;
  const book = await getBookRecord(bookId);
  assert(book?.progress?.currentLocation === page, `Expected persisted page ${page}, got ${book?.progress?.currentLocation}`);
  await reader.openBook(bookId);
  const snapshot = readingRuntime.snapshot(), current = snapshot.location;
  assert(current && snapshot.pagination?.section.index === sectionIndex, `Expected section ${sectionIndex}, got ${snapshot.pagination?.section.index}`);
  await reader.close();
  return { path, page, sectionIndex, cfi: current.cfi, schema: await invoke<number>("checkpoint_schema_version") };
}

export async function runDesktopProgressAcceptance() {
  const path = await isolated();
  const chapters = Array.from({ length: 5 }, (_, chapter) => `<section><title><p>Chapter ${chapter + 1}</p></title>${Array.from({ length: 40 }, (_, line) => `<p>Chapter ${chapter + 1}, paragraph ${line + 1}. A book reopens where it was last read, on any device, even after turning back. Another device's newer observation of an earlier page wins over an older one of a later page.</p>`).join("")}</section>`).join("");
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><first-name>Acceptance</first-name><last-name>Fixture</last-name></author><book-title>Offline Progress Acceptance</book-title><lang>en</lang></title-info><document-info><author><nickname>Acceptance</nickname></author><date>2026-09-20</date><id>${crypto.randomUUID()}</id><version>1.0</version></document-info></description><body>${chapters}</body></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: "offline-progress.fb2", data: new TextEncoder().encode(source) });
  const reader = createReadingDomain("user").commands;
  await reader.openBook(book.id);
  await reader.goTo({ bookId: book.id, contentVersion: readingRuntime.snapshot().location?.contentVersion, sectionIndex: 2 });
  assert(readingRuntime.snapshot().pagination?.section.index === 2, "Reader did not reach the third section");
  const view = document.querySelector<FoliateView>("foliate-view");
  assert(view, "Reader engine missing");
  const { SectionProgress } = await import(/* @vite-ignore */ new URL("/foliate-js/progress.js", location.origin).href) as typeof import("../../foliate-js/src/progress");
  const positions = new SectionProgress(view.book!.sections, 1500, 1600);
  const atSection = (index: number) => {
    const position = positions.getProgress(index);
    return { locator: view.getCFI(index), currentLocation: Math.min(position.location.total, position.location.current + 1),
      totalLocations: position.location.total, progressPercent: Math.round(position.fraction * 100), status: "reading" };
  };
  const nearPosition = atSection(1), farPosition = atSection(3);
  await reader.close();
  const offlinePage = (await getBookRecord(book.id))?.progress?.currentLocation;
  assert(offlinePage && offlinePage > nearPosition.currentLocation, "Offline session did not persist the third section");

  // Turning BACK is a position like any other: reopen, go back one section,
  // close — the book must reopen there, not at the furthest page (issue: the
  // 0.6.0–0.6.2 furthest-position rule reopened at the old page every time).
  await reader.openBook(book.id);
  await reader.goTo({ bookId: book.id, contentVersion: readingRuntime.snapshot().location?.contentVersion, sectionIndex: 1 });
  assert(readingRuntime.snapshot().pagination?.section.index === 1, "Reader did not turn back to the second section");
  await reader.close();
  const backPage = (await getBookRecord(book.id))?.progress?.currentLocation;
  assert(backPage && backPage < offlinePage, "Turning back was not persisted");
  const afterBack = await verifyProgressResume(book.id, backPage, 1);

  const relay = fakeRelay(), key = crypto.getRandomValues(new Uint8Array(32));
  const store = createIpcSyncStore();
  // Each invocation owns a fresh disposable mailbox, including repeat runs.
  await store.setEventsCursor(0, null);
  const engine = createSyncEngine({ store, relay, masterKey: () => key, observe: observeRemoteHlcStamps });
  const now = Date.now();
  const remote = (position: ReturnType<typeof atSection>, observedAt: number, counter: number): PlainEvent => ({
    id: crypto.randomUUID(), type: "book.sessionRecorded", hlc: { wallMs: now + 1000, counter, deviceId: "synthetic-other-device" },
    payload: { bookId: book.id, ms: 1000, startedAt: observedAt - 1000, endedAt: observedAt,
      localDay: "2026-09-20", localHour: 10,
      progress: { ...position, observedAt } },
  });
  // Reconnect pulls another device's LATER observation of a farther page
  // before pushing offline work: the later observation wins.
  await relay.pushEvents([sealEvent(key, remote(farPosition, now + 1000, 0))]);
  const pulled = await engine.pullOnce();
  assert(pulled === 1, "The newer remote event was not actually pulled");
  const afterFar = await verifyProgressResume(book.id, farPosition.currentLocation, 3);
  const pushed = await engine.pushOnce();
  await engine.pullOnce(); // Echoes are idempotent, including our own sessions.
  await verifyProgressResume(book.id, farPosition.currentLocation, 3);

  // The other device turns back: its newer observation of an EARLIER page wins.
  await relay.pushEvents([sealEvent(key, remote(nearPosition, now + 2000, 1))]);
  await engine.pullOnce();
  const afterNear = await verifyProgressResume(book.id, nearPosition.currentLocation, 1);

  // A farther page with an OLDER observation (an offline session that closed
  // late) cannot override it, and a full replay lands on the same answer.
  await relay.pushEvents([sealEvent(key, remote(farPosition, now - 10000, 2))]);
  await engine.pullOnce();
  const afterStale = await verifyProgressResume(book.id, nearPosition.currentLocation, 1);
  await invoke("rebuild_projections");
  const afterReplay = await verifyProgressResume(book.id, nearPosition.currentLocation, 1);
  return { path, bookId: book.id, pulled, pushed, afterBack, afterFar, afterNear, afterStale, afterReplay };
}
