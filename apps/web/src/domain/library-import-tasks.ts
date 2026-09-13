import type { DomainActor } from "../platform/domain-actor";
import { AppError, type BookImportRequest } from "@read-aware/core";
import { BookImportTaskOwner } from "../features/library/lib/book-import-tasks";
import { importBook } from "../features/library/lib/book-import";
import { listLibraryBooks } from "../features/library/lib/library-db";
import { ResourceOwner, resourceName } from "../services/resource-owner";
import { agentResources } from "../services/resources";
import { createLogger } from "../platform/logger";
import { emitAppEvent } from "../platform/app-events";
import { i18n } from "../i18n";
import { importResourceBook } from "./library-resource-import";
import { toBookSummary } from "./library";

const log = createLogger("import-tasks");
export function createBookImportTasks(resources: ResourceOwner, origin: DomainActor, lifetime = resources.signal,
  trackCleanup?: (work: Promise<void>) => void) {
  const signal = lifetime === resources.signal ? lifetime : AbortSignal.any([resources.signal, lifetime]);
  const owner = new BookImportTaskOwner(error => log.warn("Import task failed", error), signal);
  if (!signal.aborted && trackCleanup) signal.addEventListener("abort", () => trackCleanup(owner.drain()), { once: true });
  return {
    async start(input: BookImportRequest, callerSignal?: AbortSignal, actor: DomainActor = origin) {
      callerSignal?.throwIfAborted(); signal.throwIfAborted();
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("ui/invalid-target", "Invalid import request");
      if (input.kind === "resource") {
        if (Object.keys(input).some(key => key !== "kind" && key !== "resourceId")) throw new AppError("ui/invalid-target", "Invalid import resource request");
        const id = input.resourceId, ref = await resources.stat(id, callerSignal);
        if (ref.state !== "ready" || ref.source === "context") throw new AppError("ui/invalid-target", "Import requires a sealed book resource");
        callerSignal?.throwIfAborted(); signal.throwIfAborted();
        return owner.start(ref.name, (taskSignal, progress) => importResourceBook(resources, id, actor, taskSignal, progress));
      }
      if (input.kind !== "file" || Object.keys(input).some(key => !["kind", "fileName", "data"].includes(key))
        || !(input.data instanceof ArrayBuffer || input.data instanceof Uint8Array)
        || input.data.byteLength > 64 * 1024 * 1024) throw new AppError("ui/invalid-target", "Invalid import file request");
      const name = resourceName(input.fileName);
      // File snapshots bytes now; later caller mutation cannot alter an admitted job.
      const file = new File([input.data], name);
      return owner.start(name, async (taskSignal, progress) => {
        const knownBooks = await listLibraryBooks();
        const outcome = await importBook({ kind: "file", file }, { t: i18n.getFixedT(null, "shelf"), knownBooks, origin: actor, signal: taskSignal, onProgress: progress });
        emitAppEvent("library-changed", {});
        return { status: outcome.status, book: toBookSummary(outcome.book) };
      });
    },
    get: (id: string) => owner.get(id), list: () => owner.list(), cancel: (id: string) => owner.cancel(id),
    wait: (id: string, waitMs?: number, callerSignal?: AbortSignal) => owner.wait(id, waitMs, callerSignal),
    observe: (id: string, handler: Parameters<BookImportTaskOwner["observe"]>[1]) => owner.observe(id, handler),
    drain: () => owner.drain(),
  };
}

const agentImports = new WeakMap<ResourceOwner, ReturnType<typeof createBookImportTasks>>();
export function agentBookImportTasks(threadKey: string) {
  const resources = agentResources(threadKey);
  let tasks = agentImports.get(resources);
  if (!tasks) { tasks = createBookImportTasks(resources, "agent"); agentImports.set(resources, tasks); }
  return tasks;
}
