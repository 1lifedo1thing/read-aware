import { useCallback, useRef } from "react";
import { useAtom, useStore } from "jotai";
import { useToast } from "@read-aware/ui";
import { describeError } from "../../../i18n";
import { IpcError } from "../../../platform/ipc";
import { createLogger } from "../../../platform/logger";
import { actorFromEvent, causalActor, stampEventCause } from "../../../platform/domain-actor";
import {
  clampPanelWidth,
  readerPanelSizesAtom,
  readReaderPanelSizes,
  updateReaderPanelWidth,
  type ReaderPanelSizes,
} from "../lib/reader-panel-sizes";
const log = createLogger("reader-panel-sizes");

/**
 * Live, drag-adjustable widths for the reader's side panels. `adjust` applies an
 * incremental drag delta (clamped) for snappy resizing; `persist` writes the
 * final widths to storage on release.
 */
export function useReaderPanelSizes() {
  const [sizes, setSizes] = useAtom(readerPanelSizesAtom);
  const store = useStore();
  const { toast } = useToast();
  const changed = useRef<keyof ReaderPanelSizes | null>(null);

  const adjust = useCallback(
    (key: keyof ReaderPanelSizes, deltaPx: number) => {
      if (!Number.isFinite(deltaPx)) return;
      changed.current = key;
      const origin = causalActor("user");
      setSizes((prev) => stampEventCause({ ...prev, [key]: clampPanelWidth(prev[key] + deltaPx) }, origin));
    },
    [setSizes],
  );

  const persist = useCallback(() => {
    const panel = changed.current;
    changed.current = null;
    if (!panel) return;
    const sizes = store.get(readerPanelSizesAtom), origin = actorFromEvent(sizes, "user");
    void updateReaderPanelWidth(panel, sizes[panel], undefined, origin).catch(error => {
      if (store.get(readerPanelSizesAtom) === sizes) store.set(readerPanelSizesAtom, readReaderPanelSizes(origin));
      log.warn("Panel width save failed", error);
      // Native KV failures already have a global localized write-failure toast.
      if (!(error instanceof IpcError && error.command === "set_kv")) toast({ variant: "destructive", description: describeError(error).body });
    });
  }, [store, toast]);

  return { sizes, adjust, persist };
}
