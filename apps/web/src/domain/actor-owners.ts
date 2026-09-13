import type { createBookTextTaskOwner } from "../features/library/lib/book-text-store";
import type { createBookGraphTasks } from "./book-graph-tasks";
import type { readingEmphasis } from "./reading-emphasis";

/** Stateful handles belong to an activation, while each invocation can carry a
 * different immutable actor. Rebinding provenance must not create another task pool. */
export type DomainActorOwners = {
  textTasks?: ReturnType<typeof createBookTextTaskOwner>;
  graphTasks?: ReturnType<typeof createBookGraphTasks>;
  emphasis?: ReturnType<typeof readingEmphasis.forOwner>;
};
