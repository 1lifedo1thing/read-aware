import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { installedPluginsAtom } from "../../src/features/plugins/state/plugin-store";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { writePluginSettingsValues } from "../../src/features/plugins/lib/plugin-settings";
import { setPluginSecret } from "../../src/platform/secret-store";
import { findSyncTransport } from "../../src/platform/sync/transport-registry";
import { establishEncryptionWithStore, transportKeyMaterialStore } from "../../src/platform/sync/connect";
import { persistTransportConnection, syncNow, getSyncStatusSnapshot, disconnectSync, fetchRemoteBlob } from "../../src/platform/sync/sync-scheduler";
import { createIpcSyncStore, getSyncProfile } from "../../src/platform/sync/sync-store";
import { createLibraryDomain } from "../../src/domain/library";
import { getDesktopBlob } from "../../src/platform/blob-store";
import { localDeviceId } from "../../src/platform/domain-events";

async function isolated() {
  const path = await appDataDir();
  if (!/\/com\.readaware\.app\.sync-acceptance-20260913(?:-b)?$/.test(path.replace(/[/\\]$/, ""))) {
    throw Error("This probe requires its disposable sync acceptance profile");
  }
  return path;
}

export async function connectSyncAcceptance(passphrase = "Synthetic acceptance only 20260913!") {
  const path = await isolated();
  const installed = getDefaultStore().get(installedPluginsAtom).find(p => p.manifest.id === "webdav-sync");
  if (!installed?.builtin) throw Error("Expected the real bundled WebDAV plugin");
  await writePluginSettingsValues("webdav-sync", {
    serverUrl: "http://127.0.0.1:18891", username: "synthetic-reader", basePath: "full-validation",
  });
  await setPluginSecret("webdav-sync", "password", "synthetic-local-password");
  if (!installed.enabled) await setPluginEnabled("webdav-sync", true);
  const provider = findSyncTransport("plugin:webdav-sync:webdav");
  if (!provider) throw Error("WebDAV Worker transport unavailable");
  const session = await provider.open();
  try {
    await session.probe();
    const masterKeyBase64 = await establishEncryptionWithStore(transportKeyMaterialStore(session), passphrase);
    await persistTransportConnection({ ref: provider.ref, endpointId: session.endpointId, masterKeyBase64 });
    return { path, deviceId: await localDeviceId(), pluginVersion: installed.manifest.version, endpointId: session.endpointId };
  } finally { await session.close(); }
}

export async function seedSyncAcceptance(marker: string) {
  await isolated();
  if (!/^Synthetic sync [AB] 20260913$/.test(marker)) throw Error("Expected synthetic marker");
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><first-name>Synthetic</first-name><last-name>Fixture</last-name></author><book-title>${marker}</book-title><lang>en</lang></title-info><document-info><author><nickname>Acceptance</nickname></author><date>2026-09-13</date><id>${marker}</id><version>1.0</version></document-info></description><body><section><title><p>${marker}</p></title><p>Private marker plaintext only inside encrypted transport: ${marker}.</p></section></body></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: `${marker}.fb2`, data: new TextEncoder().encode(source) });
  return { bookId: book.id, marker, sourceBytes: new TextEncoder().encode(source).length };
}

export async function cycleSyncAcceptance() {
  await isolated();
  const outcome = await syncNow();
  return { outcome, status: getSyncStatusSnapshot(), counts: await createIpcSyncStore().outboxCounts(), profile: await getSyncProfile() };
}

export async function inspectSyncAcceptance() {
  const path = await isolated();
  const library = await import("../../src/features/library/lib/library-db");
  const books = await library.listLibraryBooks();
  return { path, deviceId: await localDeviceId(), books: books.map(book => ({ id: book.id, title: book.title, sourceBlobKey: library.bookFileKey(book.id) })),
    counts: await createIpcSyncStore().outboxCounts(), status: getSyncStatusSnapshot(), profile: await getSyncProfile() };
}

export async function fetchSyncAcceptanceBlob(key: string) {
  await isolated();
  const result = await fetchRemoteBlob(key);
  const bytes = await getDesktopBlob(key);
  return { result, byteSize: bytes?.length ?? null, text: bytes ? new TextDecoder().decode(bytes) : null };
}

export async function disconnectSyncAcceptance() {
  await isolated();
  await disconnectSync();
  return { status: getSyncStatusSnapshot(), profile: await getSyncProfile() };
}
