import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "ping", title: "Ping", run: () => ({ toast: "alive" }) });
    ctx.contributions.commands.register({ id: "flood", title: "Flood", run: () => {
      // Deliberately bypass the friendly proxy: authoritative host admission must stop this.
      for (let index = 0; index < 40_000; index++) postMessage(null);
      return { toast: "sent" };
    } });
  },
};
export default plugin;
