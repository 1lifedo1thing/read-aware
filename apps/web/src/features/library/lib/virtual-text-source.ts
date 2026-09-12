import { AppError } from "@read-aware/core";
import { getVirtualBookBinding, resolveContentProvider } from "../../plugins/lib/virtual-books";
import { virtualSourceRevision } from "./content-invalidation";
import { withBookContent } from "./book-content-source";
import type { TextSource } from "./book-text-repository";

// Metadata only. A new activation or source invalidation must resolve the actual
// content again before a persistent index can be reused. Never cache chapters.
const known = new Map<string, { revision: string; contentVersion: string }>();
function identity(bookId: string) {
  const binding = getVirtualBookBinding(bookId);
  const provider = binding ? resolveContentProvider(binding) : null;
  return { binding, provider, revision: virtualSourceRevision(bookId, provider, binding?.key ?? "") };
}
export async function getVirtualTextSource(bookId: string, load: boolean): Promise<TextSource> {
  const source = identity(bookId);
  const available = !!source.binding && !!source.provider;
  const previous = known.get(bookId);
  const contentVersion = available && previous?.revision === source.revision ? previous.contentVersion : null;
  const result: TextSource = { format: "virtual", contentVersion, revision: source.revision, available };
  if (!load || contentVersion) return result;
  if (!available) throw new AppError("library/content-unavailable", "Virtual text provider is unavailable");
  // Same guarded parser acquisition as reading/navigation, including provider
  // retirement, binding changes, deletion and content invalidation checks.
  const version = await withBookContent(bookId, undefined, undefined, async content => content.contentVersion);
  const current = identity(bookId);
  if (current.revision !== source.revision || current.binding?.pluginId !== source.binding?.pluginId
    || current.binding?.providerId !== source.binding?.providerId || current.binding?.key !== source.binding?.key) {
    throw new AppError("reader/stale-location", "Virtual text source changed while resolving its version");
  }
  known.set(bookId, { revision: source.revision, contentVersion: version });
  return { ...result, contentVersion: version };
}

export function forgetVirtualTextSource(bookId: string): void { known.delete(bookId); }
