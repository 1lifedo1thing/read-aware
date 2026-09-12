/** Host-only retry of durable restore obligations. Native code reads/seals the
 * current credential, appends its event and retires the marker atomically. */
import { errorCode, type HlcStamp } from "@read-aware/core";
import { invoke } from "./ipc";
import { isTauri } from "./environment";
import { afterSecretWrites, getDurableSecret } from "./secret-store";
import { broadcastDomainEventDrafts, mintEventRows, observeRemoteHlcStamps, type DomainEventDraft } from "./domain-events";
import { durableWrites } from "./write-settlement";

type DeviceInfo = { deviceId: string; lastHlcWallMs: number | null; lastHlcCounter: number | null };
type Report = { events: (DomainEventDraft & { hlc: HlcStamp })[]; awaitingConnection: boolean };
let active: Promise<void> | null = null;
export function flushRestoredCredentialPublications(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (active) return active;
  active = afterSecretWrites(async () => {
    if (!getDurableSecret("sync.master-key")) return;
    let conflicts = 0;
    while (true) {
      const slots = await invoke<string[]>("restored_credentials_pending");
      if (slots.length === 0) return;
      // Native restore/other transactions can have advanced the frontier since
      // this webview's cached device seed. Mint after the current persisted head.
      const device = await invoke<DeviceInfo>("local_device_get");
      if (device.lastHlcWallMs !== null) observeRemoteHlcStamps([{
        wallMs: device.lastHlcWallMs, counter: device.lastHlcCounter ?? 0, deviceId: device.deviceId,
      }]);
      const events = await mintEventRows(slots.map(slot => ({
        type: "preference.changed", origin: "system", payload: { key: `secret:${slot}`, value: null },
      })));
      try {
        const report = await durableWrites.track(invoke<Report>("restored_credentials_publish", { events }));
        if (report.awaitingConnection) return;
        broadcastDomainEventDrafts(report.events);
        conflicts = 0;
      } catch (error) {
        if (errorCode(error) === "backup/changed" && ++conflicts < 3) continue;
        throw error; // Caller logs/surfaces; native pending markers remain.
      }
    }
  }).finally(() => { active = null; });
  return active;
}
