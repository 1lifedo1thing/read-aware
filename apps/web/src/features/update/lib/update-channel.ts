import type { DomainActor } from "../../../platform/domain-actor";
/**
 * The update channel preference: Stable follows GitHub's `releases/latest`
 * (never a pre-release); Beta follows the rolling `beta` release, whose
 * updater manifests the release workflow points at the semver-largest release
 * INCLUDING pre-releases — so beta users also get any stable release that
 * overtakes the betas (0.4.0 > 0.4.0-2), with no special casing. Device-local
 * (localKV), deliberately not roamed: opting one machine into betas should not
 * opt in every device on the account.
 */
import { localKV, onLocalKVChange } from "../../../platform/local-store";

export type UpdateChannel = "stable" | "beta";

/** The per-platform updater manifest asset name. */
export type UpdateManifestAsset = "latest.json" | "latest-android.json";

/** Fixed pointer for the Beta channel (see scripts/publish-beta-manifest.sh).
 * A github.com download URL, like the artifacts themselves: no GitHub API
 * call, so no per-IP rate limit and no blocked-API blind spot. The native side
 * allow-lists this exact shape before fetching. */
export function betaManifestUrl(asset: UpdateManifestAsset): string {
  return `https://github.com/ahpxex/read-aware/releases/download/beta/${asset}`;
}

export const CHANNEL_KV_KEY = "read-aware-update-channel";

export function getUpdateChannel(): UpdateChannel {
  return localKV.getItem(CHANNEL_KV_KEY) === "beta" ? "beta" : "stable";
}

export function subscribeUpdateChannel(onChange: (origin: DomainActor) => void): () => void {
  return onLocalKVChange((key, _value, origin) => { if (key === CHANNEL_KV_KEY) onChange(origin); });
}

export function setUpdateChannel(channel: UpdateChannel): void {
  if (channel === "stable") localKV.removeItem(CHANNEL_KV_KEY);
  else localKV.setItem(CHANNEL_KV_KEY, channel);
}
