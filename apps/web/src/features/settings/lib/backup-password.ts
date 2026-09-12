/** Matches the native archive policy: Unicode scalar count and UTF-8 bytes. */
export function validBackupPassword(password: string): boolean {
  return [...password].length >= 12 && new TextEncoder().encode(password).length <= 1024;
}
