/** Matches the native archive policy: Unicode scalar count and UTF-8 bytes. */
export function validBackupPassword(password: string): boolean {
  // oxlint-disable-next-line typescript/no-misused-spread -- the native policy counts Unicode scalars, not graphemes
  return [...password].length >= 12 && new TextEncoder().encode(password).length <= 1024;
}
