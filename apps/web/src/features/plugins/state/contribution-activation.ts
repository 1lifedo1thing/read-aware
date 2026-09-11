import { createLogger } from "../../../platform/logger";

type Activation = {
  undo: Array<() => void>;
  commit: Array<() => void>;
  publications: Map<object, () => void>;
};

let current: Activation | undefined;
const log = createLogger("contribution-activation");

/** Synchronous registration factories only; never hold this scope across await. */
export function withContributionActivation<T>(activate: () => T): T {
  const parent = current;
  const scope: Activation = { undo: [], commit: [], publications: new Map() };
  let succeeded = false;
  current = scope;
  try {
    const result = activate();
    if (parent) {
      parent.undo.push(...scope.undo);
      parent.commit.push(...scope.commit);
    }
    succeeded = true;
    return result;
  } catch (cause) {
    const errors: unknown[] = [];
    for (const undo of scope.undo.reverse()) {
      try { undo(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError([cause, ...errors], "Contribution rollback failed");
    throw cause;
  } finally {
    current = parent;
    if (succeeded && !parent) for (const commit of scope.commit) commit();
    for (const [registry, publish] of scope.publications) {
      if (parent) parent.publications.set(registry, publish);
      else publish();
    }
  }
}

export function undoContributionReplacement(undo: () => void): void {
  current?.undo.push(undo);
}

/** Irreversible retirement starts only after the whole registration batch succeeds. */
export function commitContributionReplacement(commit: () => void): void {
  if (current) current.commit.push(commit);
  else commit();
}

/** Consumers see only the settled registry, including after nested rollback. */
export function publishContributionChange(registry: object, publish: () => void): void {
  const notify = () => {
    try { publish(); } catch (error) { log.warn("Contribution publication observer failed", error); }
  };
  if (current) current.publications.set(registry, notify);
  // Outside activation preserve the caller's existing cleanup/error contract.
  else publish();
}
