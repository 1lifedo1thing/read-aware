import { expect, test } from "bun:test";
import { createFullBackupExport, type FullBackupProgress } from "./full-backup-export-task";

const password = "twelve characters plus";
function fixture() {
  const calls: string[] = [];
  const deps = {
    id: () => "task",
    selectDestination: async (): Promise<string | null> => { calls.push("pick"); return "/backup.age"; },
    capture: async (taskId: string, _progress: (update: FullBackupProgress) => void) => { calls.push("capture"); return { taskId, format: 2 as const }; },
    write: async (_id: string, _password: string, _destination: string) => { calls.push("write"); },
    cancel: async (_id: string) => { calls.push("cancel"); },
    warn: (_message: string, _error: unknown) => { calls.push("warn"); },
  };
  return { deps, calls, run: createFullBackupExport(deps) };
}

test("full export resolves user input before capture, validates password, and only forwards secrets to encryption", async () => {
  const { deps, run, calls } = fixture();
  await expect(run("short")).rejects.toMatchObject({ code: "backup/password-policy" });
  await expect(run("🔒".repeat(257))).rejects.toMatchObject({ code: "backup/password-policy" });
  expect(calls).toEqual([]);
  deps.selectDestination = async () => null;
  expect(await run(password)).toBe(false); expect(calls).toEqual([]);
  deps.selectDestination = async () => { calls.push("pick"); return "/backup.age"; };
  deps.write = async (id, secret, destination) => {
    expect([id, secret, destination]).toEqual(["task", password, "/backup.age"]); calls.push("write");
  };
  expect(await run(password, undefined, update => { calls.push(update.phase); })).toBe(true);
  expect(calls).toEqual(["pick", "capture", "encrypting", "write", "cancel"]);
});

test("cancel waits for physical capture and retries cleanup after cancellation overtakes admission", async () => {
  const { deps, run, calls } = fixture(); const controller = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let nativeReady = false, finished = false;
  deps.capture = async taskId => { entered.resolve(); await release.promise; nativeReady = true; return { taskId, format: 2 }; };
  deps.cancel = async () => { calls.push("cancel"); nativeReady = false; };
  const pending = run(password, controller.signal).catch(error => { finished = true; return error; });
  await entered.promise; controller.abort(); await Bun.sleep(0);
  expect(finished).toBe(false); expect(calls).toEqual(["pick", "cancel"]);
  release.resolve(); expect((await pending).name).toBe("AbortError");
  expect(nativeReady).toBe(false); expect(calls).toEqual(["pick", "cancel", "cancel"]);
});

test("failed or invalid capture receipts are retired without encryption", async () => {
  for (const fail of [true, false]) {
    const { deps, run, calls } = fixture();
    deps.capture = async () => { if (fail) throw new Error("native capture failed"); return { taskId: "foreign", format: 2 }; };
    await expect(run(password)).rejects.toBeInstanceOf(Error);
    expect(calls).toEqual(["pick", "cancel"]);
  }
});

test("cancel during encryption retains physical result, including a successful atomic publication", async () => {
  const { deps, run, calls } = fixture(); const controller = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let finished = false;
  deps.write = async () => { entered.resolve(); await release.promise; };
  const pending = run(password, controller.signal).then(value => { finished = true; return value; });
  await entered.promise; controller.abort(); await Bun.sleep(0); expect(finished).toBe(false);
  release.resolve(); expect(await pending).toBe(true); expect(calls.filter(call => call === "cancel")).toHaveLength(2);
});

test("observer and cleanup failures are logged, preserve the native result, and encryption failure still retires", async () => {
  const { deps, run, calls } = fixture();
  deps.cancel = async () => { throw new Error("cleanup IPC unavailable"); };
  expect(await run(password, undefined, () => { throw new Error("observer failed"); })).toBe(true);
  expect(calls.filter(call => call === "warn")).toHaveLength(2);
  deps.write = async () => { throw new Error("publication failed"); };
  await expect(run(password)).rejects.toThrow("publication failed");
});
