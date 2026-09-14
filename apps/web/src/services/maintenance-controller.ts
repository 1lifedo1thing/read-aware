import { observeSnapshot } from "../domain/snapshot-observation";
import { causalActor, copyEventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { AppError, HOST_MAINTENANCE_SURFACES, type HostMaintenancePort, type HostMaintenanceSnapshot, type HostMaintenanceSurface, type WorkspaceSettingsSection } from "@read-aware/core";

export function maintenanceSection(surface: HostMaintenanceSurface): WorkspaceSettingsSection {
  if (!HOST_MAINTENANCE_SURFACES.includes(surface)) throw new AppError("ui/invalid-target", "Unknown maintenance surface");
  if (surface === "plugins") return "plugins";
  if (surface === "ai-connection") return "ai";
  if (surface === "backup-import" || surface === "backup-export" || surface === "delete-data" || surface === "data-location") return "dataSync";
  return "about";
}

type Adapter = {
  requestConnectionTest?(signal?: AbortSignal, origin?: DomainActor): ReturnType<HostMaintenancePort["requestConnectionTest"]>;
  requestBackup?(action: import("@read-aware/core").BackupAction, signal?: AbortSignal, origin?: DomainActor): ReturnType<HostMaintenancePort["requestBackup"]>;
  snapshot(): HostMaintenanceSnapshot;
  check(signal?: AbortSignal, origin?: DomainActor): Promise<HostMaintenanceSnapshot>;
  subscribe(handler: (source: object) => void): () => void;
  navigate(section: WorkspaceSettingsSection, signal?: AbortSignal, origin?: DomainActor): Promise<unknown>;
};

export class HostMaintenanceService implements HostMaintenancePort {
  private surfaces = new Map<HostMaintenanceSurface, (origin: DomainActor) => void>();
  private observerCount = 0;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {}

  async snapshot() { return this.adapter.snapshot(); }
  requestConnectionTest(signal?: AbortSignal, origin: DomainActor = "user") {
    signal?.throwIfAborted();
    if (!this.adapter.requestConnectionTest) throw new AppError("ui/unavailable", "AI test controls are unavailable");
    return this.adapter.requestConnectionTest(signal, causalActor(origin));
  }
  requestBackup(action: import("@read-aware/core").BackupAction, signal?: AbortSignal, origin: DomainActor = "user") {
    signal?.throwIfAborted();
    if (action !== "import" && action !== "export") throw new AppError("ui/invalid-target", "Invalid backup action");
    if (!this.adapter.requestBackup) throw new AppError("ui/unavailable", "Backup controls are unavailable");
    return this.adapter.requestBackup(action, signal, causalActor(origin));
  }
  checkForUpdates(signal?: AbortSignal, origin: DomainActor = "user") { return this.adapter.check(signal, causalActor(origin)); }

  /** Host mount registration, never included in the Worker/Agent port. */
  bindSurface(surface: HostMaintenanceSurface, reveal: (origin: DomainActor) => void): () => void {
    this.surfaces.set(surface, reveal);
    return () => { if (this.surfaces.get(surface) === reveal) this.surfaces.delete(surface); };
  }

  async openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal, origin: DomainActor = "user") {
    origin = causalActor(origin);
    const section = maintenanceSection(surface);
    signal?.throwIfAborted();
    await this.adapter.navigate(section, signal, origin);
    signal?.throwIfAborted();
    this.revealControl(surface, origin);
    return stampEventCause({ status: "opened" as const, surface }, origin);
  }

  /** Host-only focus, for a flow whose settings page is already mounted. */
  revealControl(surface: HostMaintenanceSurface, origin: DomainActor = "user"): void {
    const reveal = this.surfaces.get(surface);
    if (!reveal) throw new AppError("ui/unavailable", "Maintenance controls are not mounted");
    reveal(causalActor(origin));
  }

  observe(handler: (value: HostMaintenanceSnapshot) => unknown, origin?: DomainActor): () => void {
    if (this.observerCount >= 64) throw new AppError("ui/observer-limit", "Too many maintenance observers");
    this.observerCount++;
    try {
      const off = observeSnapshot(() => this.adapter.snapshot(), notify => this.adapter.subscribe(notify),
        (value, source) => handler(copyEventCause(source, value)), this.report, origin);
      let stopped = false;
      return () => { if (!stopped) { stopped = true; this.observerCount--; off(); } };
    } catch (error) { this.observerCount--; throw error; }
  }
}
