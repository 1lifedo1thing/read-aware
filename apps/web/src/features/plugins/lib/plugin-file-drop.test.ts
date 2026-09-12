import { expect, test } from "bun:test";
import { ResourceOwner } from "../../../services/resource-owner";
import { resourceAdapter } from "../../../services/resources";
import { decodePluginCallbacks, PluginCallbackRegistry } from "../runtime/plugin-callback-wire";
import { normalizePluginView } from "./plugin-view";
import { deliverPluginFiles, pickPluginFiles, registerPluginFileDropOwner } from "./plugin-file-drop";
import type { PluginView } from "./plugin-types";

test("drop declarations cannot choose an owner; files cross the callback boundary only as scoped metadata", async () => {
  const lifecycle = new AbortController(), registry = new PluginCallbackRegistry(), seen: unknown[] = [], removed: string[] = [];
  let sequence = 0;
  const resource = new ResourceOwner({ ...resourceAdapter,
    create: async options => ({ id: `native-${++sequence}`, name: options.name, mimeType: options.mimeType!, size: 0 }),
    append: async (_id, offset, data) => offset + data.byteLength, commit: async () => {},
    release: async id => { removed.push(id); },
    pick: async () => [{ id: "native-picker", name: "bad.pdf", mimeType: "application/pdf", size: 0 }],
  }, error => { throw error; });
  registerPluginFileDropOwner(lifecycle.signal, "Consumer", resource);
  const view = (callback: NonNullable<PluginView["fileDrop"]>["onDrop"], owner = lifecycle.signal) => normalizePluginView(decodePluginCallbacks(
    registry.encode({ kind: "markdown", markdown: "Drop", fileDrop: { multiple: true, extensions: ["TXT"], onDrop: callback } }),
    (handle, args) => registry.invoke(handle, args), undefined, owner,
  ));
  try {
    const drop = view(async refs => { seen.push(refs); return { toast: "Accepted" }; }).fileDrop!;
    expect(drop.extensions).toEqual(["txt"]);
    const input = new File(["content"], "a.txt");
    expect(await deliverPluginFiles(drop, [input], new AbortController().signal)).toEqual({ toast: "Accepted" });
    const refs = seen[0] as { id: string; name: string; size: number }[];
    expect(refs[0]).toMatchObject({ name: "a.txt", size: 7 }); expect(refs[0]!.id).not.toContain("native");
    expect(Object.keys(refs[0]!).sort()).toEqual(["expiresAt", "id", "mimeType", "name", "size", "source", "state"]);
    const stranger = view(() => null, new AbortController().signal).fileDrop!;
    await expect(deliverPluginFiles(stranger, [input], new AbortController().signal)).rejects.toMatchObject({ code: "plugin/unavailable" });
    await expect(deliverPluginFiles(drop, [new File([], "bad.pdf")], new AbortController().signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
    await expect(pickPluginFiles(drop, new AbortController().signal)).rejects.toMatchObject({ code: "ui/invalid-target" });
    expect(removed).toContain("native-picker");
    const failing = view(() => { throw Error("callback failed"); }).fileDrop!;
    await expect(deliverPluginFiles(failing, [input], new AbortController().signal)).rejects.toThrow("callback failed");
    expect(removed).toContain("native-2");
    const hidden = new AbortController(); hidden.abort(Error("hidden"));
    await expect(deliverPluginFiles(drop, [input], hidden.signal)).rejects.toThrow("hidden");
    expect(sequence).toBe(2);
    lifecycle.abort();
    await expect(deliverPluginFiles(drop, [input], new AbortController().signal)).rejects.toMatchObject({ code: "plugin/unavailable" });
  } finally { lifecycle.abort(); registry.clear(); await resource.dispose(); }
});
