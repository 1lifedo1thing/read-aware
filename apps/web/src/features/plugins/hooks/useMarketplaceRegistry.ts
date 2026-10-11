import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../../../platform/logger";
import { fetchMarketplaceRegistry, type MarketplaceLoadState } from "../runtime/marketplace";

const log = createLogger("plugins");

/**
 * The marketplace index, fetched while `enabled` and again whenever
 * `refreshToken` changes. Only the latest request may settle the state.
 */
export function useMarketplaceRegistry({ enabled = true, refreshToken = 0 } = {}) {
  const [state, setState] = useState<MarketplaceLoadState>({ status: "loading" });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setState({ status: "loading" });
    try {
      const entries = await fetchMarketplaceRegistry();
      if (request === latest.current) setState({ status: "ready", entries });
    } catch (error) {
      log.error("marketplace registry fetch failed", error);
      if (request === latest.current) setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load, refreshToken]);

  return { state, reload: load };
}
