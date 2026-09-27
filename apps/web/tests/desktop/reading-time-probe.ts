import type { PluginDisposable, PluginModule, ReadingTimeObservation } from "@read-aware/plugin-types";
import { hostAcknowledgement } from "./host-acknowledgement";

export default {
  activate(ctx) {
    const reading = ctx.domains.reading;
    const bookId = ctx.manifest.description!;
    const seen: ReadingTimeObservation[] = [];
    const recorded: unknown[] = [];
    reading?.events.subscribe("book.sessionRecorded", event => {
      if (event.payload.bookId === bookId) { recorded.push(event); if (recorded.length > 16) recorded.shift(); }
    });
    let subscription: PluginDisposable | undefined;
    for (const id of ["inspect", "page", "observe", "stop", "insights"] as const) ctx.contributions.commands.register({
      id, title: id, run: async () => {
        if (id === "observe" && reading && !subscription) subscription = await hostAcknowledgement(reading.events.observeTime({ bookId, limit: 1 }, event => {
          seen.push(event); if (seen.length > 16) seen.shift();
        }));
        if (id === "stop") { (await hostAcknowledgement(subscription))?.dispose(); subscription = undefined; }
        const current = reading ? await reading.queries.stats.time({ bookId, limit: 1 }) : null;
        const next = id === "page" && current?.nextCursor
          ? await reading!.queries.stats.time({ bookId, limit: 1, after: current.nextCursor }) : null;
        const insights = id === "insights" && reading ? await reading.queries.stats.insights({ bookId, period: "year" }) : null;
        return { toast: JSON.stringify({ current, next, seen, recorded, insights, hasReading: Boolean(reading),
          commands: Object.keys(reading?.commands ?? {}), version: ctx.capabilities.domains.reading }) };
      },
    });
  },
} satisfies PluginModule;
