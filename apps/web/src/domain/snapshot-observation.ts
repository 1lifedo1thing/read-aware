import { copyEventCause, ObservationCauses, stampEventCause, type DomainActor } from "../platform/domain-actor";

/** Synchronous host snapshots, including null, with serial asynchronous
 * consumers. Metadata stays separate from public data and preserves every
 * coalesced trigger while the previous consumer is still working. */
export function observeSnapshot<T>(read: () => T, subscribe: (notify: (source: object) => void) => () => void,
  handler: (value: T, source: object) => unknown, report: (error: unknown) => void, origin?: DomainActor, initial = true): () => void {
  const causes = new ObservationCauses(initial ? origin : undefined);
  let stopped = false, running = false, dirty = false, retry: object | undefined;
  const deliver = async () => {
    if (running || stopped) return;
    running = true;
    try { do {
      dirty = false;
      const source = causes.take({}, retry);
      retry = undefined;
      try { await handler(read(), source); }
      catch (error) { retry = copyEventCause(source, {}); report(error); }
    } while (dirty && !stopped); }
    finally { running = false; }
  };
  const stop = subscribe(source => {
    if (stopped) return;
    causes.add(source); dirty = true; void deliver();
  });
  // A subscription created by a reaction inherits that reaction, not the
  // unrelated intent that originally produced the ambient snapshot.
  if (initial && !dirty && !running) { causes.add(stampEventCause({}, origin)); dirty = true; void deliver(); }
  return () => { if (stopped) return; stopped = true; retry = undefined; stop(); };
}
