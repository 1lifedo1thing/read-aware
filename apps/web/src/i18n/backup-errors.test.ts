import { expect, test } from "bun:test";
import { AppError, ERR_BACKUP_BUSY, ERR_BACKUP_INCOMPLETE, ERR_BACKUP_CHANGED, ERR_BACKUP_CANCELLED, ERR_BACKUP_INVALID_ARCHIVE, ERR_BACKUP_UNLOCK_FAILED, ERR_BACKUP_PASSWORD_POLICY } from "@read-aware/core";
import { describeError } from "./describe-error";
import { initI18n, setLocale } from "./index";

test("backup failures have localized reasons and honest retry semantics without raw details", async () => {
  const cases = [[ERR_BACKUP_BUSY, "backupBusy", true], [ERR_BACKUP_INCOMPLETE, "backupIncomplete", false], [ERR_BACKUP_CHANGED, "backupChanged", true], [ERR_BACKUP_CANCELLED, "backupCancelled", false], [ERR_BACKUP_INVALID_ARCHIVE, "backupInvalidArchive", false], [ERR_BACKUP_UNLOCK_FAILED, "backupUnlockFailed", false], [ERR_BACKUP_PASSWORD_POLICY, "backupPasswordPolicy", false]] as const;
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"] as const) {
    await initI18n(locale);
    await setLocale(locale);
    const catalog = await Bun.file(new URL(`./locales/${locale}/common.json`, import.meta.url)).json();
    for (const [code, key, retryable] of cases) {
      const error = describeError(new AppError(code, "PRIVATE BACKUP PATH OR CREDENTIAL"));
      expect(error.body).toBe(catalog.errors[key]); expect(error.retryable).toBe(retryable);
      expect(error.body).not.toContain("PRIVATE");
    }
  }
});
