import type { EvalRunRecord, JsonObject, JsonValue } from "./types";
import { toJsonValue } from "./json";
import { hasExecutionError } from "./reviews";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function receipt(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** Agent-facing projection of an existing run, not another scoring system.
 * Preserve complete answers/results and stable evidence coordinates, omit hidden
 * reasoning and repeated request payloads. Scores stay opt-in to reduce anchoring.
 */
export function buildReviewPacket(record: EvalRunRecord, includeDiagnostics = false): JsonObject {
  const observation = object(record.output ?? record.partialOutput);
  const scenario = object(record.input);
  const tools = entries(observation.tools);
  const interactions = entries(observation.interactions);
  return toJsonValue({
    schemaVersion: 1,
    targetId: `run:${record.id}`,
    identity: { suiteId: record.suiteId, scenarioId: record.scenarioId, variantId: record.variantId, repetition: record.repetition },
    execution: { status: hasExecutionError(record) ? "error" : "completed",
      ...(hasExecutionError(record) ? { error: record.error } : { diagnosticError: record.error }),
      evidence: record.output === undefined ? "interrupted or missing output; not eligible for quality acceptance" : "completed output" },
    scenario: record.input,
    turns: entries(observation.turns).map((turn, index) => ({
      turn: turn.turn ?? index + 1,
      input: turn.input,
      answer: turn.answer,
      stateBefore: turn.stateBefore,
      stateAfter: turn.stateAfter,
      tools: tools.filter(t => t.turn === undefined || t.turn === (turn.turn ?? index + 1)).map(t => ({
        id: t.id, name: t.name, args: t.args, result: receipt(t.output), isError: t.isError,
      })),
      interactions: interactions.filter(t => t.turn === undefined || t.turn === (turn.turn ?? index + 1)),
    })),
    finalAnswer: observation.answer,
    originalEvidence: observation.reviewEvidence ?? {
      availability: "No independent source snapshot in this legacy artifact; consult the recorded seed and original local fixture.",
      recordedSeed: scenario.seed,
    },
    finalState: observation.state,
    telemetry: record.telemetry,
    ...(includeDiagnostics ? { diagnostics: record.assessment } : {}),
  }) as JsonObject;
}

export function manualReviewPacket(session: import("./reviews").ManualReviewSession, turn: import("./reviews").ManualReviewTurn): JsonValue {
  return toJsonValue({ schemaVersion: 1, targetId: `manual:${turn.id}`, identity: { sessionId: session.id,
    scenarioId: session.scenarioId, variantId: session.variantId, model: session.model },
    precedingTurns: session.turns.slice(0, session.turns.findIndex(t => t.id === turn.id)).map(t => ({ targetId: `manual:${t.id}`, question: t.question, answer: t.answer, tools: t.tools, interactions: t.interactions })),
    question: turn.question, answer: turn.answer, input: turn.input,
    tools: turn.tools.map(t => ({ ...t, result: receipt(t.output), output: undefined })),
    interactions: turn.interactions, originalEvidence: turn.reviewEvidence ?? "Legacy turn: consult local fixture and session context",
    finalState: turn.state, telemetry: turn.telemetry });
}
