import type { PluginModule } from "@read-aware/plugin-types";
import { readGoal } from "./goals";
import { goalsView } from "./views";
import { copy } from "./strings";
import { registerGoalTools } from "./tools";
import { registerGoalMemory } from "./memory-status";
import { readingGoalSource } from "./context-source";

export default {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders) throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "target", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "target", keywords: "goal intention purpose", run: async () => ({ view: await goalsView(ctx) }) });
    registerGoalTools(ctx);
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], readingIntent: readingGoalSource(ctx), provide: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    registerGoalMemory(ctx);
  },
  migrate(_ctx, migration) {
    // v2 promotes per-book v1 KV lazily; downgrade would hide newer document edits.
    if (migration.direction !== "upgrade" || migration.fromVersion > 1 || migration.toVersion !== 2) throw Error("Unsupported Reading Goals schema migration");
  },
} satisfies PluginModule;
