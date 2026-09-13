import { getDefaultStore } from "jotai";
import type {
  AnnotationSnapshot,
  PluginBookAccess,
  PluginDisposable,
  PluginManifest,
} from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { createLibraryDomain } from "../../src/domain/library";
import { createReadingDomain } from "../../src/domain/reading";
import { localKV } from "../../src/platform/local-store";
import { inspectContributions } from "../../src/features/plugins/state/contribution-registry";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { startPluginWorker } from "../../src/features/plugins/runtime/plugin-worker-host";
import { parseProbeToast } from "./probe-toast";
import { assertFull2BookAccessProfile } from "./desktop-book-access-fixture";

const DENIED = "plugin/object-access-denied";

type WorkerAttempt =
  | { status: "allowed"; annotationId: string; bookId: string; receipt?: unknown }
  | { status: "rejected"; code: string };

type WorkerTarget = {
  created: { id: string; kind: string; bookId: string; body: string };
  before: AnnotationSnapshot;
  edit: { atomic: true; changes: Array<{ annotationId: string; revision: string | null }> };
  after: AnnotationSnapshot;
};

type WorkerWriteResult = {
  status: "ok" | "error";
  code?: string;
  grant?: PluginBookAccess;
  target?: WorkerTarget;
  crossCreate?: WorkerAttempt;
  crossEdit?: WorkerAttempt;
  createdIds?: string[];
};

async function markerNoteIds(
  domain: ReturnType<typeof createAnnotationsDomain>,
  bookIds: readonly string[],
  marker: string,
): Promise<string[]> {
  const pages = await Promise.all(bookIds.map(bookId => domain.queries.page({
    bookId,
    kind: "note",
    query: marker,
    limit: 100,
  })));
  return pages.flatMap(page => page.items
    .filter(item => item.kind === "note" && item.body.includes(marker))
    .map(item => item.id));
}

async function removeOwnedAnnotations(
  domain: ReturnType<typeof createAnnotationsDomain>,
  ids: readonly string[],
  bookIds: readonly string[],
  marker: string,
  beforeMarkerIds: ReadonlySet<string>,
): Promise<string[]> {
  const candidates = new Set(ids);
  for (const id of await markerNoteIds(domain, bookIds, marker)) {
    if (!beforeMarkerIds.has(id)) candidates.add(id);
  }
  const removed: string[] = [];
  const failures: unknown[] = [];
  for (const id of candidates) {
    try {
      const snapshot = await domain.queries.inspect(id);
      if (!snapshot) continue;
      await domain.commands.applyChanges([{
        op: "remove",
        kind: snapshot.annotation.kind,
        annotationId: id,
        expectedRevision: snapshot.revision,
      }]);
      removed.push(id);
    } catch (error) {
      failures.push(error);
    }
  }
  const remaining = (await markerNoteIds(domain, bookIds, marker))
    .filter(id => !beforeMarkerIds.has(id));
  if (remaining.length) failures.push(new Error(`Probe annotations remain: ${remaining.join(", ")}`));
  if (failures.length) throw new AggregateError(failures, "Annotation write probe cleanup failed");
  return removed;
}

function assertGrant(received: PluginBookAccess | undefined, expected: PluginBookAccess): void {
  if (!received || received.mode !== expected.mode
    || received.mode === "book" && (expected.mode !== "book" || received.bookId !== expected.bookId)) {
    throw new Error("Worker received a different book grant");
  }
}

/**
 * Runs a compiled Worker through the public annotations domain. Current grants
 * use the first fixture book as the active reader; book grants may name either
 * fixture. The all case is retained for a positive unrestricted control.
 */
