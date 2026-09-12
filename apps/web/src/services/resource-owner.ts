import { AppError, BOOK_IMAGE_MAX_BYTES, RESOURCE_LIFETIME_MS, RESOURCE_MAX_CHUNK, RESOURCE_MAX_SIZE, RESOURCE_EXTERNAL_EXTENSIONS,
  type ResourcePort, type ResourceRef, type ResourcePickOptions, type ResourceCreateOptions, type ResourceImageReceipt,
  type ResourceDirectoryRef, type ResourceDirectoryQuery, type ResourceDirectoryPage } from "@read-aware/core";
import { retainResourceAccess, type ContextResourceAccess } from "./resource-access";

export type NativeResource = { id: string; size: number; name: string; mimeType: string };
export type ResourceAdapter = {
  directories?: {
    pick(signal?: AbortSignal): Promise<{ id: string; name: string } | null>;
    list(id: string, query: ResourceDirectoryQuery): Promise<ResourceDirectoryPage>;
    openFile(id: string, relativePath: string): Promise<NativeResource>;
    release(id: string): Promise<void>;
  };
  pick(options: ResourcePickOptions, signal?: AbortSignal): Promise<NativeResource[]>;
  openBook(bookId: string, signal?: AbortSignal): Promise<NativeResource | null>;
  openCover(bookId: string, signal?: AbortSignal): Promise<NativeResource | null>;
  create(options: ResourceCreateOptions): Promise<NativeResource>;
  read(id: string, offset: number, length: number): Promise<ArrayBuffer>;
  append(id: string, offset: number, bytes: Uint8Array): Promise<number>;
  commit(id: string): Promise<void>;
  commitContext(id: string, expectedReadRevision: string): Promise<void>;
  /** Must run beforeWrite immediately before dispatch, after any dialog. */
  save(id: string, filename: string, signal?: AbortSignal, beforeWrite?: () => void): Promise<boolean>;
  openAssociated?(id: string, filename: string, signal?: AbortSignal, beforeWrite?: () => void): Promise<boolean>;
  copyImage(id: string): Promise<ResourceImageReceipt>;
  imagePreview(id: string): Promise<ArrayBuffer>;
  release(id: string): Promise<void>;
};
type Entry = { nativeId: string; ref: ResourceRef; timer: ReturnType<typeof setTimeout>;
  access?: ReturnType<typeof retainResourceAccess>; stopObserving?: () => void };
const invalid = () => new AppError("ui/invalid-target", "Invalid resource input");
export function resourceName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\\/\u0000-\u001f\u007f]/.test(value) || value === "." || value === "..") throw invalid();
  return value;
}
function mime(value: unknown): string {
  if (value === undefined) return "application/octet-stream";
  if (typeof value !== "string" || value.length > 256 || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value)) throw invalid();
  return value;
}
function idValue(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 256) throw invalid();
}
function directoryPath(value: unknown, root = false): string {
  if (value === "" && root) return "";
  if (typeof value !== "string" || value.length > 4096 || new TextEncoder().encode(value).length > 4096
    || /[\\:\u0000-\u001f\u007f-\u009f]/.test(value) || value.split("/").length > 32
    || value.split("/").some(part => !part || part === "." || part === "..")) throw invalid();
  return value;
}

/** One serial queue per actor. Public IDs cannot be reused across owners. */
export class ResourceOwner implements ResourcePort {
  private entries = new Map<string, Entry>();
  private directories = new Map<string, { nativeId: string; ref: ResourceDirectoryRef; timer: ReturnType<typeof setTimeout> }>();
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private disposed = false;
  private readonly lifetime = new AbortController();
  get signal(): AbortSignal { return this.lifetime.signal; }
  constructor(private adapter: ResourceAdapter, private report: (error: unknown) => void,
    private authorizeBook: (id: string) => void = () => {}, private now = Date.now,
    private authorizeRead: (ref: ResourceRef) => void = () => {}) {}

