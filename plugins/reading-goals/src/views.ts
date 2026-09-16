import type { PluginAction, PluginBlock, PluginContext, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { readGoalState, writeGoal } from "./goals";
import { copy } from "./strings";

function notice(ctx: PluginContext, text: string, bookId?: string): PluginView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text, tone: "muted" }], actions: bookId ? [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "primary", run: async () => ({ view: await goalsView(ctx, bookId), navigation: "replace" }) },
  ] : [] };
}

/**
 * One book, one goal. The form is the whole surface: the current goal is its
 * initial value, saving replaces it, and clearing is a confirmed action.
 */
export async function goalsView(ctx: PluginContext, bookId?: string): Promise<PluginView> {
  const t = copy(ctx.locale);
  const target = bookId ?? (await ctx.domains.reading!.queries.session()).bookId;
  if (!target) return notice(ctx, t.noBook);
  const book = await ctx.domains.library!.queries.books.get(target);
  if (!book) return notice(ctx, t.bookMissing);
  const { goal, revision } = await readGoalState(ctx, target);
  const memoryEnabled = (await ctx.domains.settings.queries.read("ai.preferences.buildMemory")).value === true;
  const refresh = async (toast?: string): Promise<PluginViewResult> => ({ view: await goalsView(ctx, target), navigation: "replace", ...(toast ? { toast } : {}) });
  const goalForm: PluginFormView = {
    kind: "form", submitLabel: t.save,
    fields: [
      { kind: "textarea", id: "goal", label: t.goal, value: goal?.text ?? "", rows: 4, placeholder: t.goalPlaceholder, helperText: t.goalHelp },
      { kind: "checkbox", id: "suggestMemory", label: t.remember, value: goal?.suggestMemory ?? false },
    ],
    onSubmit: async (values): Promise<PluginViewResult> => {
      const text = typeof values.goal === "string" ? values.goal.trim() : "";
      if (!text || text.length > 500) return { fieldErrors: { goal: t.invalid } };
      if (typeof values.suggestMemory !== "boolean") return { fieldErrors: { suggestMemory: t.invalid } };
      const result = await writeGoal(ctx, target, { text, suggestMemory: values.suggestMemory }, revision);
      if (result.status !== "saved") return { view: notice(ctx, t.conflict, target), navigation: "replace" };
      return refresh(t.saved);
    },
  };
  const blocks: PluginBlock[] = [
    { kind: "heading", text: book.title, ...(book.author ? { caption: book.author } : {}) },
    goalForm,
  ];
  if (goal?.suggestMemory && !memoryEnabled) blocks.push({ kind: "alert", message: t.memoryOff });
  const actions: PluginAction[] = [];
  if (goal) actions.push({ id: "clear", label: t.clear, icon: "trash", variant: "danger", priority: "secondary", run: () => ({ view: {
    kind: "form", title: t.clear, submitLabel: t.clear,
    fields: [{ kind: "checkbox", id: "confirm", label: t.confirm, value: false }],
    onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: t.required } };
      const result = await writeGoal(ctx, target, null, revision);
      if (result.status !== "cleared") return { view: notice(ctx, t.conflict, target), navigation: "replace" };
      return refresh(t.cleared);
    },
  } satisfies PluginFormView }) });
  actions.push({ id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: () => refresh() });
  blocks.push({ kind: "actions", actions, align: "end" });
  return { kind: "blocks", title: t.title, blocks };
}
