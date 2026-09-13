import { appDataDir } from "@tauri-apps/api/path";
import { createLibraryDomain } from "../../src/domain/library";

const FULL2_PROFILE_SUFFIX = "/com.readaware.app.validation-full2-e2e";
const ownedBookIds: string[] = [];
let ownedFixture: Full2BookAccessFixture | undefined;

export type Full2BookAccessFixture = Readonly<{
  profile: string;
  marker: string;
  bookIds: readonly [string, string];
}>;

export type Full2BookAccessCleanup = Readonly<{
  profile: string;
  removed: readonly string[];
  remainingBookIds: readonly string[];
}>;

function normalizeProfile(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Every fixture operation is restricted to the synthetic Full2 data directory. */
export async function assertFull2BookAccessProfile(): Promise<string> {
  const profile = normalizeProfile(await appDataDir());
  if (!profile.endsWith(FULL2_PROFILE_SUFFIX)) {
    throw new Error("Requires isolated full2 validation profile");
  }
  return profile;
}

/** Return a copy so callers cannot mutate the helper's cleanup ownership. */
export function getFull2BookAccessFixtureIds(): readonly string[] {
  if (!ownedBookIds.length) throw new Error("Prepare the Full2 book access fixture first");
  return [...ownedBookIds];
}

/**
 * Import two distinct, non-empty text books through the production library
 * command. The IDs remain owned by this helper until explicit cleanup.
 */
export async function prepareFull2BookAccessFixture(): Promise<Full2BookAccessFixture> {
  const profile = await assertFull2BookAccessProfile();
  if (ownedFixture || ownedBookIds.length) {
    throw new Error("Clean up the previous Full2 book access fixture first");
  }

  const marker = `full2-book-access-${crypto.randomUUID()}`;
  const sources = [
    {
      fileName: `${marker}-a.txt`,
      content: `${marker} A\nThis is the first synthetic book for the Full2 access probe.\n`,
    },
    {
      fileName: `${marker}-b.txt`,
      content: `${marker} B\nThis is the second synthetic book for the Full2 access probe.\n`,
    },
  ] as const;
  const library = createLibraryDomain("user");

  for (const source of sources) {
    const data = new TextEncoder().encode(source.content);
    const book = await library.commands.books.importBook({ fileName: source.fileName, data });
    if (!book.id) {
      throw new Error(`Full2 fixture import did not persist ${source.fileName}`);
    }
    ownedBookIds.push(book.id);
    if (book.fileSize !== data.byteLength) {
      throw new Error(`Full2 fixture import did not persist ${source.fileName}`);
    }
  }

  const bookIds = [ownedBookIds[0]!, ownedBookIds[1]!] as const;
  ownedFixture = { profile, marker, bookIds };
  return ownedFixture;
}

/** Remove exactly the two books created by prepareFull2BookAccessFixture. */
export async function cleanupFull2BookAccessFixture(): Promise<Full2BookAccessCleanup> {
  const profile = await assertFull2BookAccessProfile();
  const ids = [...ownedBookIds];
  if (!ids.length) {
    throw new Error("No Full2 book access fixture is prepared");
  }

  const library = createLibraryDomain("user");
  const existing = new Set((await library.queries.books.list()).map(book => book.id));
  const missing = ids.filter(id => !existing.has(id));
  if (missing.length) throw new Error(`Full2 fixture books are missing: ${missing.join(", ")}`);

  const removal = await library.commands.books.removeMany(ids);
  let release = removal.files;
  if (release.status === "pending") {
    release = (await library.commands.books.retryRemovalCleanup(ids)).files;
  }
  if (release.status === "pending") {
    throw new Error(`Full2 fixture file cleanup is pending: ${release.errorCode}`);
  }

  const remainingBookIds = (await library.queries.books.list())
    .map(book => book.id)
    .filter(id => ids.includes(id));
  if (remainingBookIds.length) {
    throw new Error(`Full2 fixture books remain after cleanup: ${remainingBookIds.join(", ")}`);
  }

  ownedBookIds.splice(0);
  ownedFixture = undefined;
  return { profile, removed: ids, remainingBookIds };
}
