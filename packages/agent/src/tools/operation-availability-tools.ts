import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { HOST_COMMAND_IDS, normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import type { ThreadScope } from "../thread-scope";

export function buildOperationAvailabilityTools(deps: RuntimeDeps, scope: ThreadScope): AgentTool[] {
  return [{ name: "get_operation_availability", label: "Operation prerequisites",
    description: "Inspect current prerequisites without executing: llm.infer accepts model/images; reading.playback requires bookId and action start/stop; reading.mode.configure requires bookId and active, and accepts modeKey/selectModeKey/unitId as in configure_reading_mode. Reading queries optionally bind sessionId. library.text.prepare requires bookId and accepts rebuild/priority/timeoutMs as in prepare_book_text; inspects this actor's task capacity, rebuild conflict, source/provider and missing-file retrieval conditions without loading content or downloading. All book targets stay within this tool's book scope. Returns no text, credentials or provider addresses. unknown is unverified and permits trying; execution rechecks. sync.now takes no other fields and checks local sync connection, credentials and registered transport without connecting or probing. memory.graph.generate requires bookId and mode catch-up/rebuild, with optional maxChapters; checks actor capacity, persisted chapter boundary and fast model without extraction, classification or inference. window.control requires a nested request with action minimize/maximize/restore, or action fullscreen and enabled boolean; inspects desktop support, queue and current target state without changing the window. clipboard.writeText requires text; ui.openExternal requires url. These validate bounded inputs and local entry availability without copying, opening or probing. ui.exportFile requires filename and byteLength (UTF-8 size for text, at most 64 MiB), with optional mimeType; inspects metadata and save entry without content, temporary files or a dialog. OS access remains unknown until execution. plugins.callService requires serviceCall with a discovered service reference, optional bookId and JSON input. Checks contract, shared authority and capacity without invoking or requesting approval; Agent calls still require separate user approval. ui.commands.execute requires command matching execute_host_command; inspects permissions, workspace revision and selection limits without saving or navigation. Target loading and UI commit remain unverified. maintenance.checkForUpdates takes no other fields and checks native updater support and the shared check/install lock without contacting the update server. Other operations retain their own checks.",
    parameters: Type.Object({ operation: Type.Union([Type.Literal("llm.infer"), Type.Literal("reading.playback"), Type.Literal("reading.mode.configure"), Type.Literal("library.text.prepare"), Type.Literal("sync.now"), Type.Literal("maintenance.checkForUpdates"), Type.Literal("memory.graph.generate"), Type.Literal("window.control"), Type.Literal("clipboard.writeText"), Type.Literal("ui.openExternal"), Type.Literal("ui.exportFile"), Type.Literal("plugins.callService"), Type.Literal("ui.commands.execute")]),
      command: Type.Optional(Type.Object({ id: Type.Union(HOST_COMMAND_IDS.map(id => Type.Literal(id))),
        args: Type.Optional(Type.Object({ bookId: Type.Optional(Type.String({ maxLength: 256 })), collectionId: Type.Optional(Type.String({ maxLength: 256 })) }, { additionalProperties: false })),
        expectedWorkspaceRevision: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false })),
      serviceCall: Type.Optional(Type.Object({ service: Type.Object({ pluginId: Type.String({ maxLength: 64 }), id: Type.String({ maxLength: 64 }), version: Type.String({ maxLength: 128 }), generation: Type.String({ maxLength: 80 }) }, { additionalProperties: false }),
        bookId: Type.Optional(Type.String({ maxLength: 256 })), input: Type.Unknown() }, { additionalProperties: false })),
      filename: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), byteLength: Type.Optional(Type.Integer({ minimum: 0, maximum: 67108864 })), mimeType: Type.Optional(Type.String({ maxLength: 256 })),
      text: Type.Optional(Type.String({ maxLength: 1_000_000 })), url: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
      request: Type.Optional(Type.Union([
        Type.Object({ action: Type.Union([Type.Literal("minimize"), Type.Literal("maximize"), Type.Literal("restore")]) }, { additionalProperties: false }),
        Type.Object({ action: Type.Literal("fullscreen"), enabled: Type.Boolean() }, { additionalProperties: false }),
      ])),
      mode: Type.Optional(Type.Union([Type.Literal("catch-up"), Type.Literal("rebuild")])), maxChapters: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
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
      const targetBook = query.operation === "plugins.callService" ? query.serviceCall.bookId : "bookId" in query ? query.bookId : undefined;
      if (scope.kind === "book" && (("bookId" in query || query.operation === "plugins.callService") && targetBook !== scope.bookId)) {
        return textResult(operationAvailability(query, [{ kind: "permission", state: "unavailable", reason: "book-scope-required" }]));
      }
      const snapshot = deps.operationAvailability ? await deps.operationAvailability.check(query, signal)
        : operationAvailability(query, [{ kind: "provider", state: "unknown", reason: "host-prerequisites-unavailable" }]);
      signal?.throwIfAborted();
      return textResult(snapshot);
    },
  }];
}
