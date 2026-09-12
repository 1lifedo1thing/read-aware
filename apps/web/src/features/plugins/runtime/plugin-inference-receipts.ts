import { PluginInferenceHistory, type InferenceHistoryStorage } from "./plugin-inference-history";
import { durableWrites } from "../../../platform/write-settlement";
import { AppError, errorCode, type InferenceAttemptReceipt, type InferenceRequestReceipt } from "@read-aware/core";
import type { PluginLifecycleController } from "./plugin-lifecycle";

type Entry = { receipt: InferenceRequestReceipt; cancel?: () => void };

/** A small metadata ledger independent of the cancellable ask RPC. */
export class PluginInferenceReceipts {
  private readonly entries = new Map<string, Entry>();

  private readonly history: PluginInferenceHistory;
  constructor(private readonly lifecycle: PluginLifecycleController, storage?: InferenceHistoryStorage) {
    let raw: string | null = null;
    this.history = new PluginInferenceHistory(storage ?? { key: crypto.randomUUID(), read: async () => raw, write: async value => { raw = value; }, run: work => work() }, work => {
      durableWrites.track(work); lifecycle.trackCleanup(work);
    });
  }

  private id(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new AppError("plugin/invalid-argument", "Invalid inference request ID");
    }
    return value;
  }

  async begin(id: string, cancel: () => void) {
    this.lifecycle.assertActive("services.llm.ask");
    this.id(id);
    if (this.entries.has(id) || (await this.list()).some(receipt => receipt.requestId === id)) throw new AppError("plugin/invalid-argument", "Inference request ID is already retained");
    if (this.entries.has(id)) throw new AppError("plugin/invalid-argument", "Inference request ID is already retained");
    for (const [key, entry] of this.entries) {
      if (this.entries.size < 64) break;
      if (entry.receipt.settled) this.entries.delete(key);
    }
    if (this.entries.size >= 64) throw new AppError("ai/busy", "Inference receipt capacity is occupied");
    this.lifecycle.assertActive("services.llm.ask");
    const now = new Date().toISOString();
    const entry: Entry = { cancel, receipt: { requestId: id, revision: 0, status: "running", settled: false, requestAvailable: true, interrupted: false,
      createdAt: now, updatedAt: now, errorCode: null, attempts: [] } };
    this.entries.set(id, entry);
    try { await this.history.record(entry.receipt); } catch (error) {
      entry.receipt = { ...entry.receipt, status: "failed", settled: true, errorCode: errorCode(error) ?? "db/error", revision: 1 };
      void this.history.record(entry.receipt).catch(() => {});
      this.entries.delete(id); throw error;
    }
    const change = (patch: Partial<InferenceRequestReceipt>) => {
      if (this.entries.get(id) !== entry) return Promise.resolve();
      entry.receipt = { ...entry.receipt, ...patch, revision: entry.receipt.revision + 1, updatedAt: new Date().toISOString() };
      return this.history.record(entry.receipt);
    };
    return {
      attempt: (receipt: InferenceAttemptReceipt) => { void change({ attempts: [...entry.receipt.attempts, structuredClone(receipt)] }).catch(() => {}); },
      finish: (error?: unknown) => {
        entry.cancel = undefined;
        const code = error === undefined ? null : errorCode(error) ?? "ai/unknown";
        return change({ status: code === null ? "completed" : code === "ai/request-cancelled" ? "cancelled"
          : code === "ai/request-timeout" ? "timed-out" : "failed", errorCode: code });
      },
      settle: () => change({ settled: true }),
    };
  }

  async get(id: string): Promise<InferenceRequestReceipt | null> {
    this.lifecycle.assertActive("services.llm.getRequest");
    const requestId = this.id(id);
    return (await this.list()).find(receipt => receipt.requestId === requestId) ?? null;
  }

  async list(): Promise<InferenceRequestReceipt[]> {
    this.lifecycle.assertActive("services.llm.listRequests");
    const rows = await this.history.list(id => this.entries.has(id));
    this.lifecycle.assertActive("services.llm.listRequests");
    return rows;
  }

  async cancel(id: string): Promise<InferenceRequestReceipt | null> {
    this.lifecycle.assertActive("services.llm.cancelRequest");
    const entry = this.entries.get(this.id(id));
    if (!entry) return this.get(id);
    if (entry.receipt.status === "running") entry.cancel?.();
    return this.get(id);
  }
}
