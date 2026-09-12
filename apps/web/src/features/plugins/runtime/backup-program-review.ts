/** Host-only semantic gate for the native FilePlan's bounded program catalog.
 * A review is not consent, a successful migration, or a restore receipt. */
import { AppError } from "@read-aware/core";
import { parseManifestJson } from "../lib/manifest";
import type { PluginManifest } from "../lib/plugin-types";
import { planPluginDataMigration } from "./plugin-data-migration";
import { assertPluginManifestCanActivate } from "./plugin-manifest-readiness";

export type BackupSide = "source" | "target";
export type BackupProgramRef = { side: BackupSide; root: string; sha256: string };
export type BackupProgramChoice = { program: BackupProgramRef | null; data: BackupSide };
export type BackupProgramDataFacts = { kvRows: number; documents: number; schema: number | null };
export type BackupProgramFacts = {
  id: string;
  /** Native current-runtime identity, never derived from a source folder flag. */
  builtin: boolean;
  candidates: (BackupProgramRef & { manifest: string; main: string; mainPresent: boolean })[];
  sourceData: BackupProgramDataFacts;
  targetData: BackupProgramDataFacts;
};
export type BackupProgramReview = {
  id: string;
  choice: BackupProgramChoice;
  manifest: PluginManifest | null;
  data: BackupProgramDataFacts;
  migration: ReturnType<typeof planPluginDataMigration>;
  /** A schema-less historical namespace must remain visible in the review. */
  unversionedData: boolean;
  consentRequired: boolean;
  readiness: "probe-required" | "data-only";
};
const incomplete = (message: string) => new AppError("backup/incomplete", message);

export function reviewBackupPrograms(
  facts: readonly BackupProgramFacts[],
  choices: ReadonlyMap<string, BackupProgramChoice>,
  appVersion: string,
): BackupProgramReview[] {
  if (facts.length > 10_000 || choices.size !== facts.length || new Set(facts.map(f => f.id)).size !== facts.length || facts.some(f => !choices.has(f.id))) {
    throw incomplete("Every plugin needs an explicit program and namespace choice");
  }
  return facts.map(fact => {
    const choice = structuredClone(choices.get(fact.id)!);
    if (choice.data !== "source" && choice.data !== "target") throw incomplete("Invalid plugin namespace selection");
    const data = structuredClone(choice.data === "source" ? fact.sourceData : fact.targetData);
    if (![data.kvRows, data.documents].every(n => Number.isSafeInteger(n) && n >= 0) || (data.schema !== null && (!Number.isSafeInteger(data.schema) || data.schema < 1))) {
      throw incomplete("Invalid plugin namespace facts");
    }
    const unversionedData = data.schema === null && (data.kvRows > 0 || data.documents > 0);
    const selected = choice.program && fact.candidates.find(candidate =>
      candidate.side === choice.program!.side && candidate.root === choice.program!.root && candidate.sha256 === choice.program!.sha256);
    if (choice.program && !selected) throw new AppError("backup/changed", "Selected plugin bytes changed after review");
    if (fact.builtin && (!selected || selected.side !== "target" || selected.root !== `bundled-plugins/${fact.id}`)) {
      throw incomplete("Current bundled plugin code must be retained");
    }
    if (!selected) return { id: fact.id, choice, manifest: null, data, migration: null, unversionedData, consentRequired: false, readiness: "data-only" };
    let manifest: PluginManifest;
    try {
      manifest = parseManifestJson(selected.manifest);
      if (manifest.id !== fact.id || !selected.mainPresent || selected.main !== (manifest.main ?? "main.js")) {
        throw incomplete("Plugin identity or entry module does not match the verified program");
      }
      if (!["plugins", "bundled-plugins"].some(folder => selected.root === `${folder}/${fact.id}`)) throw incomplete("Invalid plugin program root");
      assertPluginManifestCanActivate(manifest, { appVersion, builtin: fact.builtin && selected.side === "target" });
    } catch (cause) {
      // No raw manifest failure is a user-facing string; existing error surfaces
      // log this cause and render the stable backup error code.
      throw new AppError("backup/incomplete", "Selected plugin cannot run on this host", { cause });
    }
    return {
      id: fact.id, choice, manifest, data, unversionedData,
      // Describes work, not the presence of migrate(). The staged sandbox must
      // later call the same planner with its ACTUAL hasMigration before commit.
      migration: planPluginDataMigration({ storedVersion: data.schema, targetVersion: manifest.schemaVersion, hasMigration: true }),
      consentRequired: selected.side === "source",
      readiness: "probe-required",
    };
  });
}
