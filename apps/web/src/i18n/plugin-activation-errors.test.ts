import { expect, test } from "bun:test";
import { AppError, ERR_PLUGIN_APP_UPDATE_REQUIRED, ERR_PLUGIN_UPDATE_REQUIRED } from "@read-aware/core";
import { describeError } from "./describe-error";
import { i18n, initI18n } from "./index";

const cases = [
  [ERR_PLUGIN_UPDATE_REQUIRED, "pluginUpdateRequired", "update-plugin"],
  [ERR_PLUGIN_APP_UPDATE_REQUIRED, "pluginAppUpdateRequired", "update-app"],
  ["plugin/object-access-state-invalid", "pluginObjectAccessStateInvalid", undefined],
] as const;

test("plugin activation failures have eight-locale copy and name their fix", async () => {
  await initI18n("en");
  const original = i18n.language;
  try {
    for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
      const common = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
      const plugins = await Bun.file(new URL(`./locales/${locale}/plugins.json`, import.meta.url)).json();
      await i18n.changeLanguage(locale);
      for (const [code, key, action] of cases) {
        expect(common.errors[key]).toBeTruthy();
        const copy = describeError(new AppError(code, "PRIVATE_ACTIVATION_FAILURE"));
        expect(copy.body).toBe(common.errors[key]);
        expect(copy.retryable).toBe(false);
        expect(copy.action).toBe(action);
        expect(copy.body).not.toContain("PRIVATE_ACTIVATION_FAILURE");
      }
      for (const key of ["activationError", "updateTo", "checkAppUpdate"]) expect(plugins.settings[key]).toBeTruthy();
      expect(plugins.settings.updateTo).toContain("{{version}}");
      expect(plugins.settings.activationError).not.toMatch(/log|日志|日誌|ログ|Protokoll|journal|registro|журнал/i);
    }
  } finally {
    await i18n.changeLanguage(original);
  }
});
