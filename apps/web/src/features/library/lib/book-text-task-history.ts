import { AppError, type BookTextTaskHistoryPage, type BookTextTaskHistoryQuery, type BookTextTaskSnapshot } from "@read-aware/core";

type RecordEntry = { generation: string; recordedAt: string; snapshot: BookTextTaskSnapshot };
export type TextHistoryStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
};
const MAX_BYTES = 512 * 1024, MAX_RECORDS = 64;
const tails = new Map<string, Promise<unknown>>();
const active = (value: BookTextTaskSnapshot) => ["queued", "running", "paused"].includes(value.status);
const invalid = () => new AppError("db/error", "Text task history is invalid");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const date = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));

/** Never forward arbitrary backup/plugin JSON into an Agent history response. */
function parse(raw: string | null): RecordEntry[] {
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw invalid();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_RECORDS) throw invalid();
  const ids = new Set<string>();
  return value.entries.map(entry => {
    if (!object(entry) || !text(entry.generation, 80) || !date(entry.recordedAt) || !object(entry.snapshot)) throw invalid();
    const task = entry.snapshot, state = task.textState;
    if (!text(task.taskId, 80) || ids.has(task.taskId) || !text(task.bookId, 256)
      || typeof task.mode !== "string" || !["prepare", "rebuild"].includes(task.mode) || typeof task.priority !== "string" || !["normal", "background"].includes(task.priority)
      || typeof task.status !== "string" || !["queued", "running", "paused", "completed", "failed", "cancelled"].includes(task.status)
      || !integer(task.revision) || !integer(task.timeoutMs) || task.timeoutMs < 1000 || task.timeoutMs > 7200000
      || !date(task.createdAt) || !date(task.updatedAt) || !date(task.deadlineAt)
      || task.waitReason !== null && task.waitReason !== "reader" && task.waitReason !== "queue"
      || task.errorCode !== undefined && !text(task.errorCode, 200) || !object(state) || state.bookId !== task.bookId
      || state.contentVersion !== null && !text(state.contentVersion, 200)
      || typeof state.status !== "string" || !["unprepared", "preparing", "ready", "partial", "unsupported", "unavailable", "error"].includes(state.status)
      || typeof state.text !== "string" || !["unknown", "available", "textless"].includes(state.text) || !integer(state.chapterCount)
      || state.errorCode !== undefined && !text(state.errorCode, 200)) throw invalid();
    const progress = state.progress;
    if (progress !== null && (!object(progress) || !integer(progress.total) || !integer(progress.completed)
      || !integer(progress.failed) || !integer(progress.unsupported))) throw invalid();
    ids.add(task.taskId);
    // The type assertion follows field checks; copy only the fixed public shape.
    const snapshot = { taskId: task.taskId, bookId: task.bookId, mode: task.mode, priority: task.priority,
      status: task.status, revision: task.revision, timeoutMs: task.timeoutMs, deadlineAt: task.deadlineAt,
      createdAt: task.createdAt, updatedAt: task.updatedAt, waitReason: task.waitReason,
      ...(task.errorCode === undefined ? {} : { errorCode: task.errorCode }),
      textState: { bookId: state.bookId, contentVersion: state.contentVersion, status: state.status, text: state.text,
        chapterCount: state.chapterCount, progress: progress === null ? null : {
          total: progress.total, completed: progress.completed, failed: progress.failed, unsupported: progress.unsupported },
        ...(state.errorCode === undefined ? {} : { errorCode: state.errorCode }) } } as BookTextTaskSnapshot;
    return { generation: entry.generation, recordedAt: entry.recordedAt, snapshot };
  });
}

/** Bounded metadata journal over existing owned storage, not a restartable worker. */
export class BookTextTaskHistory {
  readonly generation = crypto.randomUUID();
  private readonly dirty = new Map<string, RecordEntry>();
  constructor(private readonly key: string, private readonly storage: TextHistoryStorage,
    private readonly track: (work: Promise<void>) => void = () => {}) {}

  record(snapshot: BookTextTaskSnapshot): Promise<void> {
    const entry = { generation: this.generation, recordedAt: new Date().toISOString(), snapshot: structuredClone(snapshot) };
    // Apply identical validation to own writes and restored data.
    parse(JSON.stringify({ version: 1, entries: [entry] }));
    this.dirty.set(snapshot.taskId, entry);
    return this.flush();
  }

  private flush(): Promise<void> {
    if (!this.dirty.size) return Promise.resolve();
    const prior = tails.get(this.key) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(() => this.storage.run(async () => {
      if (!this.dirty.size) return;
      const pending = new Map(this.dirty);
      const entries = new Map(parse(await this.storage.read()).map(entry => [entry.snapshot.taskId, entry]));
      for (const [id, entry] of pending) entries.set(id, entry);
      const sorted = [...entries.values()].sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || b.snapshot.taskId.localeCompare(a.snapshot.taskId));
      const live = sorted.filter(entry => entry.generation === this.generation && active(entry.snapshot));
      const retained = [...live, ...sorted.filter(entry => !live.includes(entry))].slice(0, MAX_RECORDS);
      const raw = JSON.stringify({ version: 1, entries: retained });
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw invalid();
      await this.storage.write(raw);
      for (const [id, entry] of pending) if (this.dirty.get(id) === entry) this.dirty.delete(id);
    }));
    tails.set(this.key, work);
    void work.finally(() => { if (tails.get(this.key) === work) tails.delete(this.key); }).catch(() => {});
    this.track(work); return work;
  }

  async list(bookId: string, query: BookTextTaskHistoryQuery = {}, hasRequest: (id: string) => boolean): Promise<BookTextTaskHistoryPage> {
    if (!text(bookId, 256) || !object(query) || Object.keys(query).some(key => key !== "offset" && key !== "limit")) {
      throw new AppError("library/invalid-input", "Invalid task history query");
    }
    const offset = query.offset === undefined ? 0 : query.offset, limit = query.limit === undefined ? 20 : query.limit;
    if (!integer(offset) || offset > MAX_RECORDS || !integer(limit) || limit < 1 || limit > 20) throw new AppError("library/invalid-input", "Invalid task history page");
    // Wait for real receipts. A failed metadata write stays dirty; an explicit
    // history read retries it and otherwise reports the failure, never empty success.
    await this.flush(); await tails.get(this.key);
    const entries = parse(await this.storage.read()).filter(entry => entry.snapshot.bookId === bookId)
      .sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || b.snapshot.taskId.localeCompare(a.snapshot.taskId));
    return { items: entries.slice(offset, offset + limit).map(entry => {
      const requestAvailable = entry.generation === this.generation && hasRequest(entry.snapshot.taskId);
      return { snapshot: entry.snapshot, recordedAt: entry.recordedAt, requestAvailable, interrupted: !requestAvailable && active(entry.snapshot) };
    }), total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null, retainedLimit: MAX_RECORDS };
  }
}
