import { copyEventCause, mergeEventCauses } from "../platform/domain-actor";
import type { WorkspaceView } from "./workspace";

type Sources = { surface: object; collection: object; selection: object; settingsOpen: object; section: object; searchOpen: object; query: object; reader: object };
/** Attribute only changed outward fields, never a request that merely matches. */
export function stampWorkspaceView(view: WorkspaceView, previous: WorkspaceView | undefined, sources: Sources): WorkspaceView {
  const changed: object[] = [];
  if (!previous || previous.surface !== view.surface) changed.push(
    previous?.surface === "reader" || view.surface === "reader" ? sources.reader : sources.surface);
  if (!previous || previous.collectionId !== view.collectionId) changed.push(sources.collection);
  if (!previous || JSON.stringify(previous.selection) !== JSON.stringify(view.selection)) changed.push(sources.selection);
  if (!previous || previous.settings.open !== view.settings.open) changed.push(sources.settingsOpen);
  else if (previous.settings.section !== view.settings.section) changed.push(sources.section);
  if (!previous || previous.search.open !== view.search.open) changed.push(sources.searchOpen);
  if (!previous || previous.search.query !== view.search.query) changed.push(sources.query);
  return changed.length ? mergeEventCauses(changed, view) : copyEventCause(previous!, view);
}
