import { invoke } from "./ipc";
import { isMobileOS, isTauri } from "./environment";
import { createLogger } from "./logger";
import { queryLocalApi, type LocalApiReads } from "../domain/local-api";

const log = createLogger("local-api");
export type LocalApiStatus = { enabled: boolean; running: boolean; baseUrl: string; errorCode: string | null };
type Request = { id: string; session: string; path: string; query: string };
let bridge: Promise<void> | undefined;
let dispose: (() => void) | undefined;
export const supportsLocalApi = () => isTauri() && !isMobileOS();

/** Registered once after hydration, independent of settings/reader mount state.
 * A fresh document session invalidates requests belonging to a previous reload. */
export function startLocalApiBridge(): Promise<void> {
  if (!supportsLocalApi()) return Promise.resolve();
  return bridge ??= (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const session = crypto.randomUUID();
    const lifetime = new AbortController();
    let reads: Promise<LocalApiReads> | undefined;
    const getReads = () => reads ??= import("../domain/registry").then(({ createActorDomainView }) => {
      const domains = createActorDomainView("agent", { library: "read", reading: "read", annotations: "read", memory: "read" }, lifetime.signal);
      return { library: domains.library!.queries, reading: domains.reading!.queries,
        annotations: domains.annotations!.queries, memory: domains.memory!.queries };
    }).catch(error => { reads = undefined; throw error; });
    const unlisten = await listen<Request>("local-api-request", event => {
      if (event.payload.session !== session || lifetime.signal.aborted) return;
      const { id, path, query } = event.payload;
      void (async () => {
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(29_000)]);
        const reply = await queryLocalApi(await getReads(), path, query, error => log.warn("Read failed", error), signal);
        if (!signal.aborted) await invoke("local_api_complete", { session, id, reply });
      })().catch(async error => {
        log.error("Domain bridge failed", error);
        if (!lifetime.signal.aborted) {
          try { await invoke("local_api_complete", { session, id, reply: { status: 503,
            body: { error: { code: "local-api/unavailable", message: "ReadAware could not prepare this read. Retry when ready." } } } }); }
          catch (replyError) { log.error("Failure reply could not be delivered", replyError); }
        }
      });
    });
    dispose = () => { lifetime.abort(); unlisten(); };
    try { await invoke<LocalApiStatus>("local_api_attach", { session }); }
    catch (error) { dispose(); dispose = undefined; bridge = undefined; throw error; }
  })();
}
export async function readLocalApiStatus(): Promise<LocalApiStatus> {
  await startLocalApiBridge();
  return invoke("local_api_status");
}
export async function setLocalApiEnabled(enabled: boolean): Promise<LocalApiStatus> {
  await startLocalApiBridge();
  return invoke("local_api_set_enabled", { enabled });
}
export const rotateLocalApiToken = () => invoke<LocalApiStatus>("local_api_rotate_token");
export const readLocalApiToken = () => invoke<string>("local_api_token");
if (import.meta.hot) import.meta.hot.dispose(() => { dispose?.(); bridge = undefined; });
