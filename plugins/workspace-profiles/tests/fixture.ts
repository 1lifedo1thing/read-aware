import type { PluginContext, PluginDocumentChange, PluginToolDefinition } from "@read-aware/plugin-types";
import { PROFILE_PATHS } from "../src/profiles";

export function fixture() {
  type Change = Parameters<PluginContext["domains"]["settings"]["commands"]["update"]>[0][number];
  const documents = new Map<string, unknown>(), revisions = new Map<string, string>();
  const updates: Change[][] = [], commits: PluginDocumentChange[][] = [];
  const tools = new Map<string, PluginToolDefinition>();
  const registrations: string[] = [];
  let snapshots = 0, generation = 0, fail = false;
  const values: Record<string, unknown> = { "shelf.layout": "list", "shelf.group": "none", "shelf.sort": "title", "appearance.theme": "light",
    "appearance.motion": "full", "reading.fontSize": 20, "reading.lineSpacing": 1.5, "reading.fontFamily": null,
    "appearance.contentTypography.fontFamily": null, "appearance.contentTypography.followReader": true };
  const labels: Record<string, string> = { "shelf.layout": "Shelf layout", "appearance.theme": "App theme", "reading.fontSize": "Reading font size" };
  const doc = (id: string) => ({ id, data: structuredClone(documents.get(id)), revision: revisions.get(id) ?? "initial", updatedAt: "2026-09-11T00:00:00Z" });
  const storage = {
    collection: () => ({ get: async (id: string) => documents.has(id) ? doc(id) : null,
      page: async ({ cursor, limit = 40 }: { cursor?: string; limit?: number }) => {
        const [version, offset] = cursor?.split(":").map(Number) ?? [generation, 0];
        if (version !== generation) return { status: "stale-cursor" };
        const all = [...documents.keys()], ids = all.slice(offset, offset! + limit);
        return { status: "ready", items: ids.map(doc), nextCursor: offset! + limit < all.length ? `${generation}:${offset! + limit}` : null };
      } }),
    applyDocuments: async (changes: PluginDocumentChange[]) => {
      if (fail) throw Error("write failed");
      commits.push(structuredClone(changes));
      for (const [index, change] of changes.entries()) {
        const revision = documents.has(change.id) ? revisions.get(change.id) ?? "initial" : null;
        if (revision !== change.expectedRevision) return { status: "conflict", index };
      }
      for (const change of changes) {
        if (change.kind === "put") documents.set(change.id, structuredClone(change.data));
        if (change.kind === "delete") documents.delete(change.id);
        revisions.set(change.id, String(++generation));
      }
      return { status: "applied", documents: changes.map(change => ({ collection: change.collection, id: change.id, revision: revisions.get(change.id) })) };
    },
  };
  type Operations = Parameters<PluginContext["services"]["transactions"]["preview"]>[0];
  const plans = new Map<string, Operations>();
  const receipts = new Map<string, Operations>();
  const transactions = {
    preview: async (operations: Operations) => {
      const id = crypto.randomUUID(); plans.set(id, structuredClone(operations));
      return { id, operations, before: [], expiresAt: new Date(Date.now() + 300000).toISOString() };
    },
    commit: async (id: string) => {
      const operations = plans.get(id); if (!operations) throw Error("missing preview"); plans.delete(id);
      if (fail) throw Error("rejected stale option");
      for (const operation of operations) if (operation.kind === "document.check" && operation.expectedRevision !== (documents.has(operation.id) ? revisions.get(operation.id) ?? "initial" : null)) {
        throw Object.assign(Error("conflict"), { code: "transaction/conflict" });
      }
      const changes = operations.flatMap(operation => operation.kind === "settings" ? operation.changes : []);
      receipts.set(id, [{ kind: "settings", changes: changes.map(change => ({ ...change, value: values[change.path] as Change["value"] })) }]);
      updates.push(structuredClone(changes));
      for (const change of changes) values[change.path] = change.value;
      return { id, committed: true };
    },
    previewUndo: async (id: string) => {
      const inverse = receipts.get(id); if (!inverse) throw Error("missing receipt");
      return transactions.preview(inverse);
    },
  };
  const ctx = { locale: "en", domains: { settings: {
    queries: { snapshot: async () => {
      snapshots++;
      return { settings: PROFILE_PATHS.map(path => ({ path, label: labels[path] ?? path, value: values[path], writable: true,
        ...(path === "shelf.layout" ? { options: [{ value: "grid", label: "Grid" }, { value: "list", label: "List" }] } : {}) })) };
    } },
    commands: { update: async (changes: Change[]) => {
      if (fail) throw Error("rejected stale option");
      updates.push(structuredClone(changes));
      return { changed: changes, settings: { overrides: [{ target: { kind: "book", bookId: "keep" }, paths: ["reading.fontSize"] }] } };
    } },
  } }, services: { storage, transactions }, contributions: {
    headerActions: { register: () => registrations.push("header") },
    commands: { register: () => registrations.push("command") },
    agentTools: { register: (tool: PluginToolDefinition) => { registrations.push("tool"); tools.set(tool.name, tool); } },
  } } as unknown as PluginContext;
  return { ctx, documents, revisions, updates, commits, tools, registrations, values, snapshots: () => snapshots, fail() { fail = true; } };
}
