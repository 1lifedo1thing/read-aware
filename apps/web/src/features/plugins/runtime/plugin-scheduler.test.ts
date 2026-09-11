import { describe, expect, spyOn, test } from "bun:test";
import { PluginLifecycleController } from "./plugin-lifecycle";
import {
  inspectPluginSchedules,
  isScheduleDue,
  registerPluginSchedule,
} from "./plugin-scheduler";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

describe("isScheduleDue", () => {
  test("a never-run schedule is due (launch catch-up)", () => {
    expect(isScheduleDue(undefined, 60, NOW)).toBe(true);
  });

  test("due only after the cadence elapses", () => {
    expect(isScheduleDue(minutesAgo(59), 60, NOW)).toBe(false);
    expect(isScheduleDue(minutesAgo(60), 60, NOW)).toBe(true);
    expect(isScheduleDue(minutesAgo(600), 60, NOW)).toBe(true);
  });

  test("cadence floors at the host minimum", () => {
    // Declared 1 minute, floored to 15: not due after 10.
    expect(isScheduleDue(minutesAgo(10), 1, NOW)).toBe(false);
    expect(isScheduleDue(minutesAgo(15), 1, NOW)).toBe(true);
  });

  test("garbled or future stamps never wedge the task", () => {
    expect(isScheduleDue("not-a-date", 60, NOW)).toBe(true);
    expect(isScheduleDue(minutesAgo(-120), 60, NOW)).toBe(true);
  });
});

describe("schedule registration lifecycle", () => {
  test("scheduler timers start only after successful promotion and stop with the last binding", () => {
    const timers = spyOn(globalThis, "setTimeout"), clear = spyOn(globalThis, "clearTimeout");
    const life = new PluginLifecycleController([]); let fail = true;
    life.stage(() => registerPluginSchedule("activation-timer", { id: "refresh", label: "Refresh", everyMinutes: 60 }, () => {}));
    life.stage(() => { if (fail) throw new Error("Rejected"); return { dispose() {} }; });
    try {
      expect(() => life.promote()).toThrow("Rejected"); expect(timers).not.toHaveBeenCalled();
      fail = false; life.promote(); expect(timers).toHaveBeenCalledTimes(1);
      const timer = timers.mock.results[0].value;
      life.stop(); expect(clear).toHaveBeenCalledWith(timer);
      expect(inspectPluginSchedules()).not.toContain("activation-timer:refresh");
    } finally { life.stop(); timers.mockRestore(); clear.mockRestore(); }
  });
  test("a stale disposable cannot remove a replacement schedule", () => {
    const first = registerPluginSchedule(
      "test-plugin",
      { id: "refresh", label: "Refresh", everyMinutes: 60 },
      () => {},
    );
    const second = registerPluginSchedule(
      "test-plugin",
      { id: "refresh", label: "Refresh", everyMinutes: 60 },
      () => {},
    );

    first.dispose();
    expect(inspectPluginSchedules()).toContain("test-plugin:refresh");
    second.dispose();
    expect(inspectPluginSchedules()).not.toContain("test-plugin:refresh");
  });
});
