import { afterEach, expect, spyOn, test } from "bun:test";
import * as environment from "../../../../platform/environment";
import * as ipc from "../../../../platform/ipc";
import * as source from "../../../../domain/book-digest";
import { createBookMemoryPort } from "./book-memory-port";

const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });
function own<T extends { mockRestore(): void }>(spy: T): T { restores.push(() => spy.mockRestore()); return spy; }
const row = (contentVersion?: string) => ({ bookId: "b", chapterIndex: 0, chapterHref: "chapter", contentVersion,
  summary: "Earlier edition", charactersJson: "[]", relationsJson: "[]", digestVersion: 2 });

test("production book memory reads exclude old and unversioned sources before graph/prompt consumers", async () => {
  own(spyOn(environment, "isTauri").mockReturnValue(true));
  own(spyOn(source, "getDigestContentVersion").mockResolvedValue("sha256:current"));
  const native = own(spyOn(ipc, "invoke").mockResolvedValue([row("sha256:old"), { ...row(), chapterIndex: 1 }, { ...row("sha256:current"), chapterIndex: 2 }]));
  const result = await createBookMemoryPort().listDigests("b");
  expect(result.map(item => item.chapterIndex)).toEqual([2]);
  expect(native).toHaveBeenCalledWith("chapter_digests_list", { bookId: "b", contentVersion: "sha256:current" });
});

test("source replacement during the native read rejects the whole graph result", async () => {
  own(spyOn(environment, "isTauri").mockReturnValue(true));
  own(spyOn(source, "getDigestContentVersion").mockResolvedValueOnce("sha256:old").mockResolvedValueOnce("sha256:new"));
  own(spyOn(ipc, "invoke").mockResolvedValue([row("sha256:old")]));
  await expect(createBookMemoryPort().listDigests("b")).rejects.toMatchObject({ code: "memory/conflict" });
});
