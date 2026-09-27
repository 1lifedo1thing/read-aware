import { useEffect, useEffectEvent } from "react";
import type { ReadingMode } from "../../settings/lib/reader-settings";
import { ReaderEngineSession } from "../lib/reader-engine-session";

/**
 * Own the reader engine's lifetime: open a session for the current engine key,
 * close it when the key changes or the reader unmounts.
 *
 * The key — `source`, `bookId`, `readingMode` — is the ONLY thing that re-opens
 * the book (see `ReaderEngineKey`). `open` and `retiringOrigin` are effect
 * events: they run with the latest props and state, but a new identity never
 * tears the engine down. Handlers that `open` attaches to the engine or to
 * section documents must likewise reach reactive values through effect events
 * (or refs), since the closures they capture outlive the render that made them.
 */
export function useReaderEngineSession<Source, Origin = unknown>({
  source,
  bookId,
  readingMode,
  open,
  retiringOrigin,
}: {
  /** The book to open; nothing is opened while it is null. */
  source: Source | null | undefined;
  bookId: string | null;
  readingMode: ReadingMode;
  /** Start opening into `session`. Runs once per session. */
  open: (session: ReaderEngineSession<Source, Origin>) => void;
  /** The actor retiring the session, resolved at teardown time. */
  retiringOrigin?: () => Origin | undefined;
}): void {
  const openSession = useEffectEvent(open);
  const resolveRetiringOrigin = useEffectEvent(() => retiringOrigin?.());

  useEffect(() => {
    if (source == null) return;
    const session = new ReaderEngineSession<Source, Origin>({ source, bookId, readingMode });
    openSession(session);
    return () => session.close(resolveRetiringOrigin());
  }, [source, bookId, readingMode]);
}
