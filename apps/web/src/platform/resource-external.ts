import { ask } from "@tauri-apps/plugin-dialog";
import { AppError } from "@read-aware/core";
import { i18n } from "../i18n";
import { isTauri, isMobileOS } from "./environment";
import { invoke } from "./ipc";

export async function openAssociatedResource(id: string, filename: string, signal?: AbortSignal, beforeWrite?: () => void): Promise<boolean> {
  if (!isTauri() || isMobileOS()) throw new AppError("ui/unavailable", "Associated applications require desktop");
  signal?.throwIfAborted(); beforeWrite?.();
  const approved = await ask(i18n.t("plugins:externalResource.description", { name: filename }), {
    title: i18n.t("plugins:externalResource.title"), kind: "info",
    okLabel: i18n.t("plugins:externalResource.open"), cancelLabel: i18n.t("plugins:externalResource.cancel"),
  });
  signal?.throwIfAborted(); beforeWrite?.();
  if (!approved) return false;
  await invoke("resource_open_associated", { id, filename });
  return true;
}
