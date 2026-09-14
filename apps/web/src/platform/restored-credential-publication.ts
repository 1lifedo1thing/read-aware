/** Host-only retry of durable local-write and restore obligations. Native code reads/seals the
 * current credential, appends its event and retires the marker atomically. */
import { restoreActorSource, type DurableActorSource } from "./domain-actor";
import { errorCode, type HlcStamp } from "@read-aware/core";
import { invoke } from "./ipc";
import { isTauri } from "./environment";
import { afterSecretWrites, getDurableSecret } from "./secret-store";
import { broadcastDomainEventDrafts, mintEventRowsAfterCurrentFrontier, type DomainEventDraft } from "./domain-events";
import { runDomainWrite } from "./domain-write-gate";

type Report = { events: (DomainEventDraft & { id: string; hlc: HlcStamp })[]; sources?: Record<string, DurableActorSource>; awaitingConnection: boolean };
let active: Promise<void> | null = null;
export function flushRestoredCredentialPublications(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  if (active) return active;
  active = runDomainWrite(() => afterSecretWrites(async () => {
    if (!getDurableSecret("sync.master-key")) return;
    let conflicts = 0;
    while (true) {
      const slots = await invoke<string[]>("restored_credentials_pending");
      if (slots.length === 0) return;
      // Native restore/other transactions can have advanced the frontier since
      // this webview's cached device seed. Mint after the current persisted head.
      const events = await mintEventRowsAfterCurrentFrontier(slots.map(slot => ({
        type: "preference.changed", origin: "system", payload: { key: `secret:${slot}`, value: null },
      })));
      try {
        const report = await invoke<Report>("restored_credentials_publish", { events });
        if (report.awaitingConnection) return;
        broadcastDomainEventDrafts(report.events.map(event => ({ ...event,
          origin: report.sources?.[event.id] ? restoreActorSource("system", report.sources[event.id]) : event.origin,
        })));
        conflicts = 0;
      } catch (error) {
        if (errorCode(error) === "backup/changed" && ++conflicts < 3) continue;
        throw error; // Caller logs/surfaces; native pending markers remain.
      }
    }
  })).finally(() => { active = null; });
  return active;
}
