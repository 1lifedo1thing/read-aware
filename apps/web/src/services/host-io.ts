import { assertOperationConditions, type HostIOAvailabilityQuery, type OperationCondition, describeHostExport, normalizeHostExportDescription, normalizeClipboardText, normalizeExternalUrl, normalizeHostExport, type HostExportFile } from "@read-aware/core";
import { exportTextFile } from "../platform/export-file";
import { openExternalUrl } from "../platform/external-link";
import { isTauri } from "../platform/environment";
import { pluginDirectory } from "./plugin-directory";

/** Local entry checks only: never probe by copying or opening a destination. */
export function hostIOConditions(query: HostIOAvailabilityQuery): OperationCondition[] {
  if (query.operation === "ui.exportFile") {
    const { operation, ...description } = query;
    normalizeHostExportDescription(description);
    const present = isTauri() || typeof document !== "undefined" && !!document.body
      && typeof document.createElement === "function" && typeof Blob !== "undefined"
      && typeof URL.createObjectURL === "function" && typeof URL.revokeObjectURL === "function"
      && typeof window !== "undefined" && typeof window.setTimeout === "function";
    return [{ kind: "input", state: "satisfied", reason: "input-valid" },
      { kind: "provider", state: present ? "unknown" : "unavailable",
        reason: present ? "save-access-not-probed" : "export-entry-unavailable",
        ...(present ? {} : { errorCode: "ui/unavailable" }) }];
  }
  if (query.operation === "clipboard.writeText") normalizeClipboardText(query.text);
  else normalizeExternalUrl(query.url);
  const present = query.operation === "clipboard.writeText"
    ? typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function"
    : isTauri() || typeof window !== "undefined" && typeof window.open === "function";
  return [{ kind: "input", state: "satisfied", reason: "input-valid" },
    { kind: "provider", state: present ? "unknown" : "unavailable",
      reason: query.operation === "clipboard.writeText"
        ? present ? "clipboard-access-not-probed" : "clipboard-entry-unavailable"
        : present ? "browser-dispatch-not-probed" : "browser-entry-unavailable",
      ...(present ? {} : { errorCode: "ui/unavailable" }) }];
}

/** The same bounded host effects for Agent ports and permission-gated plugins. */
export const hostIO = {
  listPluginContributions: pluginDirectory.contributions,
  listPlugins: pluginDirectory.list,
  writeClipboard: async (text: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const accepted = normalizeClipboardText(text);
    assertOperationConditions(hostIOConditions({ operation: "clipboard.writeText", text: accepted }));
    await navigator.clipboard.writeText(accepted);
  },
  exportFile: (file: HostExportFile, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const accepted = normalizeHostExport(file);
    assertOperationConditions(hostIOConditions({ operation: "ui.exportFile", ...describeHostExport(accepted) }));
    return exportTextFile(accepted, signal);
  },
  openExternal: async (url: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const accepted = normalizeExternalUrl(url);
    assertOperationConditions(hostIOConditions({ operation: "ui.openExternal", url: accepted }));
    await openExternalUrl(accepted);
  },
};
