import { localKV } from "../../../platform/local-store";
import { expect, spyOn, test } from "bun:test";
import { buildPluginContext } from "./plugin-context";

test("schedule services only enumerate/control their own bindings and stop observing at retirement", async () => {
  const create = (id: string) => buildPluginContext({ id, name: id, version: "1", schemaVersion: 1, requires: {},
    schedules: [{ id: "tick", label: "Tick", everyMinutes: 60 }] }, "0.5.4", []);
  const a = create("schedule-a"), b = create("schedule-b");
  try {
    a.context.services.schedules.bind("tick", () => {}); b.context.services.schedules.bind("tick", () => {});
    a.lifecycle.promote(); b.lifecycle.promote();
    const check = (pluginId: string) => a.context.services.session.operationAvailability({ operation: "schedules.control", schedule: { pluginId, id: "tick", action: "run" } });
    expect(await check("schedule-b")).toMatchObject({ state: "unavailable", conditions: [{ reason: "schedule-owner-required" }] });
    expect(await check("schedule-a")).toMatchObject({ state: "unknown", remoteChecked: false });
    const page = await a.context.services.schedules.list({ pluginId: "schedule-b" } as never);
    expect(page.schedules.map(item => item.pluginId)).toEqual(["schedule-a"]);
    await expect(a.context.services.schedules.control("missing", "run")).rejects.toMatchObject({ code: "ui/unavailable" });
    const seen: number[] = []; a.context.services.schedules.observe({}, value => seen.push(value.total));
    expect(seen).toEqual([1]); a.lifecycle.stop(); b.lifecycle.stop(); await Bun.sleep(0); expect(seen).toEqual([1]);
    expect(() => a.context.services.schedules.control("tick", "pause")).toThrow();
  } finally { a.lifecycle.stop(); b.lifecycle.stop(); }
});


test("manual schedule callback carries a reaction through await and retires the lease", async () => {
  const write = spyOn(localKV, "setItemAsync").mockResolvedValue();
  const host = buildPluginContext({ id: "schedule-reaction", name: "Reaction", version: "1", schemaVersion: 1, requires: {},
    schedules: [{ id: "tick", label: "Tick", everyMinutes: 60 }] }, "0.5.4", []);
  let expired: (() => unknown) | undefined, called = 0;
  try {
    const registration = host.context.services.schedules.bind("tick", async (_run, delivery) => {
      expect(delivery?.reaction?.status).toBe("ready"); called++;
      const reaction = host.context.withEvent(delivery);
      await Promise.resolve(); await reaction.services.schedules.control("tick", "pause");
      expired = () => reaction.services.schedules.list();
    });
    host.lifecycle.promote();
    await host.context.services.schedules.control("tick", "run");
    expect(called).toBe(1); expect((await host.context.services.schedules.list()).schedules[0]?.paused).toBe(true);
    expect(expired).toBeDefined(); expect(expired!).toThrow();
    const retirement: string[] = [];
    const observation = host.context.services.schedules.observe({}, async (_page, delivery) => {
      retirement.push(delivery?.reaction?.status ?? "missing");
      if (retirement.length === 1) await host.context.withEvent(delivery, registration).dispose();
    }, { ruleId: "retire-schedule" });
    await Bun.sleep(0); observation.dispose();
    expect(retirement).toEqual(["ready", "cycle"]);
    expect((await host.context.services.schedules.list()).total).toBe(0);
    const replacement = host.context.services.schedules.bind("tick", () => {});
    const rebound = host.context.services.schedules.bind("tick", () => {});
    replacement.dispose();
    expect((await host.context.services.schedules.list()).total).toBe(1); rebound.dispose();
  } finally { host.lifecycle.stop();  write.mockRestore(); }
});
