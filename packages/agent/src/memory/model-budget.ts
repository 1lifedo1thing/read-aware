import { AppError } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";

/** Bounds each deterministic memory call; task chapter/attempt limits are separate. */
export function boundedMemoryComplete(complete: CompleteFn): CompleteFn {
  return async (model, context, options) => {
    let chars = context.systemPrompt?.length ?? 0;
    for (const message of context.messages) {
      if (typeof message.content === "string") chars += message.content.length;
      else for (const block of message.content) {
        if (block.type !== "text") throw new AppError("memory/input-budget-exceeded", "Memory pipeline requires bounded text input");
        chars += block.text.length;
      }
      if (chars > 262144) throw new AppError("memory/input-budget-exceeded", "Memory model input exceeds its budget");
    }
    if (chars > 262144) throw new AppError("memory/input-budget-exceeded", "Memory model input exceeds its budget");
    const message = await complete(model, context, { ...options, maxTokens: Math.min(options?.maxTokens ?? 16384, model.maxTokens || 16384, 16384) });
    let output = 0;
    for (const block of message.content) {
      if (block.type === "text") output += block.text.length;
      if (block.type === "thinking") output += block.thinking.length;
      if (output > 262144) throw new AppError("memory/output-budget-exceeded", "Memory model output exceeds its budget");
    }
    return message;
  };
}