  private directoryAdapter() {
    if (!this.adapter.directories) throw new AppError("ui/unavailable", "Directory resources unavailable");
    return this.adapter.directories;
  }
  pickDirectory(signal?: AbortSignal) {
    return this.run(async () => {
      const adapter = this.directoryAdapter();
      if (this.directories.size >= 4) throw new AppError("ui/unavailable", "At most four directory grants per owner");
      const value = await adapter.pick(signal);
      if (!value) { this.guard(signal); return { cancelled: true, directory: null }; }
      try {
        this.guard(signal);
        const ref: ResourceDirectoryRef = { id: crypto.randomUUID(), name: resourceName(value.name), expiresAt: this.now() + RESOURCE_LIFETIME_MS };
        const timer = setTimeout(() => {
          const cleanup = this.tail.then(() => this.removeDirectory(ref.id));
          this.tail = cleanup.catch(this.report);
        }, RESOURCE_LIFETIME_MS);
        if (typeof timer === "object" && "unref" in timer) timer.unref();
        this.directories.set(ref.id, { nativeId: value.id, ref, timer });
        return { cancelled: false, directory: { ...ref } };
      } catch (error) { try { await adapter.release(value.id); } catch (cleanup) { this.report(cleanup); } throw error; }
    }, signal);
  }
  listDirectory(id: string, query: ResourceDirectoryQuery = {}, signal?: AbortSignal) {
    if (!query || typeof query !== "object" || Object.keys(query).some(key => !["relativePath", "cursor", "limit"].includes(key))
      || (query.cursor !== undefined && (typeof query.cursor !== "string" || query.cursor.length > 90))
      || (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100))) return Promise.reject(invalid());
    const accepted = { ...query, relativePath: directoryPath(query.relativePath ?? "", true) };
    return this.run(async () => {
      const entry = this.directory(id);
      const page = await this.directoryAdapter().list(entry.nativeId, accepted);
      this.guard(signal); this.directory(id); return page;
    }, signal);
  }
  openDirectoryFile(id: string, relativePath: string, signal?: AbortSignal) {
    const accepted = directoryPath(relativePath);
    return this.run(async () => {
      const entry = this.directory(id);
      this.capacity([{ id: "", size: 0, name: "file", mimeType: "application/octet-stream" }]);
      const value = await this.directoryAdapter().openFile(entry.nativeId, accepted);
      try { this.guard(signal); this.directory(id); this.capacity([value]); return this.register(value, "picked", "ready"); }
      catch (error) { await this.cleanNative([value]); throw error; }
    }, signal);
  }
  releaseDirectory(id: string) { idValue(id); return this.run(() => this.removeDirectory(id)); }
  private directory(id: string) {
    idValue(id); const entry = this.directories.get(id);
    if (!entry || entry.ref.expiresAt <= this.now()) throw new AppError("fs/not-found", "Directory expired or belongs to another actor");
    return entry;
  }
  private async removeDirectory(id: string) {
    const entry = this.directories.get(id); if (!entry) return;
    await this.directoryAdapter().release(entry.nativeId);
    clearTimeout(entry.timer); this.directories.delete(id);
  }
  pick(options: ResourcePickOptions = {}, signal?: AbortSignal) {
    if (!options || typeof options !== "object" || Object.keys(options).some(key => !["multiple", "extensions"].includes(key))
      || (options.multiple !== undefined && typeof options.multiple !== "boolean")
      || (options.extensions !== undefined && (!Array.isArray(options.extensions) || options.extensions.length > 32
        || options.extensions.some(ext => typeof ext !== "string" || ext.length > 16 || !/^[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*$/.test(ext))))) return Promise.reject(invalid());
    const accepted = { ...options, ...(options.extensions ? { extensions: [...options.extensions] } : {}) };
    return this.run(async () => {
      const values = await this.adapter.pick(accepted, signal);
      try {
        this.guard(signal); this.capacity(values);
        return { cancelled: values.length === 0, resources: values.map(value => this.register(value, "picked", "ready")) };
      } catch (error) { await this.cleanNative(values); throw error; }
    }, signal);
  }
  openBook(bookId: string, signal?: AbortSignal) {
    return this.openBookAsset(bookId, "book", signal);
  }
  /** Host-only: files supplied by a real drop onto a visible plugin target.
   * No File/Blob or ambient path entrypoint is exposed in the Worker service. */
  importDroppedFiles(files: readonly File[], signal?: AbortSignal): Promise<ResourceRef[]> {
    if (!Array.isArray(files) || files.length < 1 || files.length > 16) return Promise.reject(invalid());
    const accepted = files.map(file => ({ file, name: resourceName(file.name), size: file.size,
      mimeType: mime(file.type || undefined) }));
    return this.run(async () => {
      this.capacity(accepted.map(file => ({ ...file, id: "" })));
      const native: NativeResource[] = [];
      try {
        for (const value of accepted) {
          this.guard(signal);
          const next = await this.adapter.create({ name: value.name, mimeType: value.mimeType });
          native.push({ ...next, size: value.size });
          for (let offset = 0; offset < value.size; offset += RESOURCE_MAX_CHUNK) {
            this.guard(signal);
            const bytes = new Uint8Array(await value.file.slice(offset, offset + RESOURCE_MAX_CHUNK).arrayBuffer());
            this.guard(signal);
            if (bytes.length !== Math.min(RESOURCE_MAX_CHUNK, value.size - offset)) throw new AppError("fs/not-found", "Dropped file changed while reading");
            const size = await this.adapter.append(next.id, offset, bytes);
            if (size !== offset + bytes.length) throw new AppError("internal", "Unexpected dropped resource size");
          }
          this.guard(signal); await this.adapter.commit(next.id);
        }
        this.guard(signal);
        return native.map(value => this.register(value, "picked", "ready"));
      } catch (error) { await this.cleanNative(native); throw error; }
    }, signal);
  }
  openCover(bookId: string, signal?: AbortSignal) {
    return this.openBookAsset(bookId, "cover", signal);
  }
  /** Host-only context transport. Ownership of the disclosure lease transfers on call. */
  importContext(load: () => Promise<{ name: string; bytes: Uint8Array }>, authority: ContextResourceAccess, signal?: AbortSignal): Promise<ResourceRef> {
    const sourceRevision = authority.sourceRevision;
    const access = retainResourceAccess(authority, this.report);
    const check = () => { this.guard(signal); access.check(); };
    return this.run(async () => {
      check();
      if (!/^cbsource1:[a-f0-9]{32}:(0|[1-9][0-9]*)$/.test(sourceRevision)) throw invalid();
      this.capacity([{ id: "", size: 0, name: "context.json", mimeType: "application/json" }]);
      const data = await load();
      check();
      const name = resourceName(data.name), mimeType = "application/json", bytes = data.bytes.slice();
      this.capacity([{ id: "", size: bytes.byteLength, name, mimeType }]);
      const value = await this.adapter.create({ name, mimeType });
      try {
        for (let offset = 0; offset < bytes.length; offset += RESOURCE_MAX_CHUNK) {
          check();
          const chunk = bytes.slice(offset, offset + RESOURCE_MAX_CHUNK);
          const size = await this.adapter.append(value.id, offset, chunk);
          if (size !== offset + chunk.length) throw new AppError("internal", "Unexpected context resource size");
        }
        check(); await this.adapter.commitContext(value.id, sourceRevision); check();
        return this.register({ ...value, name, mimeType, size: bytes.length }, "context", "ready", access);
      } catch (error) { await this.cleanNative([value]); throw error; }
    }, signal).catch(error => { access.dispose(); throw error; });
  }
  /** Host-only acquisition: parse and copy within the actor's queue, never through Worker bytes. */
  importImage(bookId: string, load: () => Promise<Blob | null>, signal?: AbortSignal): Promise<ResourceRef | null> {
    idValue(bookId); this.authorizeBook(bookId);
    return this.run(async () => {
      this.authorizeBook(bookId);
      this.capacity([{ id: "", size: 0, name: "illustration", mimeType: "application/octet-stream" }]);
      const blob = await load();
      this.guard(signal); this.authorizeBook(bookId);
      if (!blob) return null;
      if (!blob.size || blob.size > BOOK_IMAGE_MAX_BYTES) throw invalid();
      const mimeType = mime(blob.type || undefined);
      const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
        "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg", "image/avif": "avif" } as Record<string, string>)[mimeType] ?? "bin";
      const name = `illustration.${extension}`;
      this.capacity([{ id: "", size: blob.size, name, mimeType }]);
      const value = await this.adapter.create({ name, mimeType });
      try {
        for (let offset = 0; offset < blob.size; offset += RESOURCE_MAX_CHUNK) {
          this.guard(signal);
          const bytes = new Uint8Array(await blob.slice(offset, offset + RESOURCE_MAX_CHUNK).arrayBuffer());
          this.guard(signal);
          const size = await this.adapter.append(value.id, offset, bytes);
          if (size !== offset + bytes.length) throw new AppError("internal", "Unexpected image resource size");
        }
        this.guard(signal); await this.adapter.commit(value.id);
        this.guard(signal); this.authorizeBook(bookId);
        return this.register({ ...value, size: blob.size, name, mimeType }, "image", "ready");
      } catch (error) { await this.cleanNative([value]); throw error; }
    }, signal);
  }
  private openBookAsset(bookId: string, source: "book" | "cover", signal?: AbortSignal) {
    idValue(bookId); this.authorizeBook(bookId);
    return this.run(async () => {
      this.authorizeBook(bookId);
      const value = await (source === "book" ? this.adapter.openBook(bookId, signal) : this.adapter.openCover(bookId, signal));
      if (!value) { this.guard(signal); return null; }
      try { this.guard(signal); this.authorizeBook(bookId); this.capacity([value]); return this.register(value, source, "ready"); }
      catch (error) { await this.cleanNative([value]); throw error; }
    }, signal);
  }
  /** Host-only: acquire an owned immutable private asset as a fresh lease. */
  importAsset(load: () => Promise<NativeResource>, signal?: AbortSignal): Promise<ResourceRef> {
    return this.run(async () => {
      const value = await load();
      try { this.guard(signal); this.capacity([value]); return this.register(value, "asset", "ready"); }
      catch (error) { await this.cleanNative([value]); throw error; }
    }, signal);
  }
  create(options: ResourceCreateOptions, signal?: AbortSignal) {
    const accepted = { name: resourceName(options?.name), mimeType: mime(options?.mimeType) };
    return this.run(async () => {
      this.capacity([{ id: "", size: 0, ...accepted }]);
      const value = await this.adapter.create(accepted);
      try { this.guard(signal); return this.register(value, "created", "writing"); }
      catch (error) { await this.cleanNative([value]); throw error; }
    }, signal);
  }
  stat(id: string, signal?: AbortSignal) { return this.run(async () => ({ ...this.get(id).ref }), signal); }
  /** Host domain consumers only: keep the sealed resource alive throughout an import. */
  use<T>(id: string, consume: (resource: NativeResource) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.run(async () => {
      const entry = this.get(id, true);
      if (entry.ref.source === "context") throw invalid();
      const result = await consume({ id: entry.nativeId, name: entry.ref.name, mimeType: entry.ref.mimeType, size: entry.ref.size });
      this.guard(signal);
      return result;
    }, signal);
  }
  /** Host mutation consumers arbitrate admission at their first durable write.
   * After dispatch, preserve the real receipt while retaining the resource lease. */
  useForWrite<T>(id: string, consume: (resource: NativeResource, beforeWrite: () => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.run(async () => {
      const entry = this.get(id, true);
      if (entry.ref.source === "context") throw invalid();
      const beforeWrite = () => { this.guard(signal); this.get(id, true); };
      return consume({ id: entry.nativeId, name: entry.ref.name, mimeType: entry.ref.mimeType, size: entry.ref.size }, beforeWrite);
    }, signal);
  }
  read(id: string, offset: number, length: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > RESOURCE_MAX_CHUNK) return Promise.reject(invalid());
    return this.run(async () => {
      const entry = this.get(id, true);
      this.authorizeRead({ ...entry.ref });
      if (offset > entry.ref.size) throw invalid();
      const data = await this.adapter.read(entry.nativeId, offset, length);
      this.guard(signal); this.get(id, true); this.authorizeRead({ ...entry.ref });
      if (data.byteLength !== Math.min(length, entry.ref.size - offset)) throw new AppError("fs/not-found", "Resource contents changed");
      return { data, nextOffset: offset + data.byteLength, eof: offset + data.byteLength === entry.ref.size };
    }, signal);
  }
  append(id: string, offset: number, data: Uint8Array | ArrayBuffer, signal?: AbortSignal) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !(data instanceof Uint8Array || data instanceof ArrayBuffer)
      || data.byteLength > RESOURCE_MAX_CHUNK) return Promise.reject(invalid());
    // Copy before entering the queue so a Worker cannot mutate an accepted chunk.
    const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
    return this.run(async () => {
      const entry = this.get(id);
      if (entry.ref.state !== "writing" || entry.ref.size !== offset) throw invalid();
      if (this.bytes() + bytes.length > RESOURCE_MAX_SIZE) throw new AppError("ui/unavailable", "Actor resource quota exceeded");
      const size = await this.adapter.append(entry.nativeId, offset, bytes);
      if (size !== offset + bytes.length) throw new AppError("internal", "Unexpected native resource size");
      entry.ref.size = size;
      this.guard(signal);
      return { ...entry.ref };
    }, signal);
  }
  commit(id: string, signal?: AbortSignal) {
    return this.run(async () => {
      const entry = this.get(id);
      if (entry.ref.source === "context") return { ...entry.ref };
      await this.adapter.commit(entry.nativeId);
      entry.ref.state = "ready";
      this.guard(signal); return { ...entry.ref };
    }, signal);
  }
  save(id: string, filename?: string, signal?: AbortSignal) {
    if (filename !== undefined) resourceName(filename);
    return this.run(async () => {
      const entry = this.get(id, true);
      const saved = await this.adapter.save(entry.nativeId, resourceName(filename ?? entry.ref.name), signal,
        () => { this.guard(signal); this.get(id, true); });
      // External writes cannot be recalled after dispatch; preserve their actual receipt.
      return { saved };
    }, signal);
  }
  release(id: string): Promise<void> {
    idValue(id);
    return this.run(async () => { await this.remove(id); });
  }
  openAssociated(id: string, signal?: AbortSignal): Promise<{ opened: boolean }> {
    return this.run(async () => {
      const entry = this.get(id, true);
      const extension = entry.ref.name.includes(".") ? entry.ref.name.split(".").at(-1)!.toLowerCase() : "";
      if (entry.ref.source === "context" || !RESOURCE_EXTERNAL_EXTENSIONS.includes(extension)) throw new AppError("ui/invalid-target", "Resource format is not supported for external opening");
      if (!this.adapter.openAssociated) throw new AppError("ui/unavailable", "Associated applications unavailable");
      const opened = await this.adapter.openAssociated(entry.nativeId, entry.ref.name, signal,
        () => { this.guard(signal); this.get(id, true); });
      // Once dispatched, preserve the real OS result; abort cannot recall a shared copy.
      return { opened };
    }, signal);
  }
  copyImage(id: string, signal?: AbortSignal): Promise<ResourceImageReceipt> {
    return this.run(async () => {
      const entry = this.get(id, true);
      if (entry.ref.source === "book" || entry.ref.source === "context") throw new AppError("ui/invalid-target", "Resource is not an image input");
      const receipt = await this.adapter.copyImage(entry.nativeId);
      this.guard(signal); return receipt;
    }, signal);
  }
  /** Host-rendered views and explicit model inputs. Native decoding returns a bounded, inert PNG;
   * original books stay export-only and source MIME hints are not trusted. */
  imagePreview(id: string, signal?: AbortSignal): Promise<Blob> {
    return this.run(async () => {
      const entry = this.get(id, true);
      if (entry.ref.source === "book" || entry.ref.source === "context" || !entry.ref.size || entry.ref.size > BOOK_IMAGE_MAX_BYTES) throw invalid();
      this.authorizeRead({ ...entry.ref });
      const bytes = await this.adapter.imagePreview(entry.nativeId);
      this.guard(signal); this.get(id, true); this.authorizeRead({ ...entry.ref });
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw invalid();
      return new Blob([bytes], { type: "image/png" });
    }, signal);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.lifetime.abort(new AppError("ui/superseded", "Resource owner retired"));
    for (const entry of this.entries.values()) entry.stopObserving?.();
    // Rejected queued work is already owned by its caller; cleanup must still run.
    await this.tail.catch(() => {});
    const failures: unknown[] = [];
    for (const [id, entry] of [...this.directories]) {
      clearTimeout(entry.timer);
      try { await this.removeDirectory(id); } catch (error) { failures.push(error); this.report(error); }
    }
    for (const [id, entry] of [...this.entries]) {
      clearTimeout(entry.timer);
      try { await this.remove(id); } catch (error) { failures.push(error); this.report(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Resource cleanup failed");
  }
  private async remove(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.stopObserving?.(); entry.access?.dispose();
    await this.adapter.release(entry.nativeId);
    clearTimeout(entry.timer); this.entries.delete(id);
  }
  private async cleanNative(values: NativeResource[]) {
    for (const value of values) {
      try { await this.adapter.release(value.id); } catch (error) { this.report(error); }
    }
  }
  private register(value: NativeResource, source: ResourceRef["source"], state: ResourceRef["state"], access?: ReturnType<typeof retainResourceAccess>): ResourceRef {
    const id = crypto.randomUUID(), expiresAt = this.now() + RESOURCE_LIFETIME_MS;
    const ref: ResourceRef = { id, size: value.size, name: value.name, mimeType: value.mimeType, source, state, expiresAt };
    const timer = setTimeout(() => { void this.release(id).catch(this.report); }, RESOURCE_LIFETIME_MS);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    const revoke = () => {
      // Cleanup is not actor work: queue saturation must not prevent revocation cleanup.
      const cleanup = this.tail.then(() => this.remove(id));
      this.tail = cleanup.catch(this.report);
    };
    this.entries.set(id, { nativeId: value.id, ref, timer, access,
      stopObserving: access ? () => access.signal.removeEventListener("abort", revoke) : undefined });
    access?.signal.addEventListener("abort", revoke, { once: true });
    return { ...ref };
  }
  private bytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.ref.size, 0); }
  private capacity(values: NativeResource[]) {
    if (values.some(value => !Number.isSafeInteger(value.size) || value.size < 0 || value.size > RESOURCE_MAX_SIZE)
      || values.length + this.entries.size > 16 || this.bytes() + values.reduce((n, value) => n + value.size, 0) > RESOURCE_MAX_SIZE) {
      throw new AppError("ui/unavailable", "Actor resource quota exceeded");
    }
  }
  private get(id: string, ready = false) {
    idValue(id);
    const entry = this.entries.get(id);
    if (!entry || entry.ref.expiresAt <= this.now()) throw new AppError("fs/not-found", "Resource expired or belongs to another actor");
    entry.access?.check();
    if (ready && entry.ref.state !== "ready") throw invalid();
    return entry;
  }
  private guard(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.disposed) throw new AppError("ui/superseded", "Resource owner retired");
  }
  private run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try { this.guard(signal); } catch (error) { return Promise.reject(error); }
    if (this.queued >= 32) return Promise.reject(new AppError("ui/unavailable", "Too many queued resource operations"));
    this.queued++;
    const result = this.tail.catch(() => { /* A prior failed operation must not poison the queue. */ })
      .then(() => { this.guard(signal); return work(); });
    this.tail = result.then(() => { this.queued--; }, () => { this.queued--; });
    return result;
  }
}
