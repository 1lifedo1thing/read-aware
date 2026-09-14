import { useMemo, useSyncExternalStore } from "react";
import type { PrimitiveAtom } from "jotai";
import { selectContribution, type ContributionIdentity } from "../state/contribution-registry";

/** A selected registration changes on replacement/removal, even when an owner
 * re-registers the same value. Unrelated registry changes retain the snapshot. */
export function useRegisteredContribution<T extends ContributionIdentity>(entries: PrimitiveAtom<T[]>, key: string) {
  const selection = useMemo(() => selectContribution(entries, key), [entries, key]);
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot);
}
