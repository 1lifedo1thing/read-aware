import type { BookLocationSearchPage, BookTextSearch, PluginModule } from "@read-aware/plugin-types";

let cancelPressure = () => {};

export default {
  activate(ctx) {
    const pending: AbortController[] = [];
    const results: { status: "pending" | "fulfilled" | "rejected"; count?: number; code?: string | number }[] = [];
    const search = (index: number) => {
      const controller = new AbortController(); pending[index] = controller;
      results[index] = { status: "pending" };
      void ctx.domains.library!.queries.books.searchLocations({ bookId: ctx.manifest.description!,
        query: "Text preparation probe", limit: 2 }, { signal: controller.signal }).then(
        page => { results[index] = { status: "fulfilled", count: page.hits.length }; },
        error => { results[index] = { status: "rejected", code: (error as { code?: string | number }).code ?? String(error) }; },
      );
    };
    for (const command of [
      { id: "pressure-start", run: () => {
        if (results.length) throw Error("Pressure probe already started");
        for (let index = 0; index < 40; index++) search(index);
      } },
      { id: "pressure-cancel", run: () => pending[0]?.abort() },
      { id: "pressure-retry", run: () => search(results.length) },
      { id: "pressure-status", run: () => undefined },
    ]) ctx.contributions.commands.register({ id: command.id, title: command.id, run: () => {
      command.run(); return { toast: JSON.stringify({ results }) };
    } });
    let captured: BookLocationSearchPage | undefined;
    for (const id of ["source-capture", "source-stale", "source-refresh"] as const) {
      ctx.contributions.commands.register({ id, title: id, run: async () => {
        const queries = ctx.domains.library!.queries.books;
        const input = { bookId: ctx.manifest.description!, query: "text", limit: 1 };
        if (id !== "source-stale") {
          const page = await queries.searchLocations(input);
          if (id === "source-capture") captured = page;
          const range = page.hits[0] ? await queries.readRange({ range: page.hits[0].range }) : null;
          return { toast: JSON.stringify({ page, range }) };
        }
        if (!captured?.nextCursor || !captured.hits[0]) throw Error("Capture a real continuation and range first");
        const rejected: Record<string, unknown> = {};
        for (const [key, run] of Object.entries({
          cursor: () => queries.searchLocations({ ...input, cursor: captured!.nextCursor! }),
          version: () => queries.searchLocations({ ...input, contentVersion: captured!.contentVersion }),
          range: () => queries.readRange({ range: captured!.hits[0].range }),
        })) {
          try { rejected[key] = { completed: true, result: await run() }; }
          catch (error) { rejected[key] = { completed: false, code: (error as { code?: string }).code }; }
        }
        return { toast: JSON.stringify(rejected) };
      } });
    }
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect derived-text search", run: async () => {
      const library = ctx.domains.library;
      if (!library) return { toast: JSON.stringify({ hasLibrary: false }) };
      const bookId = ctx.manifest.description!;
      const query = ["Text preparation probe"];
      const result: Record<string, unknown> = { hasLibrary: true, hasWrite: !!library.commands };
      for (const [key, input] of Object.entries({
        single: { queries: query, bookId }, shelf: { queries: query },
        fenced: { queries: query, bookId, throughChapterIndex: -1 },
        invalid: { queries: query, limit: 0 }, missing: { queries: query, bookId: "capability-nonexistent-book" },
      } satisfies Record<string, BookTextSearch>)) {
        try { result[key] = { completed: true, hits: await library.queries.books.searchText(input) }; }
        catch (error) { result[key] = { completed: false, code: (error as { code?: string }).code }; }
      }
      return { toast: JSON.stringify(result) };
    } });
    cancelPressure = () => { for (const controller of pending) controller.abort(); };
  },
  deactivate() { cancelPressure(); cancelPressure = () => {}; },
} satisfies PluginModule;
