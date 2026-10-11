/**
 * The bounds a declared `number` plugin setting accepts. One rule for every
 * write path — the plugin's settings page and the settings domain (the agent,
 * other plugins) — so a stored value is always within what the manifest
 * declared.
 */
export type NumberSettingBounds = { min?: number; max?: number };

/** The violated bounds for `value`, or null when it is an acceptable number. */
export function numberSettingViolation(
  bounds: NumberSettingBounds,
  value: unknown,
): { kind: "not-a-number" } | { kind: "out-of-range"; min?: number; max?: number } | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return { kind: "not-a-number" };
  if ((bounds.min !== undefined && value < bounds.min) || (bounds.max !== undefined && value > bounds.max)) {
    return { kind: "out-of-range", min: bounds.min, max: bounds.max };
  }
  return null;
}
