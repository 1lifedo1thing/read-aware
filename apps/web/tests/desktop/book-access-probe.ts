import type { PluginModule } from "@read-aware/plugin-types";

/** Runs inside the real Worker; retains IDs and codes, never book contents. */
export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "verify", title: "Verify book access", run: async () => {
      const input = ctx.services.storage.get<{ allowed: string; other: string }>("input");
      if (!input || input.allowed === input.other) throw new Error("Two distinct fixture books are required");
      const library = ctx.domains.library;
      const annotations = ctx.domains.annotations;
      if (!library || !annotations) throw new Error("Probe domain permissions are missing");
      const before = JSON.stringify(ctx.grants);
      try { Object.assign(ctx.grants.book, { mode: "all" }); } catch { /* immutable metadata */ }
      if (JSON.stringify(ctx.grants) !== before) throw new Error("Worker grant metadata was mutable");
      const allowed = await library.queries.books.get(input.allowed);
      if (allowed?.id !== input.allowed) throw new Error("Authorized fixture book was not readable");
      const page = await annotations.queries.page({ bookId: input.allowed, limit: 2 });
      if (page.items.some(item => item.bookId !== input.allowed)) throw new Error("Annotation page leaked another book");
      const checks: Record<string, string> = {};
      for (const [name, call] of [
        ["otherBook", () => library.queries.books.get(input.other)],
        ["otherAnnotations", () => annotations.queries.page({ bookId: input.other, limit: 2 })],
      ] as const) {
        let code = "allowed";
        try { await call(); } catch (error) { code = (error as { code?: string }).code ?? "unknown"; }
        const expected = ctx.grants.book.mode === "all" ? "allowed" : "plugin/object-access-denied";
        if (code !== expected) throw new Error(`${name}: expected ${expected}, received ${code}`);
        checks[name] = code;
      }
      return { toast: JSON.stringify({ grant: ctx.grants.book, allowed: allowed.id, annotationCount: page.items.length, checks }) };
    } });
  },
} satisfies PluginModule;
