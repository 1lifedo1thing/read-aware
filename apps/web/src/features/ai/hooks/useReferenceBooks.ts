/**
 * Hydrates book reference cards: bookId → live LibraryBook (cover data URL,
 * progress) from the shared shelf projection maintained by the app controller.
 * Returns null while loading; ids missing
 * from the map mean the book has left the shelf (cards fall back to their
 * persisted snapshot).
 */
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { libraryBooksAtom, libraryReadyAtom } from "../../library/state/library-store";
import type { LibraryBook } from "../../library/lib/library-types";

export function useReferenceBooks(bookIds: string[]): Map<string, LibraryBook> | null {
  const shelf = useAtomValue(libraryBooksAtom);
  const ready = useAtomValue(libraryReadyAtom);
  const key = bookIds.join("\n");
  return useMemo(() => {
    if (!ready) return null;
    const wanted = new Set(key.split("\n"));
    return new Map(shelf.filter((book) => wanted.has(book.id)).map((book) => [book.id, book]));
  }, [key, ready, shelf]);
}
