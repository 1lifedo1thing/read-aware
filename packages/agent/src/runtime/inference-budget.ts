import { AppError } from "@read-aware/core";
import type { InferenceAttemptReceipt } from "@read-aware/core";

export const INFERENCE_INPUT_CHARS = 262_144;
export const INFERENCE_OUTPUT_CHARS = 262_144;
export const INFERENCE_TOTAL_OUTPUT_TOKENS = 131_072;
export type InferenceBudgetOptions = { maxTotalOutputTokens?: number; maxOutputChars?: number };
const valid = (value: number | undefined, max: number) => value === undefined || Number.isSafeInteger(value) && value >= 1 && value <= max;
const exhausted = () => new AppError("ai/budget-exceeded", "Inference output budget exhausted");

/** Requested output reservations span structured retries; absent usage never restores a reservation. */
export class InferenceBudget {
  private usedTokens = 0;
  private outputChars = 0;
  private readonly charLimit: number;
  constructor(private readonly options: InferenceBudgetOptions) {
    if (!valid(options.maxTotalOutputTokens, INFERENCE_TOTAL_OUTPUT_TOKENS) || !valid(options.maxOutputChars, INFERENCE_OUTPUT_CHARS))
      throw new AppError("plugin/invalid-argument", "Invalid inference budget");
    this.charLimit = options.maxOutputChars ?? INFERENCE_OUTPUT_CHARS;
  }
  input(system: string | undefined, prompt: string): void {
    if ((system?.length ?? 0) + prompt.length > INFERENCE_INPUT_CHARS) throw new AppError("ai/input-budget-exceeded", "Inference text input exceeds its budget");
  }
  reserve(perAttempt: number | undefined, modelLimit: number | undefined): { maxTokens: number | undefined; record(receipt: InferenceAttemptReceipt): void; assertWithinBudget(): void } {
    const remaining = this.options.maxTotalOutputTokens === undefined ? undefined : this.options.maxTotalOutputTokens - this.usedTokens;
    if (remaining !== undefined && remaining <= 0) throw exhausted();
    const caps = [perAttempt, remaining, Number.isSafeInteger(modelLimit) && modelLimit! > 0 ? modelLimit : undefined].filter((value): value is number => value !== undefined);
    const maxTokens = perAttempt === undefined && remaining === undefined ? undefined : Math.min(...caps);
    const reserved = remaining === undefined ? 0 : maxTokens!;
    this.usedTokens += reserved;
    let recorded = false;
    return { maxTokens, record: receipt => {
      if (recorded) return; recorded = true;
      if (remaining !== undefined && receipt.usage?.output !== null && receipt.usage?.output !== undefined) {
        // Some SDKs expose other counters but leave output=0 as an unavailable placeholder.
        // Do not refund a zero/unknown result unless the reservation itself was zero.
        const output = receipt.usage.output;
        if (output > 0) this.usedTokens += output - reserved;
      }
    }, assertWithinBudget: () => {
      if (this.options.maxTotalOutputTokens !== undefined && this.usedTokens > this.options.maxTotalOutputTokens) throw exhausted();
    } };
  }
  output(text: string): void {
    if (this.outputChars + text.length > this.charLimit) throw exhausted();
    this.outputChars += text.length;
  }
}
