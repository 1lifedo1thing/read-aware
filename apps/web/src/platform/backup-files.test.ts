import { expect, spyOn, test } from "bun:test";

if (process.env.BACKUP_FILES_PROOF === "1") {
  type Call = { command: string; args: any; options?: any };
  type Pending = Call & { resolve(value?: unknown): void; reject(error: unknown): void };
  const calls: Call[] = [], pending: Pending[] = [], holds = new Set<string>();
  const receipt = { sha256: "a".repeat(64), byteSize: 7 };
  let failChunk = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    async invoke(command: string, args: any, options?: any) {
      calls.push({ command, args, options });
      if (holds.has(command)) return new Promise((resolve, reject) => pending.push({ command, args, options, resolve, reject }));
      if (failChunk && ["blob_write_chunk", "blob_write_chunk_raw"].includes(command)) throw { code: "db/locked", message: "synthetic chunk failure" };
      if (["put_blob", "blob_write_commit"].includes(command)) return receipt;
      if (command === "local_device_get") return { deviceId: "files-proof", lastHlcWallMs: null, lastHlcCounter: null };
      if (command === "commit_events") return { appended: args.events.length, applied: args.events.length };
      if (["ai_chat_load", "reading_sessions_pending", "restored_credentials_pending"].includes(command)) return [];
      if (command === "backup_close_reading_sessions") return [];
      return undefined;
    },
  } } });
  const blobs = await import("./blob-store"), environment = await import("./environment");
  const { withDomainBackup } = await import("./domain-write-gate");
  const { saveConversation, clearConversation } = await import("../features/ai/lib/conversation-store");
  const { importBackup } = await import("../features/settings/lib/backup-io");
  const { pendingImportPlaceholder } = await import("../features/library/lib/book-import");
  const library = await import("../features/library/lib/library-db");
  const { saveAnnotation } = await import("../features/annotations/lib/annotation-db");
  const { durableWrites } = await import("./write-settlement");
  const tick = () => Bun.sleep(0);
  const take = (command: string) => {
    const index = pending.findIndex(call => call.command === command);
    expect(index).toBeGreaterThanOrEqual(0); return pending.splice(index, 1)[0]!;
  };

  test.each(["raw", "large", "mobile"])("%s blob writes retain admission through their final physical commit", async mode => {
    const mobile = spyOn(environment, "isMobileOS").mockReturnValue(mode === "mobile");
    const command = mode === "raw" ? "put_blob" : "blob_write_commit";
    const bytes = new Uint8Array(mode === "large" ? 9 * 1024 * 1024 : mode === "mobile" ? 300 * 1024 : 7).fill(13);
    holds.add(command); let captured = false;
    const write = blobs.putDesktopBlob(`booktext:${mode}`, bytes, "application/json");
    const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(captured).toBe(false);
    take(command).resolve(receipt); expect(await write).toEqual(receipt); await backup;
    expect(captured).toBe(true); holds.clear(); mobile.mockRestore();
  });

  test.each([false, true])("failed staged upload waits for abort cleanup, preserving its original failure (mobile=%s)", async mobileMode => {
    const mobile = spyOn(environment, "isMobileOS").mockReturnValue(mobileMode);
    holds.add("blob_write_abort"); failChunk = true;
    let ended = false, captured = false;
    const write = blobs.putDesktopBlob("bookfile:failed", new Uint8Array(9 * 1024 * 1024)).catch(error => { ended = true; return error; });
    const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(ended).toBe(false); expect(captured).toBe(false);
    take("blob_write_abort").resolve(); expect(await write).toMatchObject({ code: "db/locked" });
    await backup; expect(captured).toBe(true); failChunk = false; holds.clear(); mobile.mockRestore();
  });

  test.each([false, true])("an incremental writer commits through the same physical boundary (mobile=%s)", async mobileMode => {
    const mobile = spyOn(environment, "isMobileOS").mockReturnValue(mobileMode);
    const writer = await blobs.openDesktopBlobWriter("bookfile:incremental");
    await writer.append(new Uint8Array([1, 2, 3]));
    expect(calls.at(-1)?.command).toBe(mobileMode ? "blob_write_chunk" : "blob_write_chunk_raw");
    holds.add("blob_write_commit");
    const work = writer.commit("application/epub+zip"); let captured = false;
    const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(captured).toBe(false);
    take("blob_write_commit").resolve(receipt); expect(await work).toEqual(receipt);
    await backup; holds.clear(); mobile.mockRestore();
  });

  test("capture rejects fresh blob mutations and a prepared stream's commit, but permits buffer cleanup", async () => {
    const writer = await blobs.openDesktopBlobWriter("bookfile:stream");
    await writer.append(new Uint8Array([1, 2]));
    await withDomainBackup(async () => {
      const before = calls.length;
      for (const run of [() => blobs.putDesktopBlob("booktext:new", new Uint8Array([1])), () => blobs.deleteDesktopBlob("bookfile:old"),
        () => blobs.openDesktopBlobWriter("bookfile:new"), () => writer.commit()]) {
        await expect(run()).rejects.toMatchObject({ code: "backup/busy" });
      }
      expect(calls).toHaveLength(before);
      await writer.abort(); expect(calls.at(-1)?.command).toBe("blob_write_abort");
    });
    await blobs.deleteDesktopBlob("bookfile:old"); expect(calls.at(-1)?.command).toBe("delete_blob");
  });

  test("a chat save captures one candidate and drains presentation state after its events", async () => {
    const conversationId = "thread-save-proof";
    const messages: import("../features/ai/lib/chat-types").ChatMessage[] = [{ id: "answer", role: "assistant", content: "accepted", createdAt: "2026-09-12T00:00:00Z", parts: [{ type: "text", text: "accepted" }] }];
    holds.add("ai_chat_load"); holds.add("ai_chat_replace");
    const write = saveConversation(conversationId, messages);
    messages[0]!.content = "later"; messages[0]!.parts = [{ type: "text", text: "later" }];
    let captured = false;
    const backup = withDomainBackup(async () => { captured = true; });
    await tick(); expect(captured).toBe(false); take("ai_chat_load").resolve([]);
    await tick(); expect(captured).toBe(false);
    const replace = take("ai_chat_replace");
    expect(replace.args.messages[0]).toMatchObject({ content: "accepted", partsJson: '[{"type":"text","text":"accepted"}]' });
    const event = calls.filter(call => call.command === "commit_events").flatMap(call => call.args.events).find(event => event.type === "aiMessage.appended" && event.payload.messageId === "answer");
    expect(event.payload.content).toBe("accepted");
    replace.resolve(); await write; await backup; holds.clear();
    await withDomainBackup(async () => {
      const before = calls.length;
      // Existing IDs produce no new events: presentation-only saves still fence.
      await expect(saveConversation(conversationId, messages)).rejects.toMatchObject({ code: "backup/busy" });
      await expect(clearConversation(conversationId)).rejects.toMatchObject({ code: "backup/busy" });
      expect(calls).toHaveLength(before);
    });
    holds.add("ai_chat_clear");
    const clear = clearConversation(conversationId); let closed = false;
    const closing = withDomainBackup(async () => { closed = true; });
    await tick(); expect(closed).toBe(false); take("ai_chat_clear").resolve();
    await clear; await closing; holds.clear(); expect(durableWrites.size).toBe(0);
  });

  test("v1 owns complete book/file/collection/annotation restoration while ordinary restores remain fenced", async () => {
    const book = pendingImportPlaceholder("restored", { kind: "native-path", path: "/unused/source.txt", name: "source.txt", size: 7 }, "txt");
    const collection = { id: "collection", name: "Restored", createdAt: "2026-09-12T00:00:00Z" };
    const annotation: import("../features/annotations/lib/annotation-types").Note = { id: "note", bookId: book.id, type: "note", text: "quote", content: "note", cfiRange: null, chapterHref: null, createdAt: collection.createdAt, updatedAt: collection.createdAt };
    holds.add("put_blob"); holds.add("annotation_put"); const controller = new AbortController();
    const backup = importBackup(JSON.stringify({ kind: "backup", books: [book], collections: [collection], annotations: [annotation], files: { [book.id]: btoa("example") } }), controller.signal);
    let restored = false; void backup.then(() => { restored = true; });
    await tick(); const file = take("put_blob");
    expect(new TextDecoder().decode(file.args)).toBe("example");
    expect(file.options.headers["x-blob-key"]).toBe(`bookfile:${book.id}`);
    controller.abort();
    for (const run of [() => library.restoreLibraryBook(book, null), () => library.restoreCollection(collection), () => saveAnnotation(annotation)]) {
      await expect(run()).rejects.toMatchObject({ code: "backup/busy" });
    }
    file.resolve(receipt); await tick(); expect(restored).toBe(false);
    take("annotation_put").resolve();
    expect(await backup).toMatchObject({ books: 1, collections: 1, annotations: 1 });
    holds.clear(); expect(durableWrites.size).toBe(0);
  });
} else {
  test("isolated blob, presentation and production restore admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_FILES_PROOF: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("10 pass");
  }, 30_000);
}
