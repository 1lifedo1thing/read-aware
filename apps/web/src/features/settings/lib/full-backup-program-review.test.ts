import { expect, test } from "bun:test";
import { reviewFullBackupPrograms } from "./full-backup-program-review";
import type { BackupReviewPage, BackupReviewQuery } from "./backup-review-types";
import type { BackupProgramChoice, BackupProgramFacts } from "../../plugins/runtime/backup-program-review";

const data = { kvRows: 1, documents: 0, schema: null };
const onlyData: BackupProgramFacts = { id: "a-data", builtin: false, candidates: [], sourceData: data, targetData: data };
const candidate = { side: "source" as const, root: "plugins/proof", sha256: "a".repeat(64), main: "main.js", mainPresent: true,
  manifest: JSON.stringify({ id: "proof", name: "Proof", version: "1.0.0", schemaVersion: 3, requires: {} }) };
const proof: BackupProgramFacts = { id: "proof", builtin: false, candidates: [candidate],
  sourceData: { ...data, schema: 2 }, targetData: { ...data, schema: 4 } };
test("paged captured program facts reach the existing manifest/schema gate with the exact submitted choices", async () => {
  const waiting = Promise.withResolvers<void>(); const queries: BackupReviewQuery[] = [];
  const review = { disposed: false, read: async (query: BackupReviewQuery): Promise<BackupReviewPage> => {
    queries.push(query); await waiting.promise;
    return { kind: "programs", entries: query.after ? [proof] : [onlyData], nextAfter: query.after ? null : "a-data" };
  } };
  const choices = new Map<string, BackupProgramChoice>([["a-data", { program: null, data: "source" }],
    ["proof", { program: { side: candidate.side, root: candidate.root, sha256: candidate.sha256 }, data: "source" }]]);
  const pending = reviewFullBackupPrograms(review, choices, "1.0.0");
  choices.get("proof")!.data = "target"; waiting.resolve();
  const result = await pending;
  expect(queries).toHaveLength(2); expect(queries[1]).toMatchObject({ after: "a-data" });
  expect(result[0]).toMatchObject({ readiness: "data-only", unversionedData: true });
  expect(result[1]).toMatchObject({ consentRequired: true, readiness: "probe-required", migration: { fromVersion: 2, toVersion: 3, direction: "upgrade" } });
});
test("incomplete catalogs, unavailable plans and invalid source manifests never become approval", async () => {
  const choices = new Map<string, BackupProgramChoice>([["a-data", { program: null, data: "source" }]]);
  const review = { disposed: false, read: async (): Promise<BackupReviewPage> => ({ kind: "programs", entries: [onlyData], nextAfter: "a-data" }) };
  await expect(reviewFullBackupPrograms(review, choices, "1.0.0")).rejects.toMatchObject({ code: "backup/changed" });
  review.disposed = true; review.read = async () => ({ kind: "programs", entries: [onlyData], nextAfter: null });
  await expect(reviewFullBackupPrograms(review, choices, "1.0.0")).rejects.toMatchObject({ code: "backup/changed" });
  review.disposed = false;
  review.read = async () => ({ kind: "programs", entries: [{ ...proof, candidates: [{ ...candidate, mainPresent: false }] }], nextAfter: null });
  await expect(reviewFullBackupPrograms(review, new Map([["proof", { program: candidate, data: "source" }]]), "1.0.0")).rejects.toMatchObject({ code: "backup/incomplete" });
});
