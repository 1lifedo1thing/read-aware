import { expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { buildPluginContext } from "./plugin-context";
import { createAnnotationsDomain } from "../../../domain/annotations";
import { actorCause } from "../../../platform/domain-actor";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import type { Note } from "../../annotations/lib/annotation-types";
import type { PluginContext } from "@read-aware/plugin-types";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test.each(["all", "book"] as const)("public annotation %s-grant observations stop A to B to A and allow a fresh user operation", async mode => {
  const records = new Map<string, { annotation: Note; revision: string }>();
  const revision = (n: number) => `ann1:${n.toString(16).padStart(64, "0")}`;
  let writes = 0;
  for (const id of ["a", "b"]) records.set(id, { revision: revision(0), annotation: { id, bookId: "book", type: "note", content: "initial",
    cfiRange: null, chapterHref: null, text: "", createdAt: "now", updatedAt: "now" } });
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const invoke = spyOn(ipc, "invoke").mockImplementation(async (command, raw) => {
    const args = raw as any;
    if (command === "local_device_get") return { deviceId: "annotations-reaction", lastHlcWallMs: null, lastHlcCounter: null } as never;
    if (command === "annotations_page") {
      expect(args.input.bookId).toBe("book");
      return { items: [...records.values()].map(row => ({ ...row.annotation, revision: row.revision })), nextCursor: null, consistency: "live" } as never;
    }
    if (command === "annotation_inspect") return structuredClone(records.get(args.id) ?? null) as never;
    if (command === "annotations_commit") {
      const condition = args.conditions[0], event = args.events[0], record = records.get(condition.annotationId)!;
      if (record.revision !== condition.expectedRevision) throw new AppError("annotations/conflict", "Version changed");
      expect(event.type).toBe("note.updated"); expect(event.payload.noteId).toBe(condition.annotationId);
      expect(typeof event.origin).toBe("string"); expect(event).not.toHaveProperty("cause");
      record.annotation.content = event.payload.body; record.revision = revision(++writes);
      return { atomic: true, changes: [{ annotationId: condition.annotationId, revision: record.revision }] } as never;
    }
    throw Error(`Unexpected IPC ${command}`);
  });
  const make = (id: string) => {
    const runtime = buildPluginContext({ id, name: id, version: "1", schemaVersion: 1, requires: {}, permissions: ["annotations:write"] }, "1", [],
      mode === "book" ? { mode: "book", bookId: "book" } : { mode: "all" });
    runtime.lifecycle.promote(); return runtime;
  };
  const a = make("annotation-a"), b = make("annotation-b"), ready = [deferred(), deferred()];
  let done = deferred(), cycles = 0, reactionWrites = 0, retained: PluginContext | undefined;
  const roots: string[] = [], errors: unknown[] = [];
  const write = async (ctx: PluginContext, id: string, body: string) => {
    const domain = ctx.domains.annotations!, row = await domain.queries.inspect(id);
    await domain.commands!.applyChanges([{ op: "updateNote", annotationId: id, expectedRevision: row!.revision, body }]);
  };
  try {
    [a, b].forEach((runtime, index) => {
      const watched = index === 0 ? "a" : "b", target = index === 0 ? "b" : "a";
      let last: string | undefined;
      runtime.context.domains.annotations!.events.observe({ kind: "page", query: { bookId: "book" } }, async (snapshot, delivery) => {
        try {
          expect("reaction" in snapshot).toBe(false);
          if (snapshot.status !== "ready" || snapshot.result.kind !== "page") throw Error("Expected page");
          const row = snapshot.result.page.items.find(item => item.id === watched);
          if (row?.kind !== "note") throw Error("Expected note");
          const previous = last; last = row.body;
          if (previous === undefined) { ready[index]!.resolve(); return; }
          if (previous === last) return;
          if (delivery?.reaction?.status === "cycle") {
            expect(index).toBe(0); expect(() => runtime.context.withEvent(delivery)).toThrow(expect.objectContaining({ code: "plugin/event-cycle" }));
            cycles++; done.resolve(); return;
          }
          retained = runtime.context.withEvent(delivery);
          if (index === 0) roots.push(actorCause(runtime.reactions.actor(delivery!.reaction!))!.root);
          await Promise.resolve();
          await write(retained, target, `${index === 0 ? "reaction" : "return"}:${++reactionWrites}`);
        } catch (error) { errors.push(error); ready[index]!.resolve(); done.resolve(); }
      });
    });
    await Promise.all(ready.map(item => item.promise)); expect(errors).toEqual([]);
    const user = createAnnotationsDomain("user");
    for (let n = 0; n < 2; n++) {
      done = deferred();
      await user.commands.applyChanges([{ op: "updateNote", annotationId: "a", expectedRevision: records.get("a")!.revision, body: `user:${n}` }]);
      await done.promise;
      expect(errors).toEqual([]); expect(cycles).toBe(n + 1);
      await Promise.all([a.reactions.drain(), b.reactions.drain()]);
    }
    expect(writes).toBe(6); expect(reactionWrites).toBe(4); expect(roots).toHaveLength(2); expect(roots[0]).not.toBe(roots[1]);
    expect(() => retained!.services.storage.get("expired")).toThrow(expect.objectContaining({ code: "plugin/invalid-cause" }));
  } finally {
    a.lifecycle.stop(); b.lifecycle.stop(); await Promise.all([a.lifecycle.drainCleanups(), b.lifecycle.drainCleanups()]);
    invoke.mockRestore(); native.mockRestore();
  }
}, 20000);
