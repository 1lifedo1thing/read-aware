/** Host-owned execution identity, never a portable plugin preference. Both
 * current receipts and legacy attempt stamps belong to this device. */
export function isPluginScheduleStateKey(key: string): boolean {
  return /^read-aware-plugin\.[^.]+\.schedule-(?:state|runs)$/.test(key);
}
