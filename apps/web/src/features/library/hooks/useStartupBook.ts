import { useEffect, useRef } from "react";
import type { StartView } from "../../settings/lib/general-settings";
import type { LibraryBook } from "../lib/library-types";

/** Consume the launch preference once, after local books and their providers load. */
export function useStartupBook({ startView, ready, idle, books, openBook, reportError }: {
  startView: StartView;
  ready: boolean;
  idle: boolean;
  books: LibraryBook[];
  openBook(book: LibraryBook): void;
  reportError(error: unknown): void;
}) {
  const preference = useRef(startView);
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    if (!idle || preference.current !== "resume") { consumed.current = true; return; }
    // A delayed plugin startup must not move the user away from work begun since launch.
    const cancel = () => { consumed.current = true; };
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    if (ready) {
      consumed.current = true;
      let latest: LibraryBook | undefined, timestamp = -Infinity;
      for (const book of books) {
        const opened = book.lastOpenedAt ? Date.parse(book.lastOpenedAt) : NaN;
        if (Number.isFinite(opened) && opened > timestamp) { latest = book; timestamp = opened; }
      }
      // Never substitute a newly imported/edited book for the last book actually opened.
      if (latest) {
        try { openBook(latest); }
        catch (error) { reportError(error); }
      }
    }
    return () => {
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [ready, idle, books, openBook, reportError]);
}
