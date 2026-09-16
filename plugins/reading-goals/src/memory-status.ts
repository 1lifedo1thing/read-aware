import type { PluginContext, PluginMemoryCandidateProvider } from "@read-aware/plugin-types";
import { readGoalState } from "./goals";

/**
 * Offers a book's goal as a memory candidate after each in-book turn, only
 * when the reader opted in on that goal. The host decides whether it is saved.
 */
export function registerGoalMemory(ctx: PluginContext): PluginMemoryCandidateProvider {
  const provider: PluginMemoryCandidateProvider = {
    id: "reading-goal", contexts: ["book"],
    async propose({ scope }) {
      if (scope.kind !== "book") return [];
      const state = await readGoalState(ctx, scope.bookId);
      if (!state.goal?.suggestMemory) return [];
      return [{ scope: "book", kind: "preference", content: state.goal.text }];
    },
  };
  ctx.contributions.memoryCandidateProviders!.register(provider);
  return provider;
}
