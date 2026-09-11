import { AppError } from "@read-aware/core";

/** In-process publication boundary for speculative plugin KV. The host owns
 * acceptance/rollback; this is deliberately not a crash recovery journal. */
export class PluginPreferencePublication {
  private readonly baseline: Map<string, string>;
  private readonly latest = new Map<string, string | null>();
  private closed = false;
  private quarantined = false;
  private publisher?: (changes: ReadonlyMap<string, string | null>) => Promise<void>;
  private report?: (error: unknown) => void;
  private publishing?: Promise<void>;
  private constructor(readonly pluginId: string, baseline: Record<string, string>) {
    this.baseline = new Map(Object.entries(baseline));
  }
  private static readonly pending = new Map<string, PluginPreferencePublication>();

  static begin(pluginId: string, baseline: Record<string, string>): PluginPreferencePublication {
    this.assertAvailable(pluginId);
    const scope = new PluginPreferencePublication(pluginId, baseline);
    this.pending.set(pluginId, scope);
    return scope;
  }

  static assertAvailable(pluginId: string): void {
    const scope = this.pending.get(pluginId);
    if (scope) throw new AppError(scope.quarantined ? "plugin/recovery-required" : "plugin/data-busy", "Plugin preference recovery is still pending");
  }

  static assertWritable(pluginId: string): void {
    const scope = this.pending.get(pluginId);
    if (scope && !scope.publisher) this.assertAvailable(pluginId);
  }

  private static owner(key: string): { scope: PluginPreferencePublication; suffix: string } | undefined {
    const match = /^read-aware-plugin\.([a-z0-9-]+)\./.exec(key);
    const scope = match ? this.pending.get(match[1]!) : undefined;
    return scope && match ? { scope, suffix: key.slice(match[0].length) } : undefined;
  }

  /** Capture exact durable receipts, never the optimistic mirror or a backfill read. */
  static record(key: string, raw: string | null): boolean {
    const owner = this.owner(key);
    if (!owner) return false;
    owner.scope.latest.set(owner.suffix, raw);
    if (owner.scope.publisher) void owner.scope.flush();
    return true;
  }
  static blocks(key: string): boolean { return !!this.owner(key); }
  static suppressesOverlay(key: string): boolean {
    const scope = this.owner(key)?.scope;
    return !!scope && (scope.quarantined || !!scope.publisher);
  }
  static isQuarantined(key: string): boolean { return this.owner(key)?.scope.quarantined ?? false; }
  static async flushAccepted(): Promise<void> {
    await Promise.all([...this.pending.values()].filter(scope => scope.publisher).map(scope => scope.flush()));
  }

  /** Native acceptance already logged these values atomically. Only durable
   * writes observed after that boundary still need the ordinary publisher. */
  rebase(baseline: Record<string, string>): void {
    if (this.closed || this.publisher || this.quarantined) throw new AppError("plugin/recovery-required", "Cannot rebase this publication scope");
    this.baseline.clear();
    for (const [key, value] of Object.entries(baseline)) this.baseline.set(key, value);
  }

  static quarantineOwner(pluginId: string): void {
    const scope = this.pending.get(pluginId) ?? this.begin(pluginId, {});
    scope.quarantine();
  }

  /** Acceptance is final: publication failure retains only accepted values for
   * retry and never asks the host to roll its installed plugin back. */
  accept(publish: (changes: ReadonlyMap<string, string | null>) => Promise<void>, report: (error: unknown) => void): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.quarantined) throw new AppError("plugin/recovery-required", "Unrecovered plugin data cannot be published");
    this.publisher ??= publish;
    this.report ??= report;
    return this.flush();
  }

  private flush(): Promise<void> {
    if (this.publishing) return this.publishing;
    if (this.closed || !this.publisher) return Promise.resolve();
    // Register before calling the publisher, including synchronous reentrancy.
    let continuePublishing = false;
    const run = Promise.resolve().then(async () => {
      const changes = new Map<string, string | null>();
      for (const [key, value] of this.latest) {
        if ((this.baseline.get(key) ?? null) !== value) changes.set(`read-aware-plugin.${this.pluginId}.${key}`, value);
      }
      if (!changes.size) { this.rollback(); return; }
      await this.publisher!(changes);
      for (const [key, value] of changes) {
        const suffix = key.slice(`read-aware-plugin.${this.pluginId}.`.length);
        if (value === null) this.baseline.delete(suffix); else this.baseline.set(suffix, value);
      }
      continuePublishing = [...this.latest].some(([key, value]) => (this.baseline.get(key) ?? null) !== value);
      if (!continuePublishing) this.rollback();
    }).catch(error => { this.report?.(error); }).finally(() => {
      this.publishing = undefined;
      // Post-acceptance writes follow the previous receipt, but a continuously
      // writing plugin cannot keep its install promise pending indefinitely.
      if (continuePublishing && !this.closed) void this.flush();
    });
    this.publishing = run;
    return run;
  }

  quarantine(): void { if (!this.closed) this.quarantined = true; }

  /** Only call after candidate teardown and successful data restoration. On an
   * unsafe recovery failure retain the boundary, including against backfills. */
  rollback(): void {
    if (this.closed) return;
    this.closed = true;
    PluginPreferencePublication.pending.delete(this.pluginId);
    this.latest.clear();
    this.baseline.clear();
  }
}
