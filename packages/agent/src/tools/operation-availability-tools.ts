import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import type { ThreadScope } from "../thread-scope";

export function buildOperationAvailabilityTools(deps: RuntimeDeps, scope: ThreadScope): AgentTool[] {
  return [{ name: "get_operation_availability", label: "Operation prerequisites",
    description: "Inspect current prerequisites without executing: llm.infer accepts model/images; reading.playback requires bookId and action start/stop; reading.mode.configure requires bookId and active, and accepts modeKey/selectModeKey/unitId as in configure_reading_mode. Reading queries optionally bind sessionId and stay within this tool's book scope. Explains permissions, object/readiness and provider conditions without returning text, credentials or provider addresses. unknown means execution is unverified and permits trying; actual calls recheck. Other operations retain their own execution checks.",
    parameters: Type.Object({ operation: Type.Union([Type.Literal("llm.infer"), Type.Literal("reading.playback"), Type.Literal("reading.mode.configure")]),
      model: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("smart")])), images: Type.Optional(Type.Boolean()),
      bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("stop")])), active: Type.Optional(Type.Boolean()),
      modeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), selectModeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      unitId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
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
