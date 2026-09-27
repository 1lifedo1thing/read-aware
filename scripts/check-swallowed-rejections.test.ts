import { expect, test } from "bun:test";
import { findSwallowedRejections } from "./check-swallowed-rejections";

const lines = (source: string) => findSwallowedRejections("fixture.ts", source).map(finding => finding.line);

test("empty and value-less rejection handlers are reported unless a comment explains them", () => {
  expect(lines([
    "void work.catch(() => {});",
    "void work.catch(() => undefined);",
    "void work.catch(_error => null);",
    "void work.then(() => {}, () => {});",
    "void work.catch(function () {});",
  ].join("\n"))).toEqual([1, 2, 3, 4, 5]);

  expect(lines([
    "void work.catch(() => {}); // the caller already observes `work`",
    "// Serialization tail: the queue only waits for settlement.",
    "tail = work.catch(() => {});",
    "void work.catch(() => { /* superseded by the abort below */ });",
    "void work",
    "  // Best-effort release.",
    "  .catch(() => undefined);",
  ].join("\n"))).toEqual([]);
});

test("handlers that inspect or report the failure pass", () => {
  expect(lines([
    "void work.catch(error => log.warn('failed', error));",
    "void work.catch(() => fallback);",
    "void work.then(() => {});",
    "void work.catch(() => { retry(); });",
  ].join("\n"))).toEqual([]);
});
