import { open } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { invoke } from "../../../platform/ipc";
import { isMobileOS } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { folderListingSources, parseParkedFolderPick, type FolderListing } from "./folder-import";
import type { BookImportSource } from "./library-types";

const log = createLogger("folder-import");

/** A picked folder's books, plus the grant to give back once they are imported. */
export type FolderPick = {
  rootName: string;
  sources: BookImportSource[];
  /** Ends the platform's access to the folder (iOS security scope). Never throws. */
  release: () => Promise<void>;
};

/** Poll cadence + ceiling for the mobile pick flow (picker time plus the walk). */
const PICK_POLL_INTERVAL_MS = 300;
const PICK_POLL_TIMEOUT_MS = 10 * 60 * 1000;

let pickGenerationCounter = 0;

/**
 * Android and iOS: the platform folder picker. The tauri dialog plugin cannot
 * pick folders there, so the shell opens its own and walks the granted folder
 * natively; the outcome is parked and collected by polling, the reliable
 * request/response channel (see `book_pick_start`). Resolves null on cancel.
 */
async function pickFolderMobile(): Promise<FolderListing | null> {
  const generation = ++pickGenerationCounter;
  await invoke("book_folder_pick_start", { generation });
  const deadline = performance.now() + PICK_POLL_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PICK_POLL_INTERVAL_MS));
    const parked = await invoke<string | null>("book_folder_pick_poll");
    if (parked == null) continue;
    const outcome = parseParkedFolderPick(parked, generation);
    if (outcome.kind === "stale") continue;
    return outcome.kind === "cancelled" ? null : outcome.listing;
  }
  return null;
}

/** Desktop: the OS folder dialog, then a Rust walk of the picked folder. */
async function pickFolderDesktop(t: TFunction<"shelf">): Promise<FolderListing | null> {
  const selection = await open({ directory: true, multiple: false, title: t("folderImport.dialogTitle") });
  if (selection == null) return null;
  const path = Array.isArray(selection) ? selection[0] : selection;
  if (!path) return null;
  return invoke<FolderListing>("book_folder_scan", { path });
}

async function releaseFolder(): Promise<void> {
  try {
    await invoke("book_folder_release");
  } catch (error) {
    // The grant also ends with the process; a failed release costs nothing else.
    log.warn("Could not release the picked folder", error);
  }
}

/**
 * Let the user pick a folder and list the importable books below it as
 * import sources (natural order, each with its `sourcePath`). Null when the
 * user cancels. Throws `library/folder-too-large` past the folder limit.
 */
export async function pickBookFolderNative(t: TFunction<"shelf">): Promise<FolderPick | null> {
  const listing = isMobileOS() ? await pickFolderMobile() : await pickFolderDesktop(t);
  if (!listing) return null;
  try {
    const sources = await folderListingSources(listing, (path) => invoke<number>("book_file_size", { path }));
    return { rootName: listing.rootName, sources, release: releaseFolder };
  } catch (error) {
    await releaseFolder();
    throw error;
  }
}
