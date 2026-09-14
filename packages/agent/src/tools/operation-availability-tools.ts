import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { HOST_COMMAND_IDS, normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import { threadScopeKey, type ThreadScope } from "../thread-scope";

export function buildOperationAvailabilityTools(deps: RuntimeDeps, scope: ThreadScope): AgentTool[] {
  return [{ name: "get_operation_availability", label: "Operation prerequisites",
    description: "Inspect current prerequisites without executing: resources.save and resources.openAssociated require resourceId owned by this conversation; save optionally accepts filename. Checks sealing, authorization and host entry without saving or opening. Destination or associated app remains unverified. schedules.control requires schedule {pluginId,id,action:pause/resume/run}; global scope only, checks binding, persistence and execution capacity without running a callback. Paused schedules can still run manually. settings.refreshModelCatalog requires provider; checks public catalog support and shared refresh status, without credentials or a network probe. llm.infer accepts model/images; reading.playback requires bookId and action start/stop; reading.mode.configure requires bookId and active, and accepts modeKey/selectModeKey/unitId as in configure_reading_mode. Reading queries optionally bind sessionId. library.text.prepare requires bookId and accepts rebuild/priority/timeoutMs as in prepare_book_text; inspects this actor's task capacity, rebuild conflict, source/provider and missing-file retrieval conditions without loading content or downloading. All book targets stay within this tool's book scope. Returns no text, credentials or provider addresses. unknown is unverified and permits trying; execution rechecks. sync.now takes no other fields and checks local sync connection, credentials and registered transport without connecting or probing. memory.graph.generate requires bookId and mode catch-up/rebuild, with optional maxChapters; checks actor capacity, persisted chapter boundary and fast model without extraction, classification or inference. window.control requires a nested request with action minimize/maximize/restore, or action fullscreen and enabled boolean; inspects desktop support, queue and current target state without changing the window. clipboard.writeText requires text; ui.openExternal requires url. These validate bounded inputs and local entry availability without copying, opening or probing. ui.exportFile requires filename and byteLength (UTF-8 size for text, at most 64 MiB), with optional mimeType; inspects metadata and save entry without content, temporary files or a dialog. OS access remains unknown until execution. plugins.callService requires serviceCall with a discovered service reference, optional bookId and JSON input. Checks contract, shared authority and capacity without invoking or requesting approval; Agent calls still require separate user approval. ui.commands.execute requires command matching execute_host_command; inspects permissions, workspace revision and selection limits without saving or navigation. Target loading and UI commit remain unverified. maintenance.checkForUpdates takes no other fields and checks native updater support and the shared check/install lock without contacting the update server. diagnostics.verifyProjections takes no other fields and checks native support and shared replay admission without replaying data; log completeness remains unknown until execution. Host flow queries: maintenance.requestBackup requires action import/export; diagnostics.requestReport requires action export/send; maintenance.requestConnectionTest and diagnostics.requestProjectionRepair take no other fields. Inspect desktop support and flow occupancy without navigation, backup, reporting, inference or repair. Native controls and user confirmation remain unknown; querying grants no confirmation authority. sync.requestFlow requires flow with action connect/disconnect/delete-account/upgrade/billing and optional transportRef for connect only. Checks local account/backend, registered transport, flow occupancy and purchase availability without requesting a flow. Remote status and native controls remain unverified. Other operations retain their own checks.",
    parameters: Type.Object({ operation: Type.Union([Type.Literal("resources.save"), Type.Literal("resources.openAssociated"), Type.Literal("schedules.control"), Type.Literal("settings.refreshModelCatalog"), Type.Literal("llm.infer"), Type.Literal("reading.playback"), Type.Literal("reading.mode.configure"), Type.Literal("library.text.prepare"), Type.Literal("sync.now"), Type.Literal("sync.requestFlow"), Type.Literal("maintenance.checkForUpdates"), Type.Literal("diagnostics.verifyProjections"), Type.Literal("maintenance.requestBackup"), Type.Literal("maintenance.requestConnectionTest"), Type.Literal("diagnostics.requestReport"), Type.Literal("diagnostics.requestProjectionRepair"), Type.Literal("memory.graph.generate"), Type.Literal("window.control"), Type.Literal("clipboard.writeText"), Type.Literal("ui.openExternal"), Type.Literal("ui.exportFile"), Type.Literal("plugins.callService"), Type.Literal("ui.commands.execute")]),
      resourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      schedule: Type.Optional(Type.Object({ pluginId: Type.String({ minLength: 1, maxLength: 256 }), id: Type.String({ minLength: 1, maxLength: 256 }), action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("run")]) }, { additionalProperties: false })),
      provider: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      flow: Type.Optional(Type.Object({ action: Type.Union([Type.Literal("connect"), Type.Literal("disconnect"), Type.Literal("delete-account"), Type.Literal("upgrade"), Type.Literal("billing")]), transportRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false })),
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
      action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("import"), Type.Literal("export"), Type.Literal("send")])), active: Type.Optional(Type.Boolean()),
      modeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })), selectModeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      unitId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      rebuild: Type.Optional(Type.Boolean()), priority: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("background")])),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 7200000 })),
    }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      const query = normalizeOperationAvailability(input);
      signal?.throwIfAborted();
      if (scope.kind === "book" && query.operation === "schedules.control") return textResult(operationAvailability(query, [
        { kind: "permission", state: "unavailable", reason: "global-scope-required" },
      ]));
      if (query.operation === "resources.save" || query.operation === "resources.openAssociated") {
        const conditions = await deps.resources(threadScopeKey(scope), scope.kind === "book" ? scope.bookId : undefined).conditions(query, signal);
        signal?.throwIfAborted(); return textResult(operationAvailability(query, conditions));
      }
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
