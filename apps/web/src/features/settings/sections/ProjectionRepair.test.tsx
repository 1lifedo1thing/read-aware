import { expect, mock, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
if (process.env.PROJECTION_REPAIR_UI_CASE === "1") {
  test("mounted host UI requires an explicit repair click and keeps the reload prompt after caller cancellation", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
    let writes = 0;
    const native = Promise.withResolvers<void>();
    mock.module("../lib/projection-repair-apply", () => ({ applyProjectionRepair: async () => { writes++; await native.promise; } }));
    const { hostDiagnostics, hostProjectionRepairFlow } = await import("../../../services/diagnostics");
    const { workspace } = await import("../../../services/workspace");
    const { initI18n } = await import("../../../i18n");
    const { ProjectionRepair } = await import("./ProjectionRepair");
    spyOn(workspace, "navigate").mockResolvedValue({ status: "completed" } as never);
    spyOn(hostDiagnostics, "verifyProjections").mockResolvedValue({ scope: "event-projections", checkedAt: "2026-09-12",
      consistent: false, eventsReplayed: 4, driftedTables: 1, onlyLiveRows: 2, onlyReplayedRows: 3 });
    await initI18n("en");
    const root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(<ProjectionRepair />); });
    const caller = new AbortController();
    let request!: Promise<unknown>;
    await act(async () => { request = hostProjectionRepairFlow.request({ action: "repair" }, caller.signal).catch(error => error); await Bun.sleep(0); });
    expect(writes).toBe(0); expect(document.body.textContent).toContain("2 rows only in current data");
    const confirm = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Confirm repair")!;
    expect(confirm).toBeDefined();
    await act(async () => { confirm.click(); await Bun.sleep(0); });
    expect(writes).toBe(1); expect(document.body.textContent).toContain("Rebuilding local projections");
    await act(async () => { caller.abort(); native.resolve(); await request; await Bun.sleep(0); });
    expect(document.body.textContent).toContain("Writes remain paused");
    expect(document.body.textContent).toContain("Reload app");
    await act(async () => { root.unmount(); }); dom.window.close();
  });
} else {
  test("isolated projection repair confirmation UI", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, PROJECTION_REPAIR_UI_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text(); expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 pass");
  }, 30_000);
}
