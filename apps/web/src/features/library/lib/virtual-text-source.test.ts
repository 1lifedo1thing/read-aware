import { expect, spyOn, test } from "bun:test";
import { getVirtualTextSource } from "./virtual-text-source";
import * as registry from "../../plugins/lib/virtual-books";
import * as content from "./book-content-source";
import { invalidateBookContent } from "./content-invalidation";

test("virtual text status does not load content; hashes are reused only within the same provider and source fence", async () => {
  const book = crypto.randomUUID();
  const binding = { pluginId: "rss-reader", providerId: "feed", key: "one" };
  let current: object | null = {}, version = "virtual:sha256:a", onLoad = () => {};
  const spies = [spyOn(registry, "getVirtualBookBinding").mockImplementation(() => binding),
    spyOn(registry, "resolveContentProvider").mockImplementation(() => current as never)];
  let loads = 0;
  const load = spyOn(content, "withBookContent").mockImplementation(async (_bookId, _version, _signal, read) => {
    loads++; onLoad(); return read({ contentVersion: version } as never);
  });
  try {
    expect(await getVirtualTextSource(book, false)).toMatchObject({ contentVersion: null, available: true }); expect(loads).toBe(0);
    expect((await getVirtualTextSource(book, true)).contentVersion).toBe(version); expect(loads).toBe(1);
    expect((await getVirtualTextSource(book, false)).contentVersion).toBe(version); expect(loads).toBe(1);
    invalidateBookContent(book); version = "virtual:sha256:b";
    expect((await getVirtualTextSource(book, false)).contentVersion).toBeNull(); expect(loads).toBe(1);
    expect((await getVirtualTextSource(book, true)).contentVersion).toBe(version); expect(loads).toBe(2);
    current = null;
    expect(await getVirtualTextSource(book, false)).toMatchObject({ available: false, contentVersion: null });
    await expect(getVirtualTextSource(book, true)).rejects.toMatchObject({ code: "library/content-unavailable" });
    current = {}; expect((await getVirtualTextSource(book, false)).contentVersion).toBeNull();
    onLoad = () => { current = {}; };
    await expect(getVirtualTextSource(book, true)).rejects.toMatchObject({ code: "reader/stale-location" });
    expect((await getVirtualTextSource(book, false)).contentVersion).toBeNull();
  } finally { load.mockRestore(); for (const spy of spies) spy.mockRestore(); }
});
