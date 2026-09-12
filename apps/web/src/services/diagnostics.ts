import { verifyProjectionReport } from "../platform/projection-verification";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { HostDiagnosticsService } from "./diagnostics-controller";
import { AppError, type DiagnosticsReportAction } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";
import { workspace } from "./workspace";
import { ProjectionRepairController } from "./projection-repair-controller";

const log = createLogger("diagnostics-service");
export const hostProjectionRepairFlow = new HostActionFlow<{ action: "repair" }, "rebuilt-reload-required">({
  navigate: signal => workspace.navigate({ surface: "settings", section: "about" }, undefined, signal),
  normalize: input => {
    if (input?.action !== "repair") throw new AppError("ui/invalid-target", "Invalid projection repair action");
    return { action: "repair" };
  },
  completion: () => "rebuilt-reload-required",
});
export const hostDiagnosticsFlows = new HostActionFlow<{ action: DiagnosticsReportAction }, "exported" | "sent">({
  navigate: signal => workspace.navigate({ surface: "settings", section: "about" }, undefined, signal),
  normalize: input => {
    if (!input || !["export", "send"].includes(input.action)) throw new AppError("ui/invalid-target", "Invalid diagnostic report action");
    return { action: input.action };
  },
  completion: (action, value) => action === "send" ? "sent" : value === true ? "exported" : "cancelled",
});
export const hostDiagnostics = new HostDiagnosticsService({
  supported: isTauri,
  verify: verifyProjectionReport,
  requestProjectionRepair: signal => hostProjectionRepairFlow.request({ action: "repair" }, signal),
  requestReport: (action, signal) => hostDiagnosticsFlows.request({ action }, signal),
}, error => log.warn("Diagnostic operation failed", error));

export const projectionRepair = new ProjectionRepairController(hostProjectionRepairFlow,
  signal => hostDiagnostics.verifyProjections(signal),
  async signal => (await import("../features/settings/lib/projection-repair-apply")).applyProjectionRepair(signal),
  error => log.error("Projection repair failed", error));
