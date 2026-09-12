import { atom, getDefaultStore } from "jotai";
import type { PluginUriHandler, PluginUriRequest } from "@read-aware/plugin-types";
import { createInteractiveContributionRegistry } from "../state/interactive-contribution-registry";

export type PluginUri = { pluginId: string; handlerId: string; request: PluginUriRequest; url: string };
export type RegisteredUriHandler = PluginUriHandler & { key: string; pluginId: string; pluginName: string };
export const pluginUriRegistry = createInteractiveContributionRegistry<RegisteredUriHandler>("uriHandlers", "open");
const identifier = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function parsePluginUri(raw: string): PluginUri | null {
  if (typeof raw !== "string" || raw.length > 4096 || /[\u0000-\u0020\u007f-\u009f]/u.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "readaware:" || url.hostname !== "plugin" || url.username || url.password || url.port || url.hash) return null;
  // No encoded identifiers, traversal normalization or extra route segments.
  const match = /^readaware:\/\/plugin\/([a-z0-9_-]+)\/([a-z0-9_-]+)(?:\?[^#]*)?$/.exec(raw);
  if (!match || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(match[1]!) || !identifier.test(match[2]!)) return null;
  const parameters: PluginUriRequest["parameters"] = [];
  for (const [key,value] of url.searchParams) {
    if (parameters.length >= 24 || !/^[A-Za-z0-9_.-]{1,64}$/.test(key) || value.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
    parameters.push({key,value});
  }
  return { pluginId:match[1]!,handlerId:match[2]!,request:{parameters},url:raw };
}

export type PendingPluginUri = PluginUri & { id: number };
export const pendingPluginUrisAtom = atom<PendingPluginUri[]>([]);
const seen = new Map<string, number>();
let sequence = 0;
/** Bounded cold-start/event deduplication. No durable delivery or automatic
 * retry; link receipt does not call a plugin or grant it new permissions. */
export function receivePluginUris(urls: readonly string[], now = Date.now()): void {
  const store=getDefaultStore();
  for(const [url,time] of seen) if(now-time>=5000)seen.delete(url);
  for(const raw of urls.slice(0,32)) {
    const parsed=parsePluginUri(raw);if(!parsed || seen.has(raw))continue;
    const pending=store.get(pendingPluginUrisAtom);
    if(pending.length>=8 || pending.some(item=>item.url===raw))continue;
    while(seen.size>=32)seen.delete(seen.keys().next().value!);
    seen.set(raw,now);store.set(pendingPluginUrisAtom,[...pending,{...parsed,id:++sequence}]);
  }
}
export function dismissPluginUri(id: number): void {
  getDefaultStore().set(pendingPluginUrisAtom,current=>current.filter(item=>item.id!==id));
}
export function findPluginUriHandler(uri: PluginUri): RegisteredUriHandler | null {
  return pluginUriRegistry.find(handler=>handler.pluginId===uri.pluginId && handler.id===uri.handlerId);
}
