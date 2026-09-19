import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@read-aware/ui";
import type { HostSyncFlowReceipt } from "@read-aware/core";
import { initI18n } from "../../../i18n";
import * as scheduler from "../../../platform/sync/sync-scheduler";
import type { RegisteredSyncTransport } from "../../../platform/sync/transport-registry";
import * as registry from "../../../platform/sync/transport-registry";
import { hostSyncFlows, syncFlowSection } from "../../../services/sync";
import { workspace } from "../../../services/workspace";
import { snapshot } from "../../sync/components/sync.fixtures";
import { useTransportSyncFlows } from "./useTransportSyncFlows";
import type { useSyncConnection } from "./useSyncConnection";

if (process.env.SYNC_TRANSPORT_FLOW_HOOK_CASE === "1") {
test("a plugin's settings page owns its transport's connect/disconnect flows and nothing else", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const webdav: RegisteredSyncTransport = { ref: "plugin:webdav-sync:webdav", pluginId: "webdav-sync", transportId: "webdav",
    generation: 0, label: "WebDAV", open: () => Promise.reject(new Error("stand-in")) };
  const other: RegisteredSyncTransport = { ...webdav, ref: "plugin:s3-sync:s3", pluginId: "s3-sync", transportId: "s3" };
  let status = snapshot({ accountConnected: false, backend: null }), connects = 0, disconnects = 0;
  const targets: unknown[] = [];
  const mocks = [
    spyOn(workspace, "navigate").mockImplementation(async target => { targets.push(target); return { status: "completed" } as never; }),
    spyOn(scheduler, "getSyncStatusSnapshot").mockImplementation(() => status),
    spyOn(registry, "findSyncTransport").mockImplementation(ref => [webdav, other].find(item => item.ref === ref) ?? null),
  ];
  const sync = { transports: [webdav, other],
    connectTransport: async () => { connects++; }, disconnect: async () => { disconnects++; },
  } as unknown as ReturnType<typeof useSyncConnection>;
  let flows!: ReturnType<typeof useTransportSyncFlows>;
  function Harness() { flows = useTransportSyncFlows(sync, [webdav]); return null; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const tick = () => Bun.sleep(0);
  try {
    await initI18n("en");
    await act(async () => { root.render(<ToastProvider><Harness /></ToastProvider>); });

    // Routing: a transport connect navigates to the plugin's own section, a
    // relay connect to Data & Sync; disconnect follows the bound backend.
    expect(syncFlowSection({ action: "connect", transportRef: webdav.ref })).toBe("plugin:webdav-sync");
    expect(syncFlowSection({ action: "connect" })).toBe("dataSync");
    expect(syncFlowSection({ action: "disconnect" })).toBe("dataSync");
    status = snapshot({ backend: "transport", transportRef: webdav.ref });
    expect(syncFlowSection({ action: "disconnect" })).toBe("plugin:webdav-sync");
    status = snapshot({ backend: "transport", transportRef: "plugin:gone:main" });
    expect(syncFlowSection({ action: "disconnect" })).toBe("dataSync");
    status = snapshot({ accountConnected: false, backend: null });

    let request!: Promise<HostSyncFlowReceipt>, refused: unknown;
    await act(async () => { request = hostSyncFlows.request({ action: "connect", transportRef: webdav.ref }); await tick(); });
    expect(targets.at(-1)).toEqual({ surface: "settings", section: "plugin:webdav-sync" });
    expect(flows.connectRef).toBe(webdav.ref); expect(connects).toBe(0);
    await act(async () => { await flows.sync.connectTransport(webdav.ref, "user-only-passphrase"); flows.setConnectRef(null); });
    expect(await request).toEqual({ action: "connect", status: "completed" }); expect(connects).toBe(1);

    // Another plugin's transport and the relay's sign-in are not this page's.
    await act(async () => { refused = await hostSyncFlows.request({ action: "connect", transportRef: other.ref }).catch(error => error); });
    expect(refused).toMatchObject({ code: "ui/unavailable" });
    expect(flows.connectRef).toBeNull();
    await act(async () => { refused = await hostSyncFlows.request({ action: "connect" }).catch(error => error); });
    expect(refused).toMatchObject({ code: "ui/unavailable" });

    // Disconnect: only while bound to this plugin's transport.
    status = snapshot({ backend: "transport", transportRef: other.ref });
    await act(async () => { refused = await hostSyncFlows.request({ action: "disconnect" }).catch(error => error); });
    expect(refused).toMatchObject({ code: "ui/unavailable" });
    expect(flows.disconnectOpen).toBe(false);
    status = snapshot({ backend: "transport", transportRef: webdav.ref });
    await act(async () => { request = hostSyncFlows.request({ action: "disconnect" }); await tick(); });
    expect(flows.disconnectOpen).toBe(true); expect(disconnects).toBe(0);
    await act(async () => { flows.setDisconnectOpen(false); });
    expect((await request).status).toBe("cancelled"); expect(disconnects).toBe(0);
    await act(async () => { request = hostSyncFlows.request({ action: "disconnect" }); await tick(); });
    await act(async () => { await flows.disconnect(); });
    expect(await request).toEqual({ action: "disconnect", status: "completed" }); expect(disconnects).toBe(1);

    // Billing and account deletion never reach a plugin page.
    await act(async () => { refused = await hostSyncFlows.request({ action: "delete-account" }).catch(error => error); });
    expect(refused).toMatchObject({ code: "ui/unavailable" });
  } finally {
    await act(async () => { root.unmount(); });
    for (const mock of mocks) mock.mockRestore();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
} else {
  test("isolated mounted transport sync flow contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, SYNC_TRANSPORT_FLOW_HOOK_CASE: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("1 pass");
  }, 30_000);
}
