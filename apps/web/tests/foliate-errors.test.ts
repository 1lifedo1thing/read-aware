import { expect, test } from "bun:test";
import { UnsupportedEncryptionError } from "../foliate-js/src/errors.js";
import { describeError } from "../src/i18n/describe-error.js";
import { initI18n, LOCALES, setLocale } from "../src/i18n/index.js";

test("encrypted books use a localized terminal error instead of leaking algorithm details", async () => {
  const error = new UnsupportedEncryptionError("EPUB", "urn:private-algorithm");
  // Use the app's i18n lifecycle instead of re-initializing the shared instance with a partial
  // catalog, and restore the default locale for the suites that share this process.
  await initI18n("en");
  try {
    for (const language of LOCALES) {
      const common: { errors: { bookEncryption: string } } = await Bun.file(
        new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url),
      ).json();
      await setLocale(language);
      const description = describeError(error);
      expect(description.body).toBe(common.errors.bookEncryption);
      expect(description.body).not.toContain("urn:private-algorithm");
      expect(description.retryable).toBe(false);
    }
  } finally {
    await setLocale("en");
  }
});
