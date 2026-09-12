/** Counts only. No table names, row samples, identifiers, logs or user content. */
export type ProjectionVerification = {
  scope: "event-projections";
  checkedAt: string;
  consistent: boolean;
  eventsReplayed: number;
  driftedTables: number;
  onlyLiveRows: number;
  onlyReplayedRows: number;
};

export type DiagnosticsReportAction = "export" | "send";
export type ProjectionRepairReceipt = {
  action: "repair";
  /** Rebuilt means the local transaction committed; the host must reload its
   * stores before resuming writes. No claim about backups or other devices. */
  status: "rebuilt-reload-required" | "cancelled";
};
export type DiagnosticsReportReceipt = {
  action: DiagnosticsReportAction;
  /** Saved locally or acknowledged by the report endpoint, not developer review. */
  status: "exported" | "sent" | "cancelled";
};

export type HostDiagnosticsPort = {
  /** Host-owned difference preview and explicit confirmation. Replays the
   * complete current event log; never grants raw mutation authority. Cancelling
   * a wait cannot undo a confirmed native repair. */
  requestProjectionRepair(signal?: AbortSignal): Promise<ProjectionRepairReceipt>;
  /** Explicit local check, not a repair or a check of remote devices/backups.
   * Cancellation stops waiting, not the shared native replay/rollback. */
  verifyProjections(signal?: AbortSignal): Promise<ProjectionVerification>;
  /** Opens host-only preview and confirmation. Never returns the bundle, path,
   * report ID or logs. Confirmed saves/uploads cannot be undone by cancellation. */
  requestReport(action: DiagnosticsReportAction, signal?: AbortSignal): Promise<DiagnosticsReportReceipt>;
};
