import { useCallback, useEffect, useRef, useState } from "react";
import type { ReadingModeSnapshot } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { readingRuntime } from "../../../domain/reading-runtime";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-mode-selection");

/** Mount on the reader, not a picker that may disappear when selection changes. */
export function useReaderModeSelection(bookId: string, mode?: ReadingModeSnapshot) {
  const { toast } = useToast();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(false);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [bookId]);
  // Only these two fields feed a selection; a new snapshot object alone must not.
  const requestedActive = mode?.requestedActive, modeKey = mode?.modeKey;
  const select = useCallback(async (selectModeKey: string) => {
    if (requestedActive === undefined || pending.current) return false;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const sessionId = readingRuntime.snapshot().sessionId ?? undefined;
      await readingRuntime.configureMode({ active: requestedActive, modeKey: modeKey ?? undefined, selectModeKey },
        controller.signal, { bookId, sessionId });
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        log.warn("Mode provider selection failed", error);
        const message = describeError(error);
        toast({ variant: "destructive", description: message.body });
      }
      return false;
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }, [bookId, modeKey, requestedActive, toast]);
  return { select, busy };
}
