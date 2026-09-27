import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DocsResource } from "../i18n";
import { pluginPermissionPreviewCopy } from "../lib/plugin-manifest-preview";
import { PluginPermissionPreview } from "./PluginPermissionPreview";

export default function PermissionPreviewSlot({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string) => void;
}) {
  const { t, i18n } = useTranslation("docs");
  const copy = useMemo(() => {
    const resource = i18n.getResource(
      i18n.resolvedLanguage ?? i18n.language,
      "docs",
      "permissionPreview",
    ) as DocsResource["permissionPreview"];
    return pluginPermissionPreviewCopy(resource, {
      count: (key, count) => t(`permissionPreview.${key}`, { count }),
      value: (key, value) => t(`permissionPreview.${key}`, { value }),
    });
  }, [i18n, t]);

  return <PluginPermissionPreview copy={copy} source={source} onChange={onChange} />;
}
