import { expect, test } from "bun:test";
import { createInMemoryDeps } from "./fixtures";

test("book settings isolate their override, inherit global changes and roll back invalid batches", async () => {
  const { deps, stores } = createInMemoryDeps();
  const read = async (bookId?: string) => (await deps.settings.getSettings({ target: bookId ? { kind: "book", bookId } : { kind: "global" } })).settings.find(s => s.path === "reading.theme")?.value;
  await deps.settings.updateSettings([{ path: "reading.theme", value: "dark", target: { kind: "book", bookId: "one" } }]);
  expect(await read("one")).toBe("dark"); expect(await read()).toBe("warm"); expect(await read("two")).toBe("warm");
  const before = structuredClone(stores.bookSettings);
  await expect(deps.settings.updateSettings([{ path: "reading.theme", value: "light", target: { kind: "book", bookId: "one" } },
    { path: "invalid", value: true }])).rejects.toThrow();
  expect(stores.bookSettings).toEqual(before);
  await deps.settings.updateSettings([{ path: "reading.theme", value: "light", target: { kind: "global" } }]);
  expect(await read("one")).toBe("dark"); expect(await read("two")).toBe("light");
  await deps.settings.updateSettings([{ path: "reading.theme", value: "light", target: { kind: "all-books" } }]);
  expect(await read("one")).toBe("light"); expect(await read("two")).toBe("light");
});
