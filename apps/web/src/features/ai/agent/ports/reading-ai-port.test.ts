import { expect, spyOn, test } from "bun:test";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import { createScriptedThread } from "@read-aware/agent/testing/scripted-thread";
import { ReadingSessionController } from "../../../../domain/reading-session-controller";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { readerPanels } from "../../../../services/reader-panels";
import { readingAiActions } from "../../../../services/reading-ai-runtime";
import { buildRuntimeDeps } from "./index";
import { initI18n } from "../../../../i18n";

for (const kind of ["book", "global"] as const) test(`${kind}: read selection directly in-book, start grouped reading actions globally`, async () => {
  await initI18n("en");
  const session = new ReadingSessionController(() => {}).snapshot();
  Object.assign(session, { status: "ready", sessionId: "session", bookId: "book", location: { bookId: "book", contentVersion: "v1", href: "chapter.xhtml" },
    selection: { id: "selection", text: "Selected meaning", textLength: 16, range: null } });
  const spies = [spyOn(readingRuntime, "snapshot").mockReturnValue(session),
    spyOn(readerPanels, "setPanel").mockResolvedValue({ status: "completed", sessionId: "session", panel: "chat", open: true } as never)];
  const { deps } = createInMemoryDeps({ books: [{ id: "book", title: "Test", author: "Test", progressPercent: 10, status: "reading", narrativity: "expository", spoilerSensitive: false }] });
  const native = buildRuntimeDeps();
  deps.readingAiActions = native.readingAiActions;
  deps.reader.getSession = native.reader.getSession;
  let sends = 0;
  const unbind = readingAiActions.bind("book", { send: () => { sends++; return "started"; } });
  const scripted = createScriptedThread(kind === "book" ? { kind, bookId: "book" } : { kind, threadId: "reading-task" }, deps,
    kind === "book" ? [{ name: "get_reading_session", arguments: {} }] : [{ name: "reading_action", arguments: { request: { operation: "define" } } }]);
  try {
    const chunks = [];
    for await (const chunk of scripted.thread.sendTurn({ text: "Define the selected term." })) chunks.push(chunk);
    const end = chunks.find(chunk => chunk.type === "tool-step" && chunk.phase === "end" && chunk.tool !== "get_host_capabilities");
    expect(end).toMatchObject({ tool: kind === "book" ? "get_reading_session" : "reading_action", isError: false });
    const output = JSON.parse((end as { output: string }).output);
    if (kind === "book") {
      expect(output).toMatchObject({ bookId: "book", selection: { text: "Selected meaning" } });
      expect(readerPanels.setPanel).not.toHaveBeenCalled();
      expect(sends).toBe(0);
    } else {
      expect(output).toMatchObject({ status: "started", action: "defineTerm", bookId: "book" });
      expect(readerPanels.setPanel).toHaveBeenCalledWith("chat", true, expect.any(AbortSignal), { bookId: "book", sessionId: "session" }, expect.objectContaining({ origin: "agent", cause: expect.any(Object) }));
      expect(sends).toBe(1);
    }
  } finally { scripted.dispose(); unbind(); for (const spy of spies) spy.mockRestore(); }
});
