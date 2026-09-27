import { expect, test } from "bun:test";
import {
  AppError,
  ERR_EXPORT_TARGET_INVALID,
  ERR_PLUGIN_BUILT_IN,
  ERR_PLUGIN_CANDIDATE_STALE,
  ERR_PLUGIN_INVALID_PACKAGE,
  ERR_PLUGIN_NO_PREVIOUS_VERSION,
  ERR_UPDATE_INSTALL_FAILED,
  ERR_UPDATE_INVALID_RELEASE,
  ERR_UPDATE_NETWORK,
  ERR_UPDATE_NOT_READY,
  ERR_UPDATE_UNAVAILABLE,
} from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n, setLocale } from "./index";

test("native plugin, update and export failures have localized copy and honest retry semantics", async () => {
  const cases = [
    [ERR_PLUGIN_INVALID_PACKAGE, "pluginInvalidPackage", false],
    [ERR_PLUGIN_BUILT_IN, "pluginBuiltIn", false],
    [ERR_PLUGIN_CANDIDATE_STALE, "pluginCandidateStale", false],
    [ERR_PLUGIN_NO_PREVIOUS_VERSION, "pluginNoPreviousVersion", false],
    [ERR_UPDATE_UNAVAILABLE, "updateUnavailable", false],
    [ERR_UPDATE_NOT_READY, "updateNotReady", false],
    [ERR_UPDATE_NETWORK, "updateNetwork", true],
    [ERR_UPDATE_INVALID_RELEASE, "updateInvalidRelease", false],
    [ERR_UPDATE_INSTALL_FAILED, "updateInstallFailed", false],
    [ERR_EXPORT_TARGET_INVALID, "exportTargetInvalid", false],
  ] as const;
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"] as const) {
    await initI18n(locale);
    await setLocale(locale);
    const catalog = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const [code, key, retryable] of cases) {
      const error = describeError(new AppError(code, "PRIVATE NATIVE PATH /Users/someone/plugin.zip"));
      expect(typeof catalog.errors[key]).toBe("string");
      expect(error.body).toBe(catalog.errors[key]);
      expect(error.retryable).toBe(retryable);
      expect(error.body).not.toContain("PRIVATE");
    }
  }
});
