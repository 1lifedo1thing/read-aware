import type { AnnotationSnapshot, PluginModule } from "@read-aware/plugin-types";

type WriteProbeInput = {
  targetBookId: string;
  otherBookId: string;
  otherNoteId: string;
  otherNoteRevision: string;
  marker: string;
};

type WriteAttempt =
  | { status: "allowed"; annotationId: string; bookId: string; receipt?: unknown }
  | { status: "rejected"; code: string };

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "unknown";
}

function isNote(snapshot: AnnotationSnapshot | null, bookId: string, body: string): boolean {
  return snapshot?.annotation.kind === "note"
    && snapshot.annotation.bookId === bookId
    && snapshot.annotation.body === body;
}

export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "write",
      title: "Annotation write access probe",
      run: async () => {
        const createdIds: string[] = [];
        try {
          const input = ctx.services.storage.get<WriteProbeInput>("input");
          if (!input || !input.targetBookId || !input.otherBookId || input.targetBookId === input.otherBookId
            || !input.otherNoteId || !input.otherNoteRevision || !input.marker) {
            throw new Error("Two fixture books and a baseline note are required");
          }
          const annotations = ctx.domains.annotations;
          if (!annotations?.commands) throw new Error("Annotation write permission is missing");

          const targetBody = `${input.marker} target created`;
          const targetEditedBody = `${input.marker} target edited`;
          const target = await annotations.commands.createNote({ bookId: input.targetBookId, body: targetBody });
          createdIds.push(target.id);
          if (target.kind !== "note" || target.bookId !== input.targetBookId || target.body !== targetBody) {
            throw new Error("Authorized note creation returned the wrong annotation");
          }

          const before = await annotations.queries.inspect(target.id);
          if (!isNote(before, input.targetBookId, targetBody)) throw new Error("Created note was not readable in the Worker");
          const edit = await annotations.commands.applyChanges([{
            op: "updateNote",
            annotationId: target.id,
            expectedRevision: before!.revision,
            body: targetEditedBody,
          }]);
          const after = await annotations.queries.inspect(target.id);
          if (!isNote(after, input.targetBookId, targetEditedBody)
            || edit.changes.length !== 1
            || edit.changes[0]?.annotationId !== target.id
            || edit.changes[0]?.revision !== after!.revision) {
            throw new Error("Authorized note edit did not match the persisted CAS receipt");
          }

          let crossCreate: WriteAttempt;
          try {
            const note = await annotations.commands.createNote({
              bookId: input.otherBookId,
              body: `${input.marker} cross created`,
            });
            createdIds.push(note.id);
            crossCreate = { status: "allowed", annotationId: note.id, bookId: note.bookId };
          } catch (error) {
            crossCreate = { status: "rejected", code: errorCode(error) };
          }

          let crossEdit: WriteAttempt;
          try {
            const receipt = await annotations.commands.applyChanges([{
              op: "updateNote",
              annotationId: input.otherNoteId,
              expectedRevision: input.otherNoteRevision,
              body: `${input.marker} cross edited`,
            }]);
            crossEdit = { status: "allowed", annotationId: input.otherNoteId, bookId: input.otherBookId, receipt };
          } catch (error) {
            crossEdit = { status: "rejected", code: errorCode(error) };
          }

          return {
            toast: JSON.stringify({
              status: "ok",
              grant: ctx.grants.book,
              target: { created: target, before, edit, after },
              crossCreate,
              crossEdit,
              createdIds,
            }),
          };
        } catch (error) {
          return {
            toast: JSON.stringify({ status: "error", code: errorCode(error), createdIds }),
          };
        }
      },
    });
  },
} satisfies PluginModule;
