import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DocsResource } from "../i18n";
import {
  PluginCapabilityBrowser,
  type PluginCapabilityBrowserCopy,
} from "./PluginCapabilityBrowser";

type BrowserResource = DocsResource["capabilityBrowser"];

function capabilityDescriptions(
  descriptions: BrowserResource["descriptions"],
): PluginCapabilityBrowserCopy["descriptions"] {
  return Object.fromEntries(
    Object.entries(descriptions).map(([key, value]) => [
      key.replace("__", ":"),
      value,
    ]),
  ) as PluginCapabilityBrowserCopy["descriptions"];
}

export function CapabilityBrowserSlot() {
  const { t, i18n } = useTranslation("docs");
  const copy = useMemo(() => {
    const resource = i18n.getResource(
      i18n.resolvedLanguage ?? i18n.language,
      "docs",
      "capabilityBrowser",
    ) as BrowserResource;
    return {
      ...resource,
      explorer: i18n.getResource(
        i18n.resolvedLanguage ?? i18n.language,
        "docs",
        "explorer",
      ) as DocsResource["explorer"],
      descriptions: capabilityDescriptions(resource.descriptions),
      result: (count: number) => t("capabilityBrowser.result", { count }),
      catalogSummary: (capabilities: number, methods: number) =>
        t("capabilityBrowser.catalogSummary", { capabilities, methods }),
    } satisfies PluginCapabilityBrowserCopy;
  }, [i18n, t]);

  return <PluginCapabilityBrowser copy={copy} />;
}
