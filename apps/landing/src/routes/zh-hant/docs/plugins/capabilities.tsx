import { createFileRoute } from "@tanstack/react-router";
import { PluginCapabilitiesPage } from "../../../../components/PluginCapabilitiesPage";
import { docsPageMeta } from "../../../../i18n";

import { validateExplorerSearch } from "../../../../lib/plugin-capabilities";

export const Route = createFileRoute("/zh-hant/docs/plugins/capabilities")({
  validateSearch: validateExplorerSearch,
  head: ({ match }) => docsPageMeta(match.context.i18n, "pluginsCapabilities"),
  component: PluginCapabilitiesPage,
});
