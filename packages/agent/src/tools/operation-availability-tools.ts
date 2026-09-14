import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import type { ThreadScope } from "../thread-scope";

export function buildOperationAvailabilityTools(deps: RuntimeDeps, scope: ThreadScope): AgentTool[] {
  return [{ name: "get_operation_availability", label: "Operation prerequisites",
    description: "Inspect current prerequisites without executing: llm.infer accepts model/images; reading.playback requires bookId and action start/stop; reading.mode.configure requires bookId and active, and accepts modeKey/selectModeKey/unitId as in configure_reading_mode. Reading queries optionally bind sessionId. library.text.prepare requires bookId and accepts rebuild/priority/timeoutMs as in prepare_book_text; inspects this actor's task capacity, rebuild conflict, source/provider and missing-file retrieval conditions without loading content or downloading. All book targets stay within this tool's book scope. Returns no text, credentials or provider addresses. unknown is unverified and permits trying; execution rechecks. Other operations retain their own checks.",
    parameters: Type.Object({ operation: Type.Union([Type.Literal("llm.infer"), Type.Literal("reading.playback"), Type.Literal("reading.mode.configure"), Type.Literal("library.text.prepare")]),
      model: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("smart")])), images: Type.Optional(Type.Boolean()),
      bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("stop")])), active: Type.Optional(Type.Boolean()),
      modeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), selectModeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      unitId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      rebuild: Type.Optional(Type.Boolean()), priority: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("background")])),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 7200000 })),
    }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      const query = normalizeOperationAvailability(input);
      signal?.throwIfAborted();
      if (query.operation !== "llm.infer" && scope.kind === "book" && query.bookId !== scope.bookId) {
        return textResult(operationAvailability(query, [{ kind: "permission", state: "unavailable", reason: "book-scope-required" }]));
      }
      const snapshot = deps.operationAvailability ? await deps.operationAvailability.check(query, signal)
        : operationAvailability(query, [{ kind: "provider", state: "unknown", reason: "host-prerequisites-unavailable" }]);
      signal?.throwIfAborted();
      return textResult(snapshot);
    },
  }];
}
