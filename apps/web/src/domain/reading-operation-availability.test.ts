import { expect, test } from "bun:test";
import { ReadingSessionController } from "./reading-session-controller";
import { ReadAloudController } from "../features/reader/lib/read-aloud-controller";
import { ReadingModeController } from "../features/reader/lib/reading-mode-controller";

function fixture() {
  const runtime = new ReadingSessionController();
  const sessionId = runtime.begin("book");
  const location = { bookId: "book", contentVersion: "version", cfi: "private-location" };
  runtime.attach(sessionId, { navigate: async () => location, step: async () => location }, location);
  return { runtime, sessionId };
}

test("playback discovery samples actual voice inputs and execution rejects conditions that changed afterward", async () => {
  const { runtime, sessionId } = fixture();
  let systemAvailable = true, dispatches = 0;
  const controller = new ReadAloudController({ systemAvailable: () => systemAvailable,
    speak: (_text, callbacks) => { dispatches++; callbacks.onStart(); return { cancel() {} }; },
    play: () => { throw new Error("No synthesis expected"); }, report() {},
  });
  const input = { enabled: true, voice: null, unit: { text: "private passage", cfiRange: "private-location" },
    next: async () => "end-of-book" as const, peekNext: () => null };
  controller.update(input); runtime.bindPlayback(sessionId, controller);
  const query = { operation: "reading.playback" as const, bookId: "book", sessionId, action: "start" as const };
  try {
    const available = runtime.operationAvailability(query);
    expect(available.state).toBe("unknown"); expect(dispatches).toBe(0);
    expect(JSON.stringify(available)).not.toContain("private");
    // OS voice availability may change without a React update or published snapshot.
    systemAvailable = false;
    expect(runtime.operationAvailability(query).conditions).toContainEqual(expect.objectContaining({ reason: "no-voice", state: "unconfigured" }));
    await expect(runtime.controlPlayback("start", "agent", undefined, query)).rejects.toMatchObject({ code: "reader/unavailable" });
    expect(dispatches).toBe(0);
    expect(runtime.operationAvailability({ ...query, action: "stop" }).state).toBe("available");
    await runtime.controlPlayback("stop", "agent", undefined, query);
    systemAvailable = true;
    await runtime.controlPlayback("start", "plugin:consumer", undefined, query);
    expect(dispatches).toBe(1);
    controller.update({ ...input, enabled: false });
    expect(runtime.operationAvailability(query).conditions).toContainEqual(expect.objectContaining({ reason: "mode-inactive" }));
    controller.update({ ...input, unit: null });
    expect(runtime.operationAvailability(query).conditions).toContainEqual(expect.objectContaining({ reason: "no-unit" }));
  } finally { runtime.closed(); }
});

test("mode query shares provider, unit and format validation; deactivation survives provider removal", async () => {
  const { runtime, sessionId } = fixture();
  const controller = new ReadingModeController();
  const mode = { key: "plugin:mode", label: "Mode", units: [{ id: "sentence", label: "Sentence" }], defaultUnitId: "sentence" };
  controller.environment(mode, true); runtime.bindMode(sessionId, controller);
  const query = { operation: "reading.mode.configure" as const, bookId: "book", sessionId, active: true };
  try {
    expect(runtime.operationAvailability(query).state).toBe("unknown");
    const wrongUnit = { ...query, unitId: "missing" };
    expect(runtime.operationAvailability(wrongUnit).conditions).toContainEqual(expect.objectContaining({ reason: "unknown-mode-unit" }));
    await expect(runtime.configureMode(wrongUnit, undefined, query)).rejects.toMatchObject({ code: "reader/invalid-target" });
    expect(runtime.operationAvailability({ ...query, modeKey: "retired" }).conditions).toContainEqual(expect.objectContaining({ reason: "mode-provider-changed" }));
    expect(runtime.operationAvailability({ ...query, selectModeKey: "missing" }).conditions).toContainEqual(expect.objectContaining({ reason: "mode-provider-not-registered" }));
    controller.environment(mode, false);
    expect(runtime.operationAvailability(query).conditions).toContainEqual(expect.objectContaining({ reason: "unsupported-format" }));
    controller.environment(null, true);
    expect(runtime.operationAvailability(query).state).toBe("unconfigured");
    await expect(runtime.configureMode({ active: true }, undefined, query)).rejects.toMatchObject({ code: "reader/unavailable" });
    expect(runtime.operationAvailability({ ...query, active: false }).state).toBe("available");
    expect((await runtime.configureMode({ active: false }, undefined, query)).status).toBe("completed");
    controller.environment(mode, true);
    const start = runtime.configureMode({ active: true }, undefined, query);
    controller.feedback(controller.generation(), mode.key, "sentence", { status: "ready", progress: { ordinal: 0, total: 1 }, cfiRange: "private" });
    expect((await start).mode.status).toBe("ready");
  } finally { runtime.closed(); }
});

test("target/session failures never disclose another book's provider or reading state", () => {
  const { runtime, sessionId } = fixture();
  const query = { operation: "reading.playback" as const, bookId: "other", action: "start" as const };
  try {
    expect(runtime.operationAvailability(query).conditions).toEqual([
      { kind: "permission", state: "satisfied", reason: "authorized" },
      { kind: "object", state: "unavailable", reason: "book-not-active", errorCode: "reader/superseded" },
    ]);
    expect(runtime.operationAvailability({ ...query, bookId: "book", sessionId: "retired" }).conditions).toContainEqual(expect.objectContaining({ reason: "reading-session-changed" }));
    expect(runtime.operationAvailability({ ...query, bookId: "book", sessionId }).conditions).toContainEqual(expect.objectContaining({ reason: "operation-not-attached" }));
    runtime.begin("book");
    expect(runtime.operationAvailability({ ...query, bookId: "book" }).conditions).toContainEqual(expect.objectContaining({ reason: "reader-not-ready" }));
    runtime.closed();
    expect(runtime.operationAvailability(query).conditions).toContainEqual(expect.objectContaining({ reason: "no-reading-session" }));
  } finally { runtime.closed(); }
});
