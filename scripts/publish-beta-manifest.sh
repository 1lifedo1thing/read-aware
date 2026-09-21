#!/usr/bin/env bash
# Point the Beta update channel at a release by publishing its updater
# manifest under the rolling `beta` GitHub release.
#
# Beta clients fetch a FIXED URL —
#   https://github.com/<repo>/releases/download/beta/<manifest>
# — the same github.com download host they need for the artifacts themselves,
# instead of listing releases through api.github.com (60 requests/hour per
# unauthenticated IP, shared by every device behind a NAT or proxy, and often
# unreachable where GitHub's API is blocked). The rolling release is a
# prerelease, so it never becomes `releases/latest` for Stable clients.
#
# The manifest is only replaced when this release is semver-newer than (or the
# same as) the one currently published: a stable release overtakes its betas,
# a back-ported patch does not roll a newer beta back.
#
# Usage: publish-beta-manifest.sh <manifest-file> [repo]
#   <manifest-file>  latest.json or latest-android.json, containing "version"
#   [repo]           owner/name; defaults to $GITHUB_REPOSITORY
# Requires: gh (authenticated), python3.
set -euo pipefail

manifest="${1:?manifest file required}"
repo="${2:-${GITHUB_REPOSITORY:?repo required}}"
asset="$(basename "$manifest")"
tag="beta"

version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$manifest")"

if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$tag" --repo "$repo" --prerelease \
    --title "Beta channel" \
    --notes "Rolling pointer for the Beta update channel. Its updater manifests always describe the newest release, pre-releases included; the artifacts live on the versioned releases. Not a release by itself."
fi

current=""
if gh release download "$tag" --repo "$repo" --pattern "$asset" --output "current-$asset" --clobber >/dev/null 2>&1; then
  current="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version", ""))' "current-$asset" || true)"
  rm -f "current-$asset"
fi

# SemVer precedence for X.Y.Z with an optional numeric prerelease (0.6.1-2 <
# 0.6.1-3 < 0.6.1). Exit 0 when $1 >= $2.
newer_or_equal() {
  python3 - "$1" "$2" <<'PY'
import re, sys
def parse(v):
    m = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:-(\d+(?:\.\d+)*))?", v.strip())
    if not m: raise SystemExit(f"unsupported version {v!r}")
    core = tuple(int(x) for x in m.group(1, 2, 3))
    pre = tuple(int(x) for x in m.group(4).split(".")) if m.group(4) else None
    # Absence of a prerelease ranks above presence.
    return (core, pre is None, pre or ())
a, b = parse(sys.argv[1]), parse(sys.argv[2])
sys.exit(0 if a >= b else 1)
PY
}

if [[ -n "$current" ]] && ! newer_or_equal "$version" "$current"; then
  echo "beta channel stays at $current (this release is $version)"
  exit 0
fi

gh release upload "$tag" "$manifest" --repo "$repo" --clobber
echo "beta channel now points $asset at $version"
