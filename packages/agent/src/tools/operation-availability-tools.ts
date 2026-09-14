import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildOperationAvailabilityTools(deps: RuntimeDeps): AgentTool[] {
  return [{ name: "get_operation_availability", label: "Operation prerequisites",
    description: "Inspect prerequisites for one inference operation using the current saved connection and fast/smart model role. Explains missing permission/account/model/endpoint or unsupported image input without exposing secrets or endpoint identifiers. Does not run inference or test the remote provider. unknown remote health permits trying the operation but is not a success guarantee; execution rechecks local conditions. Currently supports llm.infer; other operations retain their own execution checks.",
    parameters: Type.Object({ operation: Type.Literal("llm.infer"),
      model: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("smart")])), images: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      const query = normalizeOperationAvailability(input);
      signal?.throwIfAborted();
      const snapshot = deps.operationAvailability ? await deps.operationAvailability.check(query, signal)
        : operationAvailability(query, [{ kind: "provider", state: "unknown", reason: "host-prerequisites-unavailable" }]);
      signal?.throwIfAborted();
      return textResult(snapshot);
    },
  }];
}
