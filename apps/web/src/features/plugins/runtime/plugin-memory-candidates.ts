import type { ExternalMemoryCandidate, ExternalMemoryCandidateRequest } from "@read-aware/agent";
import { AppError, type MemoryCandidateOutcome, type MemoryCandidateReceipt } from "@read-aware/core";
import { createLogger } from "../../../platform/logger";
import type { RegisteredMemoryCandidateProvider } from "../lib/plugin-types";
import { getRegisteredMemoryCandidateProviders } from "../state/plugin-store";
import { pluginCallbackOwner } from "./plugin-callback-wire";
import { consumePluginResult } from "./plugin-result";
import { pluginObjectAccessDenied } from "../../../domain/plugin-object-access";

const log = createLogger("plugin-memory-candidates");
const MAX_CANDIDATES = 3;

export async function proposePluginMemories(provider: RegisteredMemoryCandidateProvider,
  request: ExternalMemoryCandidateRequest): Promise<ExternalMemoryCandidate[]> {
  const active = () => !pluginCallbackOwner(provider.propose)?.aborted && getRegisteredMemoryCandidateProviders().includes(provider);
  if (!active() || request.signal?.aborted) return [];
  if (provider.bookAccess) {
    if (request.scope.kind !== "book") throw pluginObjectAccessDenied("memory candidate provider global scope");
    provider.assertBookAccess?.(request.scope.bookId);
  }
  const requestId = crypto.randomUUID();
  return consumePluginResult(provider.propose({ requestId,
    scope: request.scope.kind === "book" ? { kind: "book", bookId: request.scope.bookId } : { kind: "global", threadId: request.scope.threadId },
    userText: request.userText, assistantText: request.assistantText }), proposals => {
    if (!active()) return [];
    if (provider.bookAccess && request.scope.kind === "book") provider.assertBookAccess?.(request.scope.bookId);
    if (!Array.isArray(proposals)) throw new AppError("plugin/invalid-input", "Memory provider did not return a list");
    const count = Math.min(MAX_CANDIDATES, proposals.length);
    const discarded = Math.max(0, proposals.length - count);
    const results = new Map<number, MemoryCandidateOutcome>();
    const publish = () => {
      if (!active() || !provider.onResult) return;
      const receipt: MemoryCandidateReceipt = { requestId, discarded,
        results: [...results].sort(([a], [b]) => a - b).map(([index, outcome]) => ({ index, outcome })) };
      // Delivery is independent of the memory transaction and cannot stall it.
      void Promise.resolve().then(() => active() ? consumePluginResult(provider.onResult?.(receipt), () => undefined) : undefined)
        .catch(error => log.warn("Plugin memory result delivery failed", error));
    };
    const report = (index: number, outcome: MemoryCandidateOutcome) => {
      if (results.has(index)) return;
      results.set(index, outcome);
      if (results.size === count) publish();
    };
    if (!count) publish();
    return Array.from(proposals.slice(0, count)).flatMap((candidate, index): ExternalMemoryCandidate[] => {
      if (!candidate || typeof candidate !== "object" || typeof candidate.content !== "string"
        || !["fact", "preference", "insight", "summary"].includes(candidate.kind)) {
        report(index, { status: "rejected", reason: "invalid" }); return [];
      }
      const scope = candidate.scope === "book" && request.scope.kind === "book" ? `book:${request.scope.bookId}` as const
        : candidate.scope === "user" || candidate.scope === "global" ? candidate.scope : null;
      if (!scope) { report(index, { status: "rejected", reason: "scope" }); return []; }
      if (request.signal?.aborted) { report(index, { status: "skipped", reason: "cancelled" }); return []; }
      return [{ scope, kind: candidate.kind, content: candidate.content, available: active,
        report: outcome => report(index, outcome) }];
    });
  });
}
