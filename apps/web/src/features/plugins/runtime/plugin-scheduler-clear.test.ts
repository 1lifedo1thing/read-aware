import { expect, spyOn, test } from "bun:test";
import { localKV } from "../../../platform/local-store";
import { clearPluginScheduleState, pluginSchedules } from "./plugin-scheduler";

test("uninstall drains schedule writes before clearing attempts, without erasing plugin settings", async () => {
  let release!: () => void;
  const drain = spyOn(pluginSchedules, "drainWrites").mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const write = spyOn(localKV, "setItemAsync").mockResolvedValue();
  try {
    const clearing = clearPluginScheduleState("retired");
    expect(drain).toHaveBeenCalledWith("retired");
    expect(write).not.toHaveBeenCalled();
    release(); await clearing;
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("read-aware-plugin.retired.schedule-state", "{}");
  } finally { drain.mockRestore(); write.mockRestore(); }
});

test("schedule cleanup failures reject uninstall instead of reporting removed queued work", async () => {
  const failure = new Error("durable cleanup failed");
  const drain = spyOn(pluginSchedules, "drainWrites").mockResolvedValue();
  const write = spyOn(localKV, "setItemAsync").mockRejectedValue(failure);
  try { await expect(clearPluginScheduleState("retired")).rejects.toBe(failure); }
  finally { drain.mockRestore(); write.mockRestore(); }
});
