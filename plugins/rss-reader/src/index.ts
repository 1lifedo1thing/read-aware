/** ReadAware's first-party RSS/Atom content provider and agent integration. */
import type { PluginModule } from "@read-aware/plugin-types";
import { registerAgentTools } from "./agent-tools";
import { forgetRemovedBook, loadFeedContent } from "./feed-library";
import { tr } from "./strings";
import { migrateLegacyFeeds } from "./storage";
import { assertPluginCapabilities, PROVIDER_ID } from "./types";
import { addFeedView, rssPageView } from "./views";
import { isHttpFeedUrl } from "./feed";
import { REFRESH_SCHEDULE, refreshScheduledFeeds } from "./refresh";

const plugin: PluginModule = {
  async activate(ctx) {
    assertPluginCapabilities(ctx);
    ctx.contributions.uriHandlers.register({id:"subscribe",open:request=>{
      if(request.parameters.length!==1||request.parameters[0]?.key!=="url"||!isHttpFeedUrl(request.parameters[0].value))
        throw Object.assign(Error("Expected one HTTP feed URL"),{code:"plugin/invalid-input"});
      // External navigation opens a draft only; fetching and durable subscribe
      // remain in the form's explicit submit handler.
      return {view:addFeedView(ctx,request.parameters[0].value)};
    }});
    ctx.contributions.contentProviders.register({
      id: PROVIDER_ID,
      load: url => loadFeedContent(ctx, url),
    });
    ctx.contributions.headerActions.register({
      id: "feeds",
      title: "RSS Feeds",
      icon: "globe",
      surface: "shelf",
      presentation: "page",
      view: () => rssPageView(ctx),
    });
    ctx.domains.library.events.subscribe("book.removed", async event => {
      try {
        const reaction = ctx.withEvent(event);
        assertPluginCapabilities(reaction);
        const feed = await forgetRemovedBook(reaction, event.payload.bookId);
        if (!feed) return;
        ctx.services.ui.showToast(tr(ctx.locale, "unsubscribedFrom", { title: feed.title }));
      } catch (error) { console.warn("RSS removed-book cleanup failed", error); }
    }, { ruleId: "removed-book-cleanup" });
    ctx.contributions.commands.register({
      id: "subscribe",
      title: "RSS: subscriptions",
      icon: "globe",
      keywords: "rss atom feed subscribe",
      run: async () => ({ view: await rssPageView(ctx) }),
    });

    // Declared in manifest.schedules: subscribed feeds stay fresh without a
    // manual refresh — hourly while the app is open, catch-up on launch.
    ctx.services.schedules.bind(REFRESH_SCHEDULE, async (_run, delivery) => {
      if (delivery?.reaction?.status === "cycle") return;
      const reaction = ctx.withEvent(delivery);
      assertPluginCapabilities(reaction);
      await refreshScheduledFeeds(reaction);
    });

    registerAgentTools(ctx);
  },
  async migrate(ctx, migration) {
    if (migration.direction === "upgrade" && migration.fromVersion === 0) {
      await migrateLegacyFeeds({ services: { storage: ctx.storage } });
    }
  },
};

export default plugin;
