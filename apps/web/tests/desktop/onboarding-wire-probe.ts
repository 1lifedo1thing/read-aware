import type { PluginModule } from "@read-aware/plugin-types";
export default { activate(ctx) {
  ctx.contributions.commands.register({ id: "onboarding", title: "Onboarding probe", run: async () => {
    const memory = ctx.domains.memory!;
    if (!memory.commands) return { toast: JSON.stringify({ status: "read-only", writable: false }) };
    const previous = await memory.queries.profile();
    const input = { submissionId: "desktop-worker-onboarding", expectedRevision: previous.revision,
      summary: `${previous.text}\nWorker-confirmed preference`, seeds: [{ kind: "preference" as const, content: "Worker-confirmed preference" }] };
    const first = await memory.commands.completeOnboarding(input);
    const second = await memory.commands.completeOnboarding(input);
    let conflict: unknown;
    try { await memory.commands.completeOnboarding({ ...input, summary: "Unapproved changed candidate" }); }
    catch (error) { conflict = error && typeof error === "object" && "code" in error ? error.code : null; }
    return { toast: JSON.stringify({ first, second, conflict }) };
  } });
} } satisfies PluginModule;
