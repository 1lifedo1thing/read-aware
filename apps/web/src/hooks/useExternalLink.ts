import type { MouseEvent } from "react";
import { useToast } from "@read-aware/ui";
import { describeError } from "../i18n";
import { openExternalUrl } from "../platform/external-link";
import { createLogger } from "../platform/logger";

const log = createLogger("external-link");

/** Keep a real href for browser/link semantics; Tauri needs the native opener. */
export function useExternalLink() {
  const { toast } = useToast();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalUrl(event.currentTarget.href).catch(error => {
      log.error("Could not open link", error);
      toast({ variant: "destructive", description: describeError(error).body });
    });
  };
}
