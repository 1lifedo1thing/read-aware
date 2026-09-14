import { causalActor, stampEventCause, type DomainActor } from "../domain-actor";
/**
 * Process-wide serialization for account-connection commands.
 *
 * This deliberately lives outside React: Settings panels can unmount while a
 * relay request, KDF, or Tauri account-adoption command is still running. A
 * hook-local ref would disappear with the panel and let a newly mounted panel
 * start a second persistence flow over the same session/master-key slots.
 */

let operationInFlight = false;
let operationRevision = 0;
export const getSyncConnectionOperationRevision = () => operationRevision;
const listeners = new Set<(source: object) => void>();

export class SyncConnectionBusyError extends Error {
  constructor() {
    super("a sync connection operation is already in progress");
    this.name = "SyncConnectionBusyError";
  }
}

export function getSyncConnectionBusy(): boolean {
  return operationInFlight;
}

export function subscribeSyncConnectionBusy(listener: (source: object) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setOperationInFlight(next: boolean, origin: DomainActor): void {
  operationInFlight = next;
  const source = stampEventCause({ busy: next }, origin);
  for (const listener of listeners) listener(source);
}

/** Run one credential/account operation; reject rather than queue duplicates. */
export async function runSyncConnectionOperation<T>(operation: () => Promise<T>, origin: DomainActor = "user"): Promise<T> {
  if (operationInFlight) throw new SyncConnectionBusyError();
  origin = causalActor(origin);
  operationRevision++;
  setOperationInFlight(true, origin);
  try {
    return await operation();
  } finally {
    setOperationInFlight(false, origin);
  }
}
