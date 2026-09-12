import { expect, test } from "bun:test";
import { reviewBackupPrograms, type BackupProgramChoice, type BackupProgramFacts } from "./backup-program-review";
import { planPluginDataMigration } from "./plugin-data-migration";

const raw = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: "proof", name: "Proof", version: "1.0.0", schemaVersion: 3, requires: {}, ...extra });
function facts(extra: Record<string, unknown> = {}): BackupProgramFacts {
  return { id: "proof", builtin: false,
    candidates: [{ side: "source", root: "plugins/proof", sha256: "a".repeat(64), manifest: raw(extra), main: "main.js", mainPresent: true }],
    sourceData: { kvRows: 2, documents: 1, schema: 2 }, targetData: { kvRows: 1, documents: 0, schema: 4 } };
}
function choices(f: BackupProgramFacts): Map<string, BackupProgramChoice> {
  const { side, root, sha256 } = f.candidates[0]!;
  return new Map([[f.id, { program: { side, root, sha256 }, data: "source" }]]);
}
const review = (f: BackupProgramFacts, c = choices(f)) => reviewBackupPrograms([f], c, "1.0.0")[0]!;

test("whole-program review discloses permissions and actual selected data migration without approval or execution", () => {
  const f = facts({ permissions: ["service:network"], requires: { services: { network: "^2.2.0" } }, networkAccess: { origins: ["https://example.com"] } });
  const result = review(f);
  expect(result.manifest!.networkAccess!.origins).toEqual(["https://example.com"]);
  expect(result.consentRequired).toBe(true);
  expect(result.readiness).toBe("probe-required");
  expect(result.migration).toEqual({ fromVersion: 2, toVersion: 3, direction: "upgrade" });
  const c = choices(f); c.get("proof")!.data = "target";
  expect(review(f, c).migration).toEqual({ fromVersion: 4, toVersion: 3, direction: "downgrade" });
  expect(() => planPluginDataMigration({ storedVersion: 4, targetVersion: 3, hasMigration: false })).toThrow(/migrate\(\) is missing/);
  c.get("proof")!.program!.sha256 = "changed";
  expect(result.choice.program!.sha256).toBe("a".repeat(64));
});

test("the production manifest and capability gates reject invalid or ungranted programs", () => {
  for (const extra of [
    { id: "other" }, { permissions: ["made-up"] }, { main: "../escape.js" },
    { requires: { services: { network: "^2.0.0" } } },
    { permissions: ["service:network"], requires: { services: { network: "^99.0.0" } } },
    { minAppVersion: "99.0.0" }, { schemaVersion: 0 },
  ]) expect(() => review(facts(extra))).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
  const missing = facts(); missing.candidates[0]!.mainPresent = false;
  expect(() => review(missing)).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
});

test("source bundled flags cannot gain built-in trust or replace current built-in code", () => {
  const f = facts({ permissions: ["reader:modes"] }); f.candidates[0]!.root = "bundled-plugins/proof";
  expect(() => review(f)).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
  f.builtin = true;
  expect(() => review(f)).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
  f.candidates[0]!.side = "target";
  expect(review(f).consentRequired).toBe(false);
  const c = choices(f); c.get("proof")!.program = null;
  expect(() => review(f, c)).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
});

test("missing owners and stale tree selections never become a partial restore review", () => {
  const f = facts();
  expect(() => reviewBackupPrograms([f], new Map(), "1.0.0")).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
  expect(() => reviewBackupPrograms([f, f], choices(f), "1.0.0")).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
  const c = choices(f); c.get("proof")!.program!.sha256 = "b".repeat(64);
  expect(() => review(f, c)).toThrow(expect.objectContaining({ code: "backup/changed" }));
});

test("data-only and unversioned namespaces remain explicit; no program activation is implied", () => {
  const f = facts(); f.sourceData.schema = null;
  expect(review(f).unversionedData).toBe(true);
  const c = choices(f); c.get("proof")!.program = null;
  const result = review(f, c);
  expect(result.readiness).toBe("data-only"); expect(result.manifest).toBeNull();
  expect(result.data.kvRows).toBe(2); expect(result.unversionedData).toBe(true);
  f.sourceData.schema = Number.NaN;
  expect(() => review(f, c)).toThrow(expect.objectContaining({ code: "backup/incomplete" }));
});

if (process.env.READAWARE_PROGRAM_FACTS_PROOF) {
  test("the host reviews the current native WAL/FilePlan catalog without a second manifest model", async () => {
    const catalog: BackupProgramFacts[] = await Bun.file(process.env.READAWARE_PROGRAM_FACTS_PROOF!).json();
    const selected = new Map<string, BackupProgramChoice>(catalog.map(f => {
      const program = f.candidates.find(c => c.side === "source");
      return [f.id, { program: program ? { side: program.side, root: program.root, sha256: program.sha256 } : null, data: "source" }];
    }));
    const result = reviewBackupPrograms(catalog, selected, "1.0.0");
    expect(result.find(r => r.id === "proof")!.migration).toEqual({ fromVersion: 2, toVersion: 3, direction: "upgrade" });
    expect(result.find(r => r.id === "proof")!.consentRequired).toBe(true);
    expect(result.find(r => r.id === "orphan")!.readiness).toBe("data-only");
  });
}
