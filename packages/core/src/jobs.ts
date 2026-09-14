import { AppError } from "./errors";
import { clonePluginServiceData } from "./plugin-services";
import { normalizeAtomicOperations, type AtomicOperation } from "./transactions";
import { normalizeBookTextPrepareOptions, type BookTextPrepareOptions } from "./book-text";
import { normalizeBookGraphTaskOptions, type BookGraphTaskOptions } from "./book-graph-task";

export type DurableJobStep = { id: string } & (
  | { kind: "transaction"; operations: AtomicOperation[] }
  | { kind: "library.text.prepare"; bookId: string; options?: BookTextPrepareOptions }
  | { kind: "book.graph"; bookId: string; mode: "catch-up" | "rebuild"; options?: BookGraphTaskOptions }
);
export type DurableJobPlan = { title: string; steps: DurableJobStep[] };
export type DurableJobStatus = "queued" | "running" | "paused" | "needs-attention" | "completed" | "failed" | "cancelled";
export type DurableJobSnapshot = {
  id: string; title: string; revision: string; status: DurableJobStatus;
  totalSteps: number; completedSteps: number; activeStep: Pick<DurableJobStep, "id" | "kind"> | null;
  errorCode: string | null; createdAt: string; updatedAt: string;
};
export type DurableJobControl = "pause" | "resume" | "cancel";
export interface DurableJobsPort {
  start(plan: DurableJobPlan, signal?: AbortSignal): Promise<DurableJobSnapshot>;
  get(id: string, signal?: AbortSignal): Promise<DurableJobSnapshot>;
  list(query?: { offset?: number; limit?: number }, signal?: AbortSignal): Promise<{ jobs: DurableJobSnapshot[]; nextOffset: number | null }>;
  control(id: string, action: DurableJobControl, signal?: AbortSignal): Promise<DurableJobSnapshot>;
}
const invalid = (): never => { throw new AppError("jobs/invalid-plan", "Invalid durable job plan"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);

export function normalizeDurableJobPlan(input: unknown): DurableJobPlan {
  const plan = clonePluginServiceData(input);
  if (!object(plan) || !fields(plan, ["title", "steps"]) || !text(plan.title, 160) || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 32) return invalid();
  const ids = new Set<string>();
  const steps: DurableJobStep[] = plan.steps.map(step => {
    if (!object(step) || !text(step.id, 64) || ids.has(step.id)) return invalid();
    ids.add(step.id);
    if (step.kind === "transaction" && fields(step, ["id", "kind", "operations"])) return { id: step.id, kind: step.kind, operations: normalizeAtomicOperations(step.operations) };
    if (!text(step.bookId, 1024)) return invalid();
    if (step.kind === "library.text.prepare" && fields(step, ["id", "kind", "bookId", "options"])) {
      return { id: step.id, kind: step.kind, bookId: step.bookId, options: normalizeBookTextPrepareOptions(step.options as BookTextPrepareOptions) };
    }
    if (step.kind === "book.graph" && fields(step, ["id", "kind", "bookId", "mode", "options"]) && ["catch-up", "rebuild"].includes(String(step.mode))) {
      return { id: step.id, kind: step.kind, bookId: step.bookId, mode: step.mode as "catch-up" | "rebuild", options: normalizeBookGraphTaskOptions(step.options) };
    }
    return invalid();
  });
  return { title: plan.title.trim(), steps };
}
