import { AppError, normalizeDeferredRequest, type PluginScheduleRun } from "@read-aware/core";
import type { PluginScheduleDeclaration } from "@read-aware/plugin-types";
import { localKV } from "../../../platform/local-store";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";
export { isScheduleDue } from "./plugin-schedule-controller";

const log = createLogger("plugin-schedules");
const stateKey = (id: string) => `read-aware-plugin.${id}.schedule-state`;
function read(pluginId: string): Record<string, ScheduleRecord> {
  if (!isTauri() && typeof localStorage === "undefined") return {};
  const raw = localKV.getItem(stateKey(pluginId));
  if (raw) {
    let records: unknown;
    try { records = JSON.parse(raw); } catch (error) { throw new AppError("db/error", "Invalid schedule JSON", { cause: error }); }
    if (!records || typeof records !== "object" || Array.isArray(records)) throw new AppError("db/error", "Invalid stored schedule state");
    for (const record of Object.values(records)) {
      if (!record || typeof record !== "object" || typeof record.paused !== "boolean"
        || ![null, "running", "succeeded", "failed", "cancelled", "interrupted"].includes(record.lastOutcome)
        || ![record.lastStartedAt, record.lastFinishedAt, record.lastSuccessAt].every(value => value === null || (Number.isFinite(value) && value >= 0 && value <= 8.64e15))
        || (record.lastErrorCode !== null && typeof record.lastErrorCode !== "string")) throw new AppError("db/error", "Invalid stored schedule record");
      if (record.deferred != null) {
        const pending = record.deferred;
        try { normalizeDeferredRequest({ requestId: pending.requestId, delayMs: pending.delayMs, when: pending.when }); }
        catch (error) { throw new AppError("db/error", "Invalid stored deferred request", { cause: error }); }
        if (typeof pending.ownerVersion !== "string" || !pending.ownerVersion || pending.ownerVersion.length > 128
          || !Number.isFinite(pending.dueAt) || pending.dueAt < 0 || pending.dueAt > 8.64e15
          || !["queued", "running", "succeeded", "failed", "cancelled", "interrupted"].includes(pending.state)
          || (pending.errorCode !== null && typeof pending.errorCode !== "string")) throw new AppError("db/error", "Invalid stored deferred state");
      }
    }
    return Object.fromEntries(Object.entries(records as Record<string, ScheduleRecord>).map(([id, record]) => [id, {
      paused: record.paused, lastStartedAt: record.lastStartedAt, lastFinishedAt: record.lastFinishedAt,
      lastSuccessAt: record.lastSuccessAt, lastOutcome: record.lastOutcome, lastErrorCode: record.lastErrorCode,
      deferred: record.deferred ? structuredClone(record.deferred) : null,
    }]));
  }
  // Legacy stamps describe attempts, never successful outcomes.
  const legacy = localKV.getItem(`read-aware-plugin.${pluginId}.schedule-runs`);
  if (!legacy) return {};
  try {
    const entries: unknown = JSON.parse(legacy);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {};
    return Object.fromEntries(Object.entries(entries).map(([id, stamp]) => [id, { paused: false,
      lastStartedAt: typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? Date.parse(stamp) : null,
      lastFinishedAt: null, lastSuccessAt: null, lastOutcome: null, lastErrorCode: null }]));
  } catch (error) { log.warn("Ignoring malformed legacy schedule stamps", error); return {}; }
}
export const pluginSchedules = new PluginScheduleController({ read,
  write: (pluginId, records) => localKV.setItemAsync(stateKey(pluginId), JSON.stringify(records)),
}, error => log.warn("Plugin schedule failed", error));
export const inspectPluginSchedules = () => pluginSchedules.inspect();

/** Reinstallation keeps settings, but must not resurrect previously queued work. */
export async function clearPluginScheduleState(pluginId: string): Promise<void> {
  await pluginSchedules.drainWrites(pluginId);
  // An explicit empty record also prevents falling back to legacy attempt stamps.
  await localKV.setItemAsync(stateKey(pluginId), "{}");
}

let first: ReturnType<typeof setTimeout> | undefined;
let loop: ReturnType<typeof setInterval> | undefined;
let lastInputAt = 0;
let removeInputListeners: (() => void) | undefined;
const sweep = () => pluginSchedules.sweep(Date.now() - lastInputAt >= 5000);
function updateLoop() {
  if (!pluginSchedules.size) {
    clearTimeout(first); clearInterval(loop); first = undefined; loop = undefined;
    removeInputListeners?.(); removeInputListeners = undefined;
  } else if (first === undefined && loop === undefined) {
    lastInputAt = Date.now();
    if (typeof window !== "undefined") {
      const events = ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;
      const input = () => { lastInputAt = Date.now(); };
      for (const event of events) window.addEventListener(event, input, { capture: true, passive: true });
      removeInputListeners = () => { for (const event of events) window.removeEventListener(event, input, true); };
    }
    first = setTimeout(() => {
      first = undefined;
      if (pluginSchedules.size) loop = setInterval(sweep, 1000);
      sweep();
    }, 1000);
  }
}
export function registerPluginSchedule(pluginId: string, declaration: PluginScheduleDeclaration, run: (context: PluginScheduleRun) => void | Promise<void>, version = "1.0.0") {
  return pluginSchedules.register(pluginId, declaration, run, version);
}

// Timers and input listeners follow the final registry after activation settles.
pluginSchedules.subscribe(updateLoop);
