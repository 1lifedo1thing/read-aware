/**
 * The marketplace browser (settings → Plugins → Marketplace): lists the
 * community registry, installs/updates with one click. Community plugins land
 * in the registry repo via pull request (Raycast model) — this surface only
 * reads it.
 *
 * This half owns the effects — fetching the registry, the consent gate, the
 * install call and its toasts (useMarketplaceRegistry / useMarketplaceInstall).
 * The rendering lives in `PluginMarketplaceView`.
 */
import { useState } from "react";
import { useAtomValue } from "jotai";
import { isTauri } from "../../../platform/environment";
import { libraryBooksAtom } from "../../library/state/library-store";
import { useMarketplaceInstall } from "../hooks/useMarketplaceInstall";
import { useMarketplaceRegistry } from "../hooks/useMarketplaceRegistry";
import { installedPluginsAtom } from "../state/plugin-store";
import { PluginMarketplaceView } from "./PluginMarketplaceView";

type PluginMarketplaceProps = {
  /** Bumped by the hosting panel's Refresh action to re-fetch the registry. */
  refreshToken?: number;
};

export function PluginMarketplace({ refreshToken = 0 }: PluginMarketplaceProps) {
  const installed = useAtomValue(installedPluginsAtom);
  const libraryBooks = useAtomValue(libraryBooksAtom);
  const [query, setQuery] = useState("");
  const { state, reload } = useMarketplaceRegistry({ refreshToken });
  const { busyId, install } = useMarketplaceInstall(libraryBooks.map(({ id, title }) => ({ id, title })));

  return (
    <PluginMarketplaceView
      state={state}
      installed={installed}
      busyId={busyId}
      query={query}
      onQueryChange={setQuery}
      desktop={isTauri()}
      onRetry={() => void reload()}
      onInstall={(entry) => void install(entry)}
    />
  );
}
