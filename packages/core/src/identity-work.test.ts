import { expect, test } from "bun:test";
import { normalizeIdentityWorkAppend, normalizeIdentityWorkQuery, normalizeIdentityWorkCompact } from "./identity-work";

const expectedRevision = `icg1:${"a".repeat(64)}`;
test("identity scratch captures exact JSON and source identity without accepting write authority", () => {
  const input = { expectedRevision, index: 0, json: '{"offset":1}' };
  const captured = normalizeIdentityWorkAppend(input); input.json = "{}";
  expect(captured.json).toBe('{"offset":1}');
  expect(normalizeIdentityWorkQuery({ expectedRevision, index: 4095 })).toEqual({ expectedRevision, index: 4095 });
  for (const value of ["null", "[]", "invalid", JSON.stringify({ text: "x".repeat(48_000) })]) {
    expect(() => normalizeIdentityWorkAppend({ expectedRevision, index: 0, json: value })).toThrow();
  }
  for (const index of [-1, 0.5, Number.MAX_SAFE_INTEGER, NaN]) expect(() => normalizeIdentityWorkQuery({ expectedRevision, index })).toThrow();
  expect(() => normalizeIdentityWorkAppend({ expectedRevision, index: 0, json: "{}", complete: true } as never)).toThrow();
});


test("compaction validates a monotonic tail and a bounded captured checkpoint", () => {
  expect(normalizeIdentityWorkQuery({ expectedRevision, index: 4096 }).index).toBe(4096);
  const input = { expectedRevision, expectedPageCount: 4097, json: '{"cursor":4097}' };
  const captured = normalizeIdentityWorkCompact(input); input.json = "{}";
  expect(captured.json).toBe('{"cursor":4097}');
  for (const expectedPageCount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => normalizeIdentityWorkCompact({ ...input, expectedPageCount })).toThrow();
  }
  for (const json of ["[]", "null", "bad", JSON.stringify({ data: "x".repeat(256000) })]) {
    expect(() => normalizeIdentityWorkCompact({ ...input, json })).toThrow();
  }
  expect(() => normalizeIdentityWorkCompact({ ...input, origin: "user" } as never)).toThrow();
});
