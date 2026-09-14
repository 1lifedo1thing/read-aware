import { AppError } from "@read-aware/core";
import type { PluginDocument, PluginDocumentChange, PluginDocumentObservation, PluginDocumentObservationQuery, PluginObservationHandler, PluginStorage } from "@read-aware/plugin-types";

export const denyUnscopedServiceData = (): never => { throw new AppError("plugin/service-forbidden", "Book services cannot access unscoped private data"); };

/** Private documents are provider-owned, but a book service may only operate on
 * indexed documents for its fixed book. CAS closes the read-to-write race. */
export function bookServiceStorage(storage: PluginStorage, bookId: string): PluginStorage {
  const allowed = (doc: PluginDocument | null) => {
    if (doc && doc.bookId !== bookId) denyUnscopedServiceData();
  };
  const filter = <T extends { bookId?: string }>(value?: T): T & { bookId: string } => {
    if (value?.bookId !== undefined && value.bookId !== bookId) denyUnscopedServiceData();
    return { ...value, bookId } as T & { bookId: string };
  };
  const apply: PluginStorage["applyDocuments"] = async changes => {
    if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new AppError("plugin/invalid-argument", "Invalid service document batch");
    for (const change of changes) {
      if (change.kind === "put" && change.bookId !== bookId) denyUnscopedServiceData();
      const old = await storage.collection(change.collection).get(change.id);
      allowed(old);
      // The native batch must match the same row inspected for authorization.
      if ((old?.revision ?? null) !== change.expectedRevision) throw new AppError("plugin/service-data-changed", "Service document changed before commit");
    }
    return storage.applyDocuments(changes);
  };
  const scoped: PluginStorage = { ...storage,
    policy: denyUnscopedServiceData, get: denyUnscopedServiceData, getDurable: denyUnscopedServiceData,
    set: denyUnscopedServiceData, remove: denyUnscopedServiceData, onChange: denyUnscopedServiceData,
    applyDocuments: apply,
    collection: name => {
      const source = storage.collection(name);
      return {
        get: async <T>(id: string) => { const doc = await source.get<T>(id); allowed(doc); return doc; },
        list: async <T>(query?: Parameters<typeof source.list>[0]) => { const rows = await source.list<T>(filter(query)); rows.forEach(allowed); return rows; },
        page: async <T>(query?: Parameters<typeof source.page>[0]) => { const page = await source.page<T>(filter(query)); if (page.status === "ready") page.items.forEach(allowed); return page; },
        put: async (id, data, options) => {
          filter(options); const old = await source.get(id); allowed(old);
          const result = await apply([{ kind: "put", collection: name, id, data, ...filter(options), expectedRevision: old?.revision ?? null }]);
          if (result.status !== "applied") throw new AppError("plugin/service-data-changed", "Service document changed before commit");
        },
        delete: async id => {
          const old = await source.get(id); allowed(old);
          const changes: PluginDocumentChange[] = [{ kind: "delete", collection: name, id, expectedRevision: old?.revision ?? null }];
          const result = await apply(changes);
          if (result.status !== "applied") throw new AppError("plugin/service-data-changed", "Service document changed before commit");
        },
      };
    },
    observeDocuments: <T>(query: PluginDocumentObservationQuery, handler: PluginObservationHandler<PluginDocumentObservation<T>>) => {
      const scopedQuery = query.kind === "page" ? { ...query, filter: filter(query.filter) } : query;
      return storage.observeDocuments<T>(scopedQuery, (event, delivery) => {
        if (event.status === "ready") {
          if (event.result.kind === "get") allowed(event.result.document);
          else if (event.result.page.status === "ready") event.result.page.items.forEach(allowed);
        }
        return handler(event, delivery);
      });
    },
  };
  return scoped;
}