export async function runDesktopAnnotationWriteAccessProbe(
  grant: PluginBookAccess,
  bookIds: readonly [string, string],
) {
  const dataDir = await assertFull2BookAccessProfile();
  if (bookIds.length !== 2 || !bookIds[0] || !bookIds[1] || bookIds[0] === bookIds[1]) {
    throw new Error("Two distinct fixture books are required");
  }
  const library = createLibraryDomain("user");
  for (const bookId of bookIds) {
    if (!(await library.queries.books.get(bookId))) throw new Error(`Fixture book is missing: ${bookId}`);
  }
  const targetBookId = grant.mode === "book" ? grant.bookId : bookIds[0];
  if (!bookIds.includes(targetBookId)) throw new Error("Book grant must name one fixture book");
  const otherBookId = targetBookId === bookIds[0] ? bookIds[1] : bookIds[0];
  if (grant.mode === "current") {
    await createReadingDomain("user").commands.openBook(targetBookId, AbortSignal.timeout(20_000));
  }

  const marker = `full2-annotation-write-${crypto.randomUUID()}`;
  const annotations = createAnnotationsDomain("user");
  const beforeMarkerIds = new Set(await markerNoteIds(annotations, bookIds, marker));
  const id = `annotation-write-access-${crypto.randomUUID()}`;
  const inputKey = `read-aware-plugin.${id}.input`;
  const disposables: PluginDisposable[] = [];
  const manifest: PluginManifest = {
    id,
    name: "Annotation write access probe",
    version: "1.0.0",
    schemaVersion: 1,
    permissions: ["annotations:write"],
    requires: { domains: { annotations: "^2.2.0" }, services: { storage: "^2.0.0" } },
  };
  let worker: Awaited<ReturnType<typeof startPluginWorker>> | undefined;
  let workerResult: WorkerWriteResult | undefined;
  const cleanupIds = new Set<string>();
  let markerBeforeWorker = new Set<string>();

  try {
    const baseline = await annotations.commands.createNote({
      bookId: otherBookId,
      body: `${marker} baseline note`,
    });
    cleanupIds.add(baseline.id);
    const baselineBefore = await annotations.queries.inspect(baseline.id);
    if (!baselineBefore || baselineBefore.annotation.kind !== "note" || baselineBefore.annotation.bookId !== otherBookId) {
      throw new Error("Probe baseline note was not persisted");
    }
    markerBeforeWorker = new Set(await markerNoteIds(annotations, bookIds, marker));
    await localKV.setItemAsync(inputKey, JSON.stringify({
      targetBookId,
      otherBookId,
      otherNoteId: baseline.id,
      otherNoteRevision: baselineBefore.revision,
      marker,
    }));
    worker = await startPluginWorker(manifest, "0.5.4", disposables, {
      moduleUrl: new URL("./annotation-write-access-probe.ts", import.meta.url).href,
      bookAccess: grant,
    });
    await worker.checkHealth();
    worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom)
      .find(item => item.pluginId === id && item.id === "write");
    if (!command) throw new Error("Annotation write Worker command did not register");
    const result = await command.run();
    if (typeof result?.toast !== "string") throw new Error("Worker produced no annotation write receipt");
    workerResult = parseProbeToast(result.toast) as WorkerWriteResult;
    for (const createdId of workerResult.createdIds ?? []) if (typeof createdId === "string") cleanupIds.add(createdId);
    if (workerResult.status !== "ok") throw new Error(`Worker write failed: ${workerResult.code ?? "unknown"}`);
    assertGrant(workerResult.grant, grant);

    const target = workerResult.target;
    if (!target || target.created.kind !== "note" || target.created.bookId !== targetBookId
      || !target.created.body.startsWith(`${marker} `)
      || target.before.annotation.kind !== "note" || target.before.annotation.bookId !== targetBookId
      || target.edit.atomic !== true || target.edit.changes.length !== 1
      || target.edit.changes[0]?.annotationId !== target.created.id
      || target.edit.changes[0]?.revision !== target.after.revision
      || target.after.annotation.kind !== "note" || target.after.annotation.bookId !== targetBookId
      || target.after.annotation.body !== `${marker} target edited`) {
      throw new Error("Authorized note create/edit did not produce a matching CAS receipt");
    }

    const restricted = grant.mode !== "all";
    const expectedCross = restricted ? "rejected" : "allowed";
    if (workerResult.crossCreate?.status !== expectedCross || workerResult.crossEdit?.status !== expectedCross) {
      throw new Error("Cross-book annotation writes had the wrong access result");
    }
    const crossCreateCode = workerResult.crossCreate?.status === "rejected" ? workerResult.crossCreate.code : undefined;
    const crossEditCode = workerResult.crossEdit?.status === "rejected" ? workerResult.crossEdit.code : undefined;
    if (restricted && (crossCreateCode !== DENIED || crossEditCode !== DENIED)) {
      throw new Error("Cross-book annotation writes were not rejected by object access");
    }
    if (!restricted && (workerResult.crossCreate?.status !== "allowed" || workerResult.crossEdit?.status !== "allowed")) {
      throw new Error("Unrestricted annotation control did not allow both fixture books");
    }
    const otherAfter = await annotations.queries.inspect(baseline.id);
    if (!otherAfter) throw new Error("Baseline note disappeared during access probe");
    if (restricted) {
      if (JSON.stringify(otherAfter) !== JSON.stringify(baselineBefore)) {
        throw new Error("Rejected cross-book writes changed the baseline note");
      }
      const markerAfter = await markerNoteIds(annotations, [otherBookId], marker);
      const unexpected = markerAfter.filter(annotationId => !markerBeforeWorker.has(annotationId));
      if (unexpected.length) throw new Error(`Rejected cross-book create left annotations: ${unexpected.join(", ")}`);
    } else {
      if (otherAfter.annotation.kind !== "note" || otherAfter.annotation.body !== `${marker} cross edited`
        || otherAfter.revision === baselineBefore.revision) {
        throw new Error("Unrestricted cross-book edit did not persist");
      }
      const crossId = workerResult.crossCreate?.status === "allowed" ? workerResult.crossCreate.annotationId : undefined;
      if (!crossId || !(await annotations.queries.inspect(crossId))) throw new Error("Unrestricted cross-book create did not persist");
    }

    return {
      dataDir,
      marker,
      grant,
      targetBookId,
      otherBookId,
      baseline: { before: baselineBefore, after: otherAfter },
      worker: workerResult,
      verification: "Actual compiled Worker, public annotations domain, SQLite and Full2 Tauri bridge.",
    };
  } finally {
    try {
      await worker?.terminate();
    } finally {
      for (const disposable of disposables.reverse()) disposable.dispose();
      try {
        await localKV.removeItemAsync(inputKey);
      } finally {
        await removeOwnedAnnotations(annotations, [...cleanupIds], bookIds, marker, beforeMarkerIds);
        if (inspectContributions(id).length) throw new Error("Annotation write probe left contributions");
      }
    }
  }
}
