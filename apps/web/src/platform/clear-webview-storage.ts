import { createLogger } from "./logger";

/** Native anti-import flags are already committed before this best-effort cleanup. */
export async function clearWebviewStorage(): Promise<void> {
  try {
    localStorage.clear();
    const databases = await indexedDB.databases();
    await Promise.allSettled(databases.flatMap(db => db.name ? [new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(db.name!);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      // A retained legacy handle cannot prevent native recovery or re-enable import.
      request.onblocked = () => resolve();
    })] : []));
  } catch (error) {
    createLogger("delete-all-data").warn("webview storage cleanup incomplete", error);
  }
}
