import { actorCause, actorFromEvent, causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { observeSnapshot } from "../domain/snapshot-observation";
import { AppError, normalizeReaderImageRequest, type ReaderImageAction, type ReaderImageReceipt,
  type ReaderImageRequest, type ReaderImageSnapshot, type ReaderImageTransform } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { createLogger } from "../platform/logger";

type Identity = { id: string; bookId: string; sessionId: string };
type Adapter = { apply(action: ReaderImageAction, token: number, origin: DomainActor): void; close(origin: DomainActor): void };
type Binding = { identity: Identity; view: ReaderImageTransform; adapter: Adapter; dispose(origin?: DomainActor): void };
type Pending = { origin: DomainActor; binding: Binding; token: number; close: boolean; resolve(value: ReaderImageReceipt): void; reject(error: unknown): void; cleanup(): void };
const superseded = () => new AppError("reader/superseded", "The image viewer or its intent changed");

/** Controls only the user's already-open native lightbox; never resolves image URLs. */
export class ReaderImageService {
  private binding?: Binding;
  private pending?: Pending;
  private revision = 0;
  private token = 0;
  private origin: DomainActor = causalActor("system");
  private listeners = new Set<(source: object) => void>();
  constructor(private reading: Pick<ReadingSessionController, "snapshot" | "observe">,
    private report: (error: unknown) => void, private deadlineMs = 10_000) {}

  snapshot(): ReaderImageSnapshot | null {
    const b = this.binding, session = this.reading.snapshot();
    if (!b || session.status !== "ready" || session.sessionId !== b.identity.sessionId || session.bookId !== b.identity.bookId) return null;
    return stampEventCause({ ...b.identity, ...b.view, revision: this.revision }, this.origin);
  }
  observe(handler: (value: ReaderImageSnapshot | null, source: object) => unknown, origin?: DomainActor): () => void {
    if (typeof handler !== "function") throw new AppError("reader/invalid-target", "Expected image observer");
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many image observers");
    return observeSnapshot(() => this.snapshot(), notify => {
      this.listeners.add(notify); return () => { this.listeners.delete(notify); };
    }, handler, this.report, origin);
  }
  private changed(origin: DomainActor) {
    this.origin = causalActor(origin);
    const source = stampEventCause({}, this.origin), revision = ++this.revision;
    for (const listener of [...this.listeners]) {
      if (this.revision !== revision) break;
      listener(source);
    }
  }
  private cancel(error: unknown) {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.reject(error); }
  }
  bind(identity: Identity, adapter: Adapter, initial: ReaderImageTransform, origin: DomainActor = "user") {
    const session = this.reading.snapshot();
    if (session.status !== "ready" || session.sessionId !== identity.sessionId || session.bookId !== identity.bookId) throw superseded();
    origin = causalActor(origin);
    this.binding?.dispose(origin);
    const binding: Binding = { identity: { ...identity }, view: { ...initial }, adapter, dispose: () => {} };
    this.binding = binding;
    let unobserve = () => {};
    const dispose = (origin?: DomainActor) => {
      if (this.binding !== binding) return;
      this.binding = undefined; unobserve();
      const pending = this.pending;
      origin = causalActor(origin ?? pending?.origin ?? this.origin);
      if (pending?.binding === binding && pending.close && actorCause(origin) === actorCause(pending.origin)) {
        this.pending = undefined; pending.cleanup(); pending.resolve({ status: "closed", id: identity.id });
      } else this.cancel(superseded());
      this.changed(origin);
    };
    binding.dispose = dispose;
    unobserve = this.reading.observe(state => {
      if (state.status !== "ready" || state.sessionId !== identity.sessionId || state.bookId !== identity.bookId) {
        const origin = actorFromEvent(state);
        this.cancel(superseded()); dispose(origin); adapter.close(origin);
      }
    });
    if (this.binding !== binding) unobserve();
    if (this.binding === binding) this.changed(origin);
    return { dispose, publish: (view: ReaderImageTransform, token: number, origin?: DomainActor) => {
      if (this.binding !== binding) return;
      const pending = this.pending;
      origin = causalActor(origin ?? (pending?.token === token ? pending.origin : "user"));
      const changed = JSON.stringify(view) !== JSON.stringify(binding.view);
      binding.view = { ...view };
      let receipt: ReaderImageReceipt | undefined;
      if (pending?.binding === binding && !pending.close && pending.token === token) {
        if (actorCause(origin) !== actorCause(pending.origin)) this.cancel(superseded());
        else {
          this.pending = undefined; pending.cleanup();
          receipt = { status: "updated", snapshot: stampEventCause({ ...identity, ...view, revision: this.revision + (changed ? 1 : 0) }, pending.origin) };
        }
      }
      if (changed) this.changed(origin);
      if (receipt) pending!.resolve(receipt);
    } };
  }
  control(input: ReaderImageRequest, signal?: AbortSignal, origin: DomainActor = "user"): Promise<ReaderImageReceipt> {
    const request = normalizeReaderImageRequest(input);
    signal?.throwIfAborted();
    const binding = this.binding, state = this.snapshot();
    if (!binding || !state) return Promise.reject(new AppError("reader/unavailable", "No active image viewer"));
    if (state.id !== request.id) return Promise.reject(superseded());
    origin = causalActor(origin);
    this.cancel(superseded());
    return new Promise((resolve, reject) => {
      const abort = () => { if (this.pending === pending) this.cancel(signal?.reason ?? new AppError("reader/timeout", "Image viewer did not commit")); };
      const timer = setTimeout(abort, this.deadlineMs);
      const pending: Pending = { binding, origin, token: ++this.token, close: request.action === "close", resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.pending = pending; signal?.addEventListener("abort", abort, { once: true });
      try {
        if (request.action === "close") binding.adapter.close(origin);
        else binding.adapter.apply(request, pending.token, origin);
      } catch (error) { if (this.pending === pending) this.cancel(error); }
    });
  }
}
const log = createLogger("reader-image");
export const readerImage = new ReaderImageService(readingRuntime, error => log.warn("Image observer failed", error));
