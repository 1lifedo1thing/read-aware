import { beforeEach, describe, expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import { appSettingsAtom } from "../../state/ui";
import { DEFAULT_APP_SETTINGS } from "../../features/settings/lib/app-settings";
import { createSettingsDomain } from "./domain";
import { installFileGlobals, memoryStorage } from "../../../tests/helpers/file-globals";

const storage = new Map<string, string>();
installFileGlobals({ localStorage: memoryStorage(storage) });

beforeEach(() => {
  storage.clear();
  getDefaultStore().set(appSettingsAtom, { ...DEFAULT_APP_SETTINGS });
});

describe("Settings Domain actor policy", () => {
  test("grants a plugin exact discovery, read, write, and event paths", async () => {
    const settings = createSettingsDomain("plugin:test", {
      read: ["appearance.theme"],
      write: ["appearance.theme"],
    });
    const events: string[][] = [];
    const unsubscribe = settings.events.subscribe((event) => {
      events.push(event.changes.map((change) => change.path));
    });

    expect((await settings.queries.discover()).map((entry) => entry.path)).toEqual(["appearance.theme"]);
    expect(await settings.queries.read("appearance.theme")).toMatchObject({
      path: "appearance.theme",
      value: DEFAULT_APP_SETTINGS.theme,
    });

    const result = await settings.commands.update([{ path: "appearance.theme", value: "light" }]);

    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("light");
    expect(events).toEqual([["appearance.theme"]]);
    expect(result.settings.settings.map((entry) => entry.path)).toEqual(["appearance.theme"]);
    await expect(
      settings.commands.update([
        { path: "appearance.theme", value: "dark" },
        { path: "appearance.motion", value: "reduced" },
      ]),
    ).rejects.toMatchObject({ code: "settings/forbidden" });
    expect(getDefaultStore().get(appSettingsAtom).theme).toBe("light");
    expect(events).toEqual([["appearance.theme"]]);
    unsubscribe();
  });

  test("gives an ungranted plugin no settings surface", async () => {
    const settings = createSettingsDomain("plugin:test");

    expect(await settings.queries.discover()).toEqual([]);
    await expect(settings.queries.read("appearance.theme")).rejects.toMatchObject({ code: "settings/forbidden" });
  });
});

test("retired localOnly path cannot be discovered or updated", async () => {
  const settings = createSettingsDomain("user");
  expect((await settings.queries.discover()).map((entry) => entry.path)).not.toContain("ai.preferences.localOnly");
  await expect(settings.queries.read("ai.preferences.localOnly")).rejects.toThrow();
  await expect(settings.commands.update([{ path: "ai.preferences.localOnly", value: true }])).rejects.toThrow();
});
