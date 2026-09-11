import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.services.schedules.bind("work", async context => {
      await ctx.services.storage.set("last-run", context);
    });
    ctx.contributions.commands.register({ id: "enqueue", title: "Enqueue", run: async () => {
      const requestId = crypto.randomUUID();
      const receipt = await ctx.services.schedules.defer("work", { requestId, delayMs: 1000, when: "idle" });
      const retry = await ctx.services.schedules.defer("work", { requestId, delayMs: 1000, when: "idle" });
      return { toast: JSON.stringify({ receipt, retry }) };
    } });
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect", run: async () => ({ toast: JSON.stringify({
      schedules: await ctx.services.schedules.list(), lastRun: await ctx.services.storage.getDurable("last-run"),
    }) }) });
  },
};
export default plugin;
