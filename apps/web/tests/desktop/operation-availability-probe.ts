import type { PluginModule } from "@read-aware/plugin-types";
export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "check", title: "Check prerequisites", run: async () => {
      const abort = new AbortController();
      const pending = ctx.services.session.operationAvailability({ operation: "llm.infer", model: "smart", images: true }, { signal: abort.signal });
      if (ctx.manifest.description === "cancel") abort.abort(Object.assign(new Error("Cancelled probe"), { code: "plugin/cancelled" }));
      try { return { toast: JSON.stringify(await pending) }; }
      catch (error) {
        if (error && typeof error === "object" && "code" in error) return { toast: String(error.code) };
        throw error;
      }
    } });
  },
} satisfies PluginModule;
