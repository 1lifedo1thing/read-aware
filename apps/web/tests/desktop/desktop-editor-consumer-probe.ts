import { getDefaultStore } from "jotai";
import type { PluginEditorView, PluginViewResult } from "@read-aware/plugin-types";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { PluginViewSession } from "../../src/features/plugins/lib/plugin-view-session";
import { assertFull2BookAccessProfile } from "./desktop-book-access-fixture";

/** Actual bundled Worker callbacks and durable CAS; no keyboard/rendering claim. */
export async function runFull2EditorConsumerProbe(bookId: string) {
  const profile = await assertFull2BookAccessProfile();
  const domain = createAnnotationsDomain("user");
  const marker = `Full2 editor ${crypto.randomUUID()}`;
  const note = await domain.commands.createNote({ bookId, body: marker });
  const sessions: PluginViewSession[] = [];
  const own = (result: PluginViewResult) => {
    if (!result || !("view" in result) || !result.view) throw new Error("Expected consumer view");
    const session = new PluginViewSession();
    sessions.push(session);
    session.setRoot(result.view);
    return session;
  };
  const edit = async (): Promise<PluginEditorView> => {
    const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "annotations" && item.id === "open");
    if (!command) throw new Error("Bundled Annotations is unavailable");
    const list = own(await command.run());
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const view = list.getSnapshot().stack.at(-1);
      if (view?.kind === "list") {
        const item = view.items.find(item => item.id === note.id);
        if (item?.onSelect) {
          const detail = own(await item.onSelect()).getSnapshot().stack.at(-1);
          if (detail?.kind !== "detail") throw new Error("Expected annotation detail");
          const editor = detail.content.find(block => block.kind === "editor");
          if (editor?.kind !== "editor") throw new Error("Expected editor declaration");
          return editor;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Owned note did not appear in Annotations");
  };
  try {
    const editor = await edit();
    const body = `${marker}\n中文; punctuation preserved.`;
    own(await editor.onSave(body, editor.revision));
    const saved = await domain.queries.inspect(note.id);
    if (saved?.annotation.kind !== "note" || saved.annotation.body !== body || saved.revision === editor.revision) throw new Error("Save did not persist exact text and advance revision");
    const cancelEditor = await edit();
    if (!cancelEditor.onCancel) throw new Error("Cancel callback missing");
    own(await cancelEditor.onCancel());
    if (JSON.stringify(await domain.queries.inspect(note.id)) !== JSON.stringify(saved)) throw new Error("Cancel changed annotation");
    const staleEditor = await edit();
    await domain.commands.applyChanges([{ op: "updateNote", annotationId: note.id, body: `${marker} concurrent edit`, expectedRevision: saved.revision }]);
    const concurrent = await domain.queries.inspect(note.id);
    const rejected = await staleEditor.onSave("Must not overwrite concurrent edit", staleEditor.revision);
    if (!rejected || !("fieldErrors" in rejected) || !rejected.fieldErrors?.editor) throw new Error("Stale editor did not surface a field error");
    if (JSON.stringify(await domain.queries.inspect(note.id)) !== JSON.stringify(concurrent)) throw new Error("Stale save overwrote concurrent annotation");
    return { profile, consumer: "bundled annotations Worker", exactSave: true, cancelUnchanged: true, conflictVisibleInResult: true, concurrentUnchanged: true, boundary: "Worker callbacks and native persisted state; rendering, draft UI and keyboard pending" };
  } finally {
    for (const session of sessions.reverse()) session.dispose("unmounted");
    const current = await domain.queries.inspect(note.id);
    if (current) await domain.commands.applyChanges([{ op: "remove", annotationId: note.id, kind: "note", expectedRevision: current.revision }]);
    if (await domain.queries.inspect(note.id)) throw new Error("Owned editor fixture cleanup failed");
  }
}
