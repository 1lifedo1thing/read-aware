import type { BookSummary } from "./read-models";
export type BookImportReceipt = { status: "imported" | "duplicate"; book: BookSummary };

/** Host milestones, not invented byte percentages inside an opaque native stage. */
export type BookImportPhase = "preparing" | "staging" | "committing";
export type BookImportRequest = { kind: "resource"; resourceId: string }
  | { kind: "file"; fileName: string; data: ArrayBuffer | Uint8Array };
export type BookImportTaskSnapshot = {
  taskId: string;
  sourceName: string;
  phase: "queued" | BookImportPhase | "completed" | "cancelled" | "failed";
  revision: number;
  createdAt: string;
  updatedAt: string;
  cancellable: boolean;
  cancelRequested: boolean;
  receipt: BookImportReceipt | null;
  errorCode: string | null;
};
