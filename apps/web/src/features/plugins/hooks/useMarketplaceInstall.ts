import { useState } from "react";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { describePluginInstallFailure } from "../lib/install-failure";
import { prepareMarketplaceInstall, type MarketplaceEntry } from "../runtime/marketplace";
import { requestInstallConsent } from "../state/plugin-store";

const log = createLogger("plugins");

/**
 * Install or update one marketplace entry: fetch its real manifest, ask for
 * consent (permissions and book access), then download and install. Shared by
 * the marketplace list and the update action on an outdated installed plugin.
 */
export function useMarketplaceInstall(books: Array<{ id: string; title: string }>) {
  const { t } = useTranslation("plugins");
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function install(entry: MarketplaceEntry): Promise<void> {
    setBusyId(entry.id);
    try {
      const { manifest, complete } = await prepareMarketplaceInstall(entry);
      const consent = await requestInstallConsent(manifest, undefined, books);
      if (!consent.approved) return;
      const plugin = await complete(consent.grant);
      toast({ description: t("settings.installedToast", { name: plugin.manifest.name }), variant: "success" });
    } catch (error) {
      log.error("marketplace install failed", error);
      toast({ description: describePluginInstallFailure(error), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return { busyId, install };
}
