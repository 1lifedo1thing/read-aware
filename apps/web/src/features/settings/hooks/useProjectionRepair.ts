import { useLayoutEffect, useSyncExternalStore } from "react";
import { hostProjectionRepairFlow, projectionRepair } from "../../../services/diagnostics";

export function useProjectionRepair() {
  const state = useSyncExternalStore(projectionRepair.subscribe, projectionRepair.snapshot);
  useLayoutEffect(() => {
    const off = hostProjectionRepairFlow.bind(projectionRepair);
    return () => { off(); projectionRepair.close(); };
  }, []);
  return { state, close: projectionRepair.close, confirm: projectionRepair.confirm,
    open: () => projectionRepair.open({ action: "repair" }) };
}
