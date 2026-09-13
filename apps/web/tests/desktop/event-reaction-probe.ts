import type { PluginModule } from "@read-aware/plugin-types";

const plugin: PluginModule = {
  activate(ctx) {
    ctx.domains.library!.events.subscribe("book.starred", async event => {
      const bound = ctx.withEvent(event);
      if (bound.lifecycle !== ctx.lifecycle) throw new Error("Event binding changed activation identity");
      await Promise.resolve();
      await bound.domains.reading!.commands!.step("next");
      await bound.services.storage.set("reaction", true);
      await bound.services.storage.collection("reactions").get("one");
      // Independent actions continue to use the activation context.
      await ctx.services.storage.getDurable("independent");
    });
  },
};
export default plugin;
