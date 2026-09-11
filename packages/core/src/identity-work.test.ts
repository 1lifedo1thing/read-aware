import { expect, test } from "bun:test";
import { normalizeIdentityWorkAppend, normalizeIdentityWorkQuery } from "./identity-work";

const expectedRevision = `icg1:${"a".repeat(64)}`;
test("identity scratch captures exact JSON and source identity without accepting write authority", () => {
  const input = { expectedRevision, index: 0, json: '{"offset":1}' };
  const captured = normalizeIdentityWorkAppend(input); input.json = "{}";
  expect(captured.json).toBe('{"offset":1}');
  expect(normalizeIdentityWorkQuery({ expectedRevision, index: 4095 })).toEqual({ expectedRevision, index: 4095 });
  for (const value of ["null", "[]", "invalid", JSON.stringify({ text: "x".repeat(48_000) })]) {
    expect(() => normalizeIdentityWorkAppend({ expectedRevision, index: 0, json: value })).toThrow();
  }
  for (const index of [-1, 0.5, 4096, NaN]) expect(() => normalizeIdentityWorkQuery({ expectedRevision, index })).toThrow();
  expect(() => normalizeIdentityWorkAppend({ expectedRevision, index: 0, json: "{}", complete: true } as never)).toThrow();
});
