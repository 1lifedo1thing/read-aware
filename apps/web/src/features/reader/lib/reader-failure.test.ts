import { expect, test } from "bun:test";
import { readerRecoveryAction } from "./reader-failure";

test("reader recovery offers a corrective action instead of retrying unchanged failures", () => {
  expect(readerRecoveryAction({ kind: "file-missing", reason: "unreachable" })).toBe("retry");
  for (const reason of ["no-sync", "not-on-relay"] as const) {
    expect(readerRecoveryAction({ kind: "file-missing", reason })).toBe("import");
  }
  for (const reason of ["unauthenticated", "undecodable"] as const) {
    expect(readerRecoveryAction({ kind: "file-missing", reason })).toBe("settings");
  }
  expect(readerRecoveryAction({ kind: "generic", message: "Invalid file", retryable: false })).toBeNull();
  expect(readerRecoveryAction({ kind: "generic", message: "Unknown failure" })).toBeNull();
  expect(readerRecoveryAction({ kind: "generic", message: "Busy", retryable: true })).toBe("retry");
});
