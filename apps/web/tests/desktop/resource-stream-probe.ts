import type { PluginModule } from "@read-aware/plugin-types";
import type { ResourceRef } from "@read-aware/core";

const chunkSize = 1024 * 1024;
const code = async (run: () => Promise<unknown>) => {
  try { await run(); return "accepted"; }
  catch (error) { return error && typeof error === "object" && "code" in error ? error.code : String(error); }
};
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export default {
  activate(ctx) {
    const resources = ctx.services.resources;
    let resource: ResourceRef | undefined;
    const actions = {
      write: async () => {
        const draft = await resources.create({ name: "resource79-stream.bin" });
        const id = draft.id;
        draft.name = "tampered.bin";
        const readBeforeCommit = await code(() => resources.read(id, 0, 1));
        const first = Uint8Array.from({ length: chunkSize }, (_, i) => (i * 17 + 9) % 251);
        const writing = resources.append(id, 0, first);
        first.fill(0); // Mutation after dispatch must not alter the accepted chunk.
        const tail = Uint8Array.from({ length: 257 }, (_, i) => (i * 23 + 7) % 253);
        const results = await Promise.all([writing, resources.append(id, chunkSize, tail.buffer)]);
        const duplicateOffset = await code(() => resources.append(id, 0, new Uint8Array([1])));
        const oversizedAppend = await code(() => resources.append(id, chunkSize + 257, new Uint8Array(chunkSize + 1)));
        resource = await resources.commit(id);
        const afterCommit = await code(() => resources.append(id, resource!.size, new Uint8Array([2])));
        const oversizedRead = await code(() => resources.read(id, 0, chunkSize + 1));
        requireValue([readBeforeCommit, duplicateOffset, oversizedAppend, afterCommit, oversizedRead].every(value => value === "ui/invalid-target"), "Resource guards failed");
        requireValue(resource.name === "resource79-stream.bin" && resource.size === chunkSize + 257 && resource.state === "ready", "Resource stat mismatch");
        return { resource, appendedSizes: results.map(value => value.size), readBeforeCommit, duplicateOffset, oversizedAppend, afterCommit, oversizedRead };
      },
      read: async () => {
        requireValue(resource, "Write first");
        const bytes = new Uint8Array(resource.size), pages: { length: number; nextOffset: number; eof: boolean }[] = [];
        let offset = 0;
        while (offset < bytes.length) {
          const part = await resources.read(resource.id, offset, 262144);
          bytes.set(new Uint8Array(part.data), offset);
          requireValue(part.nextOffset > offset && part.eof === (part.nextOffset === bytes.length), "Invalid byte cursor");
          pages.push({ length: part.data.byteLength, nextOffset: part.nextOffset, eof: part.eof });
          offset = part.nextOffset;
        }
        requireValue(bytes.every((byte, i) => byte === (i < chunkSize ? (i * 17 + 9) % 251 : ((i - chunkSize) * 23 + 7) % 253)), "Native roundtrip bytes changed");
        const boundary = await resources.read(resource.id, chunkSize - 16, 48);
        requireValue(new Uint8Array(boundary.data).every((byte, i) => byte === bytes[chunkSize - 16 + i]), "Cross-chunk range mismatch");
        const eof = await resources.read(resource.id, bytes.length, 1);
        requireValue(eof.eof && eof.data.byteLength === 0 && eof.nextOffset === bytes.length, "EOF mismatch");
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
        return { pages, sha256: hash, crossChunkBytes: boundary.data.byteLength, eof: { nextOffset: eof.nextOffset, eof: eof.eof, bytes: eof.data.byteLength } };
      },
      foreign: async () => {
        const id = ctx.manifest.description!;
        const stat = await code(() => resources.stat(id));
        const read = await code(() => resources.read(id, 0, 1));
        const commit = await code(() => resources.commit(id));
        await resources.release(id); // Idempotent for this owner; cannot release another owner's file.
        requireValue([stat, read, commit].every(value => value === "fs/not-found"), "Foreign resource accepted");
        return { stat, read, commit, release: "resolved without authority" };
      },
      quotaAndAbort: async () => {
        requireValue(resource, "Write first");
        const slots: string[] = [];
        try {
          for (let i = 0; i < 15; i++) slots.push((await resources.create({ name: `resource79-slot-${i}.bin` })).id);
          const seventeenth = await code(() => resources.create({ name: "resource79-overflow.bin" }));
          requireValue(seventeenth === "ui/unavailable", "Owner quota was not enforced");
          const abortId = slots.pop()!;
          await resources.append(abortId, 0, new Uint8Array([79, 0, 255]));
          await resources.release(abortId);
          await resources.release(abortId);
          const afterAbort = await code(() => resources.stat(abortId));
          requireValue(afterAbort === "fs/not-found", "Aborted file remained accessible");
          const replacement = await resources.create({ name: "resource79-replacement.bin" });
          slots.push(replacement.id);
          return { maxLiveReferences: 16, seventeenth, afterAbort, replacementAdmitted: true };
        } finally { for (const id of slots) await resources.release(id); }
      },
      leaveOpen: async () => {
        const unfinished = await resources.create({ name: "resource79-unfinished.bin" });
        const written = await resources.append(unfinished.id, 0, new Uint8Array([7, 9]));
        return { unfinished: written, ready: resource };
      },
    };
    for (const [id, run] of Object.entries(actions)) ctx.contributions.commands.register({ id, title: id, run: async () => ({ toast: JSON.stringify(await run()) }) });
  },
} satisfies PluginModule;
