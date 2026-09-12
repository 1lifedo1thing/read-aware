import type { BackupProgramFacts } from "../../plugins/runtime/backup-program-review";

export type BackupReviewQuery =
  | { kind: "events" | "files" | "programs" | "credentials"; after?: string | null; limit: number }
  | { kind: "rows"; table: string; after?: number | null; limit: number }
  | { kind: "rowFields"; table: string; entryId: number; after?: number | null; limit: number }
  | { kind: "rowField"; table: string; entryId: number; column: string; side: "source" | "target"; offset: number };
type Page<K extends string, E, C = string> = { kind: K; entries: E[]; nextAfter: C | null };
export type BackupRowPolicy = "domain-state" | "conversation-state" | "plugin-data" | "legacy-data" | "review-settings"
  | "virtual-bindings" | "roaming-preferences" | "reseal-credential" | "translate-roaming-secret" | "preserve-device"
  | "recover-reading" | "review-runtime-history" | "rebuild" | "schema" | "event-identity" | "plugin-journal" | "blob-files";
type RowKind = "sourceOnly" | "targetOnly" | "same" | "different";
type CapturedFile = { path: string; byteSize: number; sha256: string };
type RoamingState = "absent" | "value" | "deleted" | "locked";
export type BackupCredentialFacts = {
  slot: string; sourceLocal: boolean; targetLocal: boolean;
  sourcePendingPublication: boolean; targetPendingPublication: boolean;
  localEqual: boolean | null; sourceRoaming: RoamingState; targetRoaming: RoamingState;
  sourceLocalMatchesRoaming: boolean | null; targetLocalMatchesRoaming: boolean | null;
};
/** Absent row = null; present SQL NULL = { type: "null" }. Integers never pass through JS numbers. */
export type BackupReviewCell =
  | { type: "null" }
  | { type: "integer"; decimal: string }
  | { type: "real"; decimal: string; bits: string }
  | { type: "text"; base64: string; text: string | null; byteLength: number; offset: number; nextOffset: number | null }
  | { type: "blob"; base64: string; byteLength: number; offset: number; nextOffset: number | null };
export type BackupReviewField = { name: string; primary: number; source: BackupReviewCell | null; target: BackupReviewCell | null };
export type BackupReviewPage =
  | (Page<"rowFields", BackupReviewField, number> & { table: string; entryId: number; policy: BackupRowPolicy; restricted: boolean })
  | { kind: "rowField"; table: string; entryId: number; column: string; side: "source" | "target"; value: BackupReviewCell | null }
  | Page<"events", { sourceId: string; kind: "new" | "existing" | "idConflict" | "clockConflict" | "idAndClockConflict";
      sourceDigest: string; idTargetDigest: string | null; clockTargetId: string | null; clockTargetDigest: string | null }>
  | Page<"rows", { entryId: number; policy: BackupRowPolicy; kind: RowKind; sourceDigest: string | null;
      targetDigest: string | null; generatedOnly: boolean }, number>
  | Page<"files", { path: string; policy: "blob" | "programTree" | "preserveCredentialKey"; kind: RowKind | "unavailable";
      source: CapturedFile | null; target: CapturedFile | null;
      targetBlob: { key: string | null; availability: "local" | "unavailable" | "missingLocalFile" | "registryMismatch" | "unregisteredFile" } | null }>
  | Page<"programs", BackupProgramFacts>
  | Page<"credentials", BackupCredentialFacts>;
