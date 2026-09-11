import type { Api, Model } from "@earendil-works/pi-ai";
import { IDENTITY_WORK_LIMITS, type IdentityConsolidationSnapshot, type IdentityWorkPage } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { identityBytes } from "./identity-input";
import { SOURCE_BYTES, DIGEST_BYTES, invalid, record } from "./identity-batch-state";

export class WorkPaused extends Error {}
/** One mutation journal and call allowance shared by source reduction and registry selection. */
export function createIdentityWorkRun(input: {
  snapshot: IdentityConsolidationSnapshot; deps: RuntimeDeps; complete: CompleteFn; model: Model<Api>;
  maxTokens: number; signal?: AbortSignal; header: IdentityWorkPage; checkpoint(): string;
}) {
  const { snapshot, deps, signal, header } = input;
  let pageIndex = header.baseIndex, baseIndex = header.baseIndex, tail = header.pageCount, calls = 0;
  const checkpoint = async () => {
    // Migrate immutable v1 pages by consuming their suffix before pruning it.
    if (pageIndex !== tail) return;
    const receipt = await deps.identityConsolidation.work.compact({ expectedRevision: snapshot.revision,
      expectedPageCount: pageIndex, json: input.checkpoint() }, signal);
    if (receipt.revision !== snapshot.revision || receipt.pageCount !== pageIndex) return invalid();
    baseIndex = pageIndex;
  };
  const node = async <T>(body: unknown, prompt: string, validate: (value: unknown) => T, maxBytes = SOURCE_BYTES): Promise<T> => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(pageIndex) || pageIndex >= Number.MAX_SAFE_INTEGER) return invalid();
    const json = JSON.stringify(body);
    if (identityBytes(json) > maxBytes) return invalid();
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
    const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const query = { expectedRevision: snapshot.revision, index: pageIndex };
    const stored = pageIndex === 0 ? header : await deps.identityConsolidation.work.read(query, signal);
    if (stored.revision !== snapshot.revision || stored.index !== pageIndex || !Number.isSafeInteger(stored.pageCount)
      || stored.baseIndex !== baseIndex || stored.pageCount < pageIndex || stored.pageCount - baseIndex > IDENTITY_WORK_LIMITS.maxPages
      || (stored.json === null) !== (pageIndex >= stored.pageCount)) return invalid();
    tail = stored.pageCount;
    let result: T;
    if (stored.json !== null) {
      const parsed: unknown = JSON.parse(stored.json);
      if (!record(parsed) || Object.keys(parsed).length !== 3 || parsed.version !== 1 || parsed.key !== key) return invalid();
      result = validate(parsed.digest);
    } else {
      if (calls >= 4) throw new WorkPaused("resumable identity work checkpointed for the next maintenance pass");
      calls++;
      const response = await input.complete(input.model, { systemPrompt: prompt,
        messages: [{ role: "user", content: json, timestamp: Date.now() }] }, { signal, maxTokens: input.maxTokens });
      signal?.throwIfAborted();
      if (response.stopReason !== "stop" || response.content.some(part => part.type === "toolCall")) return invalid();
      const text = response.content.filter(part => part.type === "text").map(part => part.text).join("");
      if (identityBytes(text) > DIGEST_BYTES) return invalid();
      result = validate(JSON.parse(text));
      const receipt = await deps.identityConsolidation.work.append({ ...query, json: JSON.stringify({ version: 1, key, digest: result }) }, signal);
      if (receipt.revision !== snapshot.revision || !Number.isSafeInteger(receipt.pageCount) || receipt.pageCount < pageIndex + 1) return invalid();
      tail = receipt.pageCount;
    }
    pageIndex++;
    return result;
  };
  return { node, checkpoint, calls: () => calls };
}
