import type { PluginContext } from "@read-aware/plugin-types";
import { saveCover } from "./saved-covers";
const invalid = (): never => { throw Object.assign(Error("Invalid saved cover request"), { code: "plugin/invalid-argument" }); };
function string(input: unknown): string { if (typeof input !== "string" || !input || input.length > 128) return invalid(); return input; }
const text = { type: "string", minLength: 1, maxLength: 128 };
const revision = { type: "string", pattern: "^[a-f0-9]{32}$" };
export function registerSavedCoverTools(ctx: PluginContext): void {
  if (!ctx.contributions.agentTools) throw Error("Library Desk requires agent:tools");
  ctx.contributions.agentTools.register({ name: "list_saved_covers", label: "List saved covers", contexts: ["global"],
    description: "List a bounded key-ordered page of Library Desk's private saved cover assets. Returns names, keys, exact revisions, sizes and nextAfter, never image bytes, paths or resource handles. Assets survive app restart, remain local, are included in full backups and are removed on plugin uninstall. Pages are not an immutable snapshot. Saving a cover does not change the book's cover.",
    parameters: { type: "object", properties: { after: text, limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async params => {
      if (Object.keys(params).some(k => !["after", "limit"].includes(k))) return invalid();
      const limit = params.limit ?? 10;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) return invalid();
      const page = await ctx.services.resources.assets.list({ limit, ...(params.after === undefined ? {} : { after: string(params.after) }) });
      return { ...page, items: page.items.filter(asset => asset.key.startsWith("cover:")) };
    },
  });
  ctx.contributions.agentTools.register({ name: "save_cover_asset", label: "Save private cover", contexts: ["global"], approval: "required",
    description: "After host approval, copy the book's currently available local cover into Library Desk's private assets. Use bookId from library discovery and expectedRevision from list_saved_covers for cover:<bookId>, or null if not present. Refuses a changed destination. No download, original cover modification or system file write. Returns the durable asset metadata and whether old-byte cleanup remains pending. Local-only, full-backup included, removed on plugin uninstall.",
    parameters: { type: "object", properties: { bookId: text, expectedRevision: { anyOf: [revision, { type: "null" }] } }, required: ["bookId", "expectedRevision"], additionalProperties: false },
    execute: async params => {
      if (Object.keys(params).some(k => !["bookId", "expectedRevision"].includes(k))) return invalid();
      const bookId = string(params.bookId), expected = params.expectedRevision === null ? null : string(params.expectedRevision);
      if (expected !== null && !/^[a-f0-9]{32}$/.test(expected)) return invalid();
      const book = await ctx.domains.library!.queries.books.get(bookId);
      if (!book) return { status: "book-not-found" };
      const resource = await ctx.services.resources.openCover!(bookId);
      if (!resource) return { status: "cover-unavailable" };
      try { return await saveCover(ctx, book, resource, expected); }
      finally { await ctx.services.resources.release(resource.id); }
    },
  });
  ctx.contributions.agentTools.register({ name: "manage_saved_cover", label: "Manage saved cover", contexts: ["global"], approval: "required",
    description: "After host approval, delete a Library Desk private saved cover or export it through the user's native file dialog. Use an exact cover key and revision from list_saved_covers; changed assets reject. Delete affects only the private saved copy, never the original book or its cover. Export returns saved:false on dialog cancellation. No bytes, paths or handles enter the model. Cancellation cannot undo a dispatched durable operation.",
    parameters: { type: "object", properties: { key: text, expectedRevision: revision, action: { type: "string", enum: ["delete", "export"] } }, required: ["key", "expectedRevision", "action"], additionalProperties: false },
    execute: async params => {
      if (Object.keys(params).some(k => !["key", "expectedRevision", "action"].includes(k))) return invalid();
      const key = string(params.key), expected = string(params.expectedRevision);
      if (!key.startsWith("cover:") || !/^[a-f0-9]{32}$/.test(expected) || !["delete", "export"].includes(String(params.action))) return invalid();
      const resources = ctx.services.resources;
      if (params.action === "delete") return resources.assets.delete(key, expected);
      const ref = await resources.assets.open(key, expected);
      try { return await resources.save(ref.id, ref.name); }
      finally { await resources.release(ref.id); }
    },
  });
}
