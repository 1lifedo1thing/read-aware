import { actorFromEvent, causalActor, copyEventCause, mergeEventCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { AppError, type OperationCondition, type HostMaintenanceSnapshot, type HostUpdateState } from "@read-aware/core";
import type { AvailableSoftwareUpdate, DownloadProgress, InstallSoftwareUpdateResult } from "./software-update";

type Adapter = {
  supported(): boolean;
  channel(): "stable" | "beta";
  read(): HostUpdateState;
  write(state: HostUpdateState): void;
  version(): Promise<string | null>;
  check(): Promise<AvailableSoftwareUpdate | null>;
  install(progress: (value: DownloadProgress) => void): Promise<InstallSoftwareUpdateResult>;
};

/** Native UI and external actors share one updater and one operation lock. */
export class SoftwareUpdateController {
  private checking: Promise<void> | null = null;
  private installing: Promise<void> | null = null;
  private checkedChannel: "stable" | "beta" | null = null;
  private channelRevision = 0;
  private channelSource = stampEventCause({});
  private installerOrigin?: DomainActor;
  constructor(private adapter: Adapter, private report: (message: string, error: unknown) => void) {}

  snapshot(): HostMaintenanceSnapshot {
    const state = this.adapter.read();
    return copyEventCause(state, { phase: state.phase, currentVersion: state.currentVersion, availableVersion: state.availableVersion,
      progress: state.progress, errorStage: state.errorStage, supported: this.adapter.supported(),
      channel: this.adapter.channel(), checkedChannel: this.checkedChannel });
  }

  async loadCurrentVersion(): Promise<void> {
    const origin = causalActor("system");
    try {
      const currentVersion = await this.adapter.version();
      if (currentVersion) this.patch({ currentVersion }, origin);
    } catch (error) { this.report("App version lookup failed", error); }
  }

  checkConditions(): OperationCondition[] {
    if (!this.adapter.supported()) return [{ kind: "provider", state: "unavailable", reason: "updater-unsupported", errorCode: "ui/unavailable" }];
    if (this.installing) return [{ kind: "capacity", state: "unavailable", reason: "update-installation-active", errorCode: "ui/unavailable" }];
    return [{ kind: "capacity", state: "satisfied", reason: this.checking ? "update-check-shared" : "update-check-ready" },
      { kind: "provider", state: "unknown", reason: "update-server-not-checked" }];
  }

  async checkForUpdates(signal?: AbortSignal, origin: DomainActor = "user"): Promise<HostMaintenanceSnapshot> {
    origin = causalActor(origin);
    signal?.throwIfAborted();
    const blocked = this.checkConditions().find(value => value.state === "unavailable");
    if (blocked) throw new AppError("ui/unavailable", blocked.reason);
    if (!this.checking) {
      const channel = this.adapter.channel();
      const revision = this.channelRevision;
      this.checkedChannel = null;
      this.channelSource = stampEventCause({}, origin);
      // Defer execution until the shared promise has been assigned, including synchronous adapter failures.
      this.checking = Promise.resolve().then(async () => {
        this.patch({ phase: "checking", availableVersion: null, progress: null, errorStage: null }, origin);
        try {
          const update = await this.adapter.check();
          if (revision !== this.channelRevision || channel !== this.adapter.channel()) throw new AppError("ui/superseded", "Update channel changed during the check");
          this.checkedChannel = channel;
          this.patch({ phase: update ? "available" : "up-to-date", availableVersion: update?.version ?? null,
            ...(update ? { currentVersion: update.currentVersion } : {}) }, origin);
        } catch (error) {
          this.report("Update check failed", error);
          const failureOrigin = revision !== this.channelRevision
            ? actorFromEvent(mergeEventCauses([stampEventCause({}, origin), this.channelSource], {})) : origin;
          this.patch({ phase: "error", availableVersion: null, errorStage: "check" }, failureOrigin);
          throw new AppError(error instanceof AppError ? error.code : "ipc/unknown", "Software update check failed");
        }
      }).finally(() => { this.checking = null; });
    }
    await this.checking;
    signal?.throwIfAborted();
    return this.snapshot();
  }

  /** Host UI only. This method is deliberately absent from the public actor service. */
  async installUpdate(origin: DomainActor = "user"): Promise<void> {
    if (this.installing) return this.installing;
    if (!this.adapter.supported() || this.checking || this.checkedChannel !== this.adapter.channel()
      || !this.adapter.read().availableVersion) throw new AppError("ui/unavailable", "Check the selected channel before installing");
    origin = causalActor(origin); this.installerOrigin = origin;
    this.installing = Promise.resolve().then(async () => {
      this.patch({ phase: "downloading", progress: null, errorStage: null }, origin);
      try {
        const result = await this.adapter.install(progress => this.patch(progress, origin));
        this.patch({ phase: result === "permission-required" ? "permission-required" : "installer-open", progress: null }, origin);
      } catch (error) {
        this.report("Update install failed", error);
        this.patch({ phase: "error", errorStage: "install" }, origin);
      }
    }).finally(() => { this.installing = null; });
    return this.installing;
  }

  channelChanged(origin: DomainActor = "user"): void {
    origin = causalActor(origin);
    const source = stampEventCause({}, origin);
    this.channelSource = this.checking ? mergeEventCauses([this.channelSource, source], {}) : source;
    this.channelRevision++;
    // An accepted installation cannot be cancelled by changing the preference.
    if (this.installing || this.checking || this.checkedChannel === this.adapter.channel()) return;
    this.checkedChannel = null;
    this.patch({ phase: "idle", availableVersion: null, progress: null, errorStage: null }, origin);
  }
  installerOpened(): void { this.patch({ phase: "installer-open", progress: null }, this.installerOrigin ?? causalActor("system")); }
  private patch(patch: Partial<HostUpdateState>, origin: DomainActor): void { this.adapter.write(stampEventCause({ ...this.adapter.read(), ...patch }, origin)); }
}
