import { expect, test } from "bun:test";
import { resourceAdapter } from "../../../services/resources";
import { buildPluginContext } from "./plugin-context";
import { describeContext } from "./plugin-worker-host";

test("directory methods reach the fixed activation owner through the Worker shape and retire with it", async () => {
  const original = resourceAdapter.directories, calls: unknown[] = [];
  let serial = 0;
  resourceAdapter.directories = {
    pick: async () => ({ id: `native-${++serial}`, name: "Folder" }),
    list: async (id, query) => { calls.push([id, query]); return { entries: [], nextCursor: null, omittedCount: 0 }; },
    openFile: async () => { throw Error("unexpected"); },
    release: async id => { calls.push(["release", id]); },
  };
  const create = (id: string) => buildPluginContext({ id, name: id, version: "1.0.0", schemaVersion: 1, permissions: [], requires: { services: { resources: "^1.4.0" } } }, "0.5.4", []);
  const a = create("directory-a"), b = create("directory-b");
  try {
    expect(() => a.context.services.resources.pickDirectory()).toThrow();
    a.lifecycle.promote(); b.lifecycle.promote();
    expect(describeContext(a.context)).toMatchObject({ services: { resources: { pickDirectory: "fn", listDirectory: "fn", openDirectoryFile: "fn", releaseDirectory: "fn" } } });
    const { directory } = await a.context.services.resources.pickDirectory();
    expect(directory!.id).not.toBe("native-1");
    await expect(b.context.services.resources.listDirectory(directory!.id)).rejects.toMatchObject({ code: "fs/not-found" });
    await a.context.services.resources.listDirectory(directory!.id, { limit: 5 });
    expect(calls).toEqual([["native-1", { limit: 5, relativePath: "" }]]);
    a.lifecycle.stop(); await a.lifecycle.drainCleanups();
    expect(calls[1]).toEqual(["release", "native-1"]);
    expect(() => a.context.services.resources.pickDirectory()).toThrow();
  } finally {
    a.lifecycle.stop(); b.lifecycle.stop(); await a.lifecycle.drainCleanups(); await b.lifecycle.drainCleanups();
    resourceAdapter.directories = original;
  }
});
