import type { PluginModule } from "@read-aware/plugin-types";
import type { ContextBundle, ResourceRef } from "@read-aware/core";

export default {
  activate(ctx) {
    const memory = ctx.domains.memory;
    const selector = { kind: "user_profile_context", scope: { kind: "user" } } as const;
    let bundle: ContextBundle | undefined, resource: ResourceRef | undefined;
    const report = async (run: () => unknown) => {
      try { return { toast: JSON.stringify({ status: "ok", value: await run() }) }; }
      catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }) }; }
    };
    const actions = {
      inspect: async () => ({ hasMemory: !!memory, hasWrite: !!memory?.commands,
        profile: await memory?.queries.profile(), entities: await memory?.queries.entities(),
        derived: await memory?.queries.profileContext() }),
      capture: async () => { const result = await memory!.commands!.context.capture(selector); bundle = result.bundle; return result; },
      history: () => memory!.queries.context.history(selector),
      read: () => { if (!bundle) throw Error("Capture first"); return memory!.queries.context.read({ ...selector, version: bundle.version }); },
      export: async () => {
        if (!bundle) throw Error("Capture first");
        resource = await memory!.queries.context.export({ ...selector, version: bundle.version }); return resource;
      },
      readExport: async () => {
        if (!resource) throw Error("Export first");
        const chunk = await ctx.services.resources.read(resource.id, 0, 4096);
        return { byteLength: chunk.data.byteLength, eof: chunk.eof, nextOffset: chunk.nextOffset,
          text: new TextDecoder().decode(chunk.data) };
      },
      wrongRecipe: () => memory!.commands!.context.capture({ kind: "conversation_insights_context", scope: { kind: "conversation", id: "validation-identity" } }),
      release: async () => { if (resource) await ctx.services.resources.release(resource.id); resource = undefined; return { released: true }; },
    };
    for (const [id, run] of Object.entries(actions)) ctx.contributions.commands.register({ id, title: id, run: () => report(run) });
  },
} satisfies PluginModule;
