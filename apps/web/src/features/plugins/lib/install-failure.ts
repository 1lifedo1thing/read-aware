import { ERR_PLUGIN_INVALID_PACKAGE, errorCode } from "@read-aware/core";
import { i18n } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";

/**
 * Toast copy for a failed install or update, from a folder, a zip or the
 * marketplace. A bad package (web- or native-detected) gets its own line;
 * other classified causes (an app too old for the plugin, a full disk) use
 * the shared copy, the rest the generic failure.
 */
export function describePluginInstallFailure(error: unknown): string {
  if (errorCode(error) === ERR_PLUGIN_INVALID_PACKAGE) {
    return i18n.t("settings.installFailedManifest", { ns: "plugins" });
  }
  return describeError(error, { fallback: i18n.t("settings.installFailed", { ns: "plugins" }) }).body;
}
