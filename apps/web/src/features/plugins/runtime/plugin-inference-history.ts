import { AppError, type InferenceAttemptReceipt, type InferenceRequestReceipt } from "@read-aware/core";

export type InferenceHistoryStorage = {
  key: string;
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
};
type Entry = { generation: string; sequence: number; receipt: InferenceRequestReceipt };
const tails = new Map<string, Promise<void>>();
const MAX_BYTES = 512 * 1024;
const invalid = () => new AppError("db/error", "Inference history is invalid");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function attempt(value: unknown): InferenceAttemptReceipt {
  if (!object(value) || !object(value.model) || !string(value.model.id, 512) || !string(value.model.provider, 128)
    || !["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(String(value.stopReason))
    || value.maxOutputTokens !== null && !integer(value.maxOutputTokens)
    || value.estimatedCostUsd !== null && (typeof value.estimatedCostUsd !== "number" || !Number.isFinite(value.estimatedCostUsd) || value.estimatedCostUsd < 0)) throw invalid();
  const raw = value.usage;
  let usage: InferenceAttemptReceipt["usage"] = null;
  if (raw !== null) {
    if (!object(raw)) throw invalid();
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) if (raw[key] !== null && !integer(raw[key])) throw invalid();
    usage = { input: raw.input, output: raw.output, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite, reasoning: raw.reasoning, totalTokens: raw.totalTokens } as NonNullable<InferenceAttemptReceipt["usage"]>;
  }
  return { model: { id: value.model.id, provider: value.model.provider }, stopReason: value.stopReason as InferenceAttemptReceipt["stopReason"],
    maxOutputTokens: value.maxOutputTokens as number | null, usage, estimatedCostUsd: value.estimatedCostUsd as number | null };
}
function parse(raw: string | null): Entry[] {
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw invalid();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 64) throw invalid();
  const ids = new Set<string>();
  return Array.from(value.entries, entry => {
    if (!object(entry) || !string(entry.generation, 80) || !integer(entry.sequence) || !object(entry.receipt)) throw invalid();
    const r = entry.receipt;
    if (!string(r.requestId, 64) || !/^[A-Za-z0-9_-]+$/.test(r.requestId) || ids.has(r.requestId) || !integer(r.revision)
      || !["running", "completed", "failed", "cancelled", "timed-out"].includes(String(r.status)) || typeof r.settled !== "boolean"
      || !string(r.createdAt, 40) || !Number.isFinite(Date.parse(r.createdAt)) || !string(r.updatedAt, 40) || !Number.isFinite(Date.parse(r.updatedAt))
      || r.errorCode !== null && (!string(r.errorCode, 200) || !/^[a-z][a-z0-9/-]*$/.test(r.errorCode))
      || !Array.isArray(r.attempts) || r.attempts.length > 4) throw invalid();
    ids.add(r.requestId);
    return { generation: entry.generation, sequence: entry.sequence, receipt: { requestId: r.requestId, revision: r.revision,
      status: r.status as InferenceRequestReceipt["status"], settled: r.settled, createdAt: r.createdAt, updatedAt: r.updatedAt,
      errorCode: r.errorCode as string | null, attempts: r.attempts.map(attempt), requestAvailable: false, interrupted: false } };
  });
}

/** Metadata only; hidden owner storage participates in existing backup/rollback/uninstall. */
export class PluginInferenceHistory {
  readonly generation = crypto.randomUUID();
  private readonly dirty = new Map<string, Entry>();
  constructor(private readonly storage: InferenceHistoryStorage, private readonly track: (work: Promise<void>) => void) {}
  record(receipt: InferenceRequestReceipt): Promise<void> {
    const entry = parse(JSON.stringify({ version: 1, entries: [{ generation: this.generation, sequence: 0, receipt }] }))[0];
    this.dirty.set(receipt.requestId, entry);
    return this.flush();
  }
  private flush(): Promise<void> {
    if (!this.dirty.size) return Promise.resolve();
    const work = (tails.get(this.storage.key) ?? Promise.resolve()).catch(() => {}).then(() => this.storage.run(async () => {
      const pending = new Map(this.dirty);
      if (!pending.size) return;
      const entries = new Map(parse(await this.storage.read()).map(entry => [entry.receipt.requestId, entry]));
      let sequence = Math.max(0, ...[...entries.values()].map(entry => entry.sequence));
      for (const [id, entry] of pending) {
        const previous = entries.get(id);
        // An evicted name may have been reused by a later activation. A late
        // old callback cannot replace that activation's receipt.
        if (previous && previous.generation !== entry.generation) continue;
        entries.set(id, { ...entry, sequence: previous?.sequence ?? ++sequence });
      }
      if (!Number.isSafeInteger(sequence)) throw invalid();
      const sorted = [...entries.values()].sort((a, b) => b.sequence - a.sequence);
      const active = sorted.filter(entry => entry.generation === this.generation && !entry.receipt.settled);
      const retained = [...active, ...sorted.filter(entry => !active.includes(entry))].slice(0, 64);
      const raw = JSON.stringify({ version: 1, entries: retained });
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw invalid();
      await this.storage.write(raw);
      for (const [id, entry] of pending) if (this.dirty.get(id) === entry) this.dirty.delete(id);
    }));
    tails.set(this.storage.key, work);
    void work.finally(() => { if (tails.get(this.storage.key) === work) tails.delete(this.storage.key); }).catch(() => {});
    this.track(work); return work;
  }
  async list(hasRequest: (id: string) => boolean): Promise<InferenceRequestReceipt[]> {
    await this.flush(); await tails.get(this.storage.key);
    return parse(await this.storage.read()).map(entry => {
      const requestAvailable = entry.generation === this.generation && hasRequest(entry.receipt.requestId);
      return { ...entry.receipt, requestAvailable, interrupted: !requestAvailable && !entry.receipt.settled };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId));
  }
}
