import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  validateExplorerSearch,
  type ExplorerSearch,
} from "../lib/plugin-capabilities";

export function useCapabilityExplorer() {
  const location = useRouterState({ select: (state) => state.location });
  const navigate = useNavigate();
  const search = validateExplorerSearch(location.search);
  function update(patch: ExplorerSearch, replace = true) {
    void navigate({
      to: location.pathname as never,
      search: { ...search, ...patch } as never,
      replace,
      resetScroll: false,
    });
  }
  function reset() {
    void navigate({
      to: location.pathname as never,
      search: {} as never,
      replace: true,
      resetScroll: false,
    });
  }
  return { search, update, reset };
}
