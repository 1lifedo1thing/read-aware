import type { DomainActor } from "../platform/domain-actor";
import { getBookContentState } from "./book-content-state";
import { getVirtualTextSource } from "../features/library/lib/virtual-text-source";
import { runDomainWrite } from "../platform/domain-write-gate";
import { AppError, validateClassificationBookId, type BookDigestSnapshot, type ChapterDigest } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

function assertLive(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("memory/unavailable", "Digest storage requires desktop");
  if (signal?.aborted) throw new AppError("memory/cancelled", "Digest owner cancelled");
}
function validateTarget(bookId: string, chapterIndex: number) {
  validateClassificationBookId(bookId);
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0) throw new AppError("memory/invalid-input", "Invalid digest chapter");
}
/** Resolves actual virtual content, not merely a registered provider identity. */
export async function getDigestContentVersion(bookId: string, signal?: AbortSignal, loadVirtual = false): Promise<string> {
  const before = await getBookContentState(bookId, signal);
  const version = before.source === "virtual" ? (await getVirtualTextSource(bookId, loadVirtual)).contentVersion : before.contentVersion;
  const after = await getBookContentState(bookId, signal);
  if (before.sourceRevision !== after.sourceRevision || before.source !== after.source) throw new AppError("memory/conflict", "Digest source changed during discovery");
  if (!version) throw new AppError("library/content-unavailable", "Digest source has no current content identity");
  return version;
}

export async function inspectBookDigest(bookId: string, chapterIndex: number, signal?: AbortSignal): Promise<BookDigestSnapshot | null> {
  validateTarget(bookId, chapterIndex); assertLive(signal);
  const snapshot = await invoke<BookDigestSnapshot | null>("book_digest_inspect", { id: bookId, chapterIndex });
  if (!snapshot) return null;
  const contentVersion = await getDigestContentVersion(bookId, signal);
  if (snapshot.contentVersion && snapshot.contentVersion !== contentVersion) throw new AppError("memory/conflict", "Digest source changed during inspection");
  assertLive(signal); return { ...snapshot, contentVersion };
}
export async function saveBookDigest(bookId: string, digest: ChapterDigest, expectedRevision: string, signal?: AbortSignal, origin: DomainActor = "agent"): Promise<void> {
  validateTarget(bookId, digest.chapterIndex);
  if (typeof expectedRevision !== "string" || !/^bdg1:[a-f0-9]{64}$/.test(expectedRevision)) throw new AppError("memory/invalid-input", "Missing digest revision");
  const copy = structuredClone(digest);
  const checkSource = async () => {
    if (!copy.contentVersion || await getDigestContentVersion(bookId, signal) !== copy.contentVersion) throw new AppError("memory/conflict", "Digest source changed before commit");
  };
  const draft: DomainEventDraft = { type: "book.chapterDigested", origin, payload: { ...copy, bookId, flavor: copy.flavor ?? "narrative" } };
  return runDomainWrite(async () => {
    assertLive(signal);
    // Admission must precede the source recheck. During backup capture a
    // conditional write is rejected before it can read native state or mint an
    // event, just like every other domain writer.
    await checkSource();
    const [event] = await mintEventRows([draft]);
    assertLive(signal);
    await checkSource();
    await invoke<BookDigestSnapshot>("book_digest_commit", { event, expectedRevision });
    broadcastDomainEventDrafts([draft]);
  });
}
