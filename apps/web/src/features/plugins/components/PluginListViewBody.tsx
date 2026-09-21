import { ListBullets } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Caption,
  EmptyState,
  Eyebrow,
  ItemList,
  SearchField,
  Stack,
  Tabs,
  Tag,
  Tooltip,
} from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import { localKV } from "../../../platform/local-store";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { renderPluginIcon } from "../lib/plugin-icons";
import { PluginVirtualRows, type VirtualRow } from "./PluginVirtualRows";
import {
  filterPluginTimelineItems,
  groupPluginTimelineItems,
  type PluginTimelineRange,
} from "../lib/plugin-timeline";
import type { PluginListAccessory, PluginListItem, PluginListView } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginViewPagination } from "./PluginViewPagination";
import type { PluginQueryRunner, PluginResultRunner } from "./plugin-view-types";

type PluginListViewBodyProps = {
  view: PluginListView;
  busy: boolean;
  onResult: PluginResultRunner;
  /**
   * Plugin-computed search (`view.search`): the text the session last sent,
   * which seeds the field on mount and gates re-sending, and the runner that
   * applies the plugin's answer in place.
   */
  searchQuery?: string;
  onQuery?: PluginQueryRunner;
  /**
   * Stable identity of the hosting view (a contribution key). When present,
   * the timeline's selected range persists across reopens under it.
   */
  viewStateKey?: string;
};

const SEARCH_DEBOUNCE_MS = 200;
const TIMELINE_RANGES: PluginTimelineRange[] = ["today", "week", "month", "all"];

const timelineStorageKey = (viewStateKey: string) =>
  `read-aware-plugin-timeline.${viewStateKey}`;

/** The remembered range for a view (defaults to "today"), from local storage. */
function readTimelineRange(viewStateKey: string | undefined): PluginTimelineRange {
  if (!viewStateKey) return "today";
  const stored = localKV.getItem(timelineStorageKey(viewStateKey));
  return stored && (TIMELINE_RANGES as string[]).includes(stored)
    ? (stored as PluginTimelineRange)
    : "today";
}

function accessoryNode(accessory: PluginListAccessory, index: number) {
  if (accessory.kind === "text") {
    return (
      <Caption key={index} className="max-w-32 truncate text-fg-subtle">
        {accessory.text}
      </Caption>
    );
  }
  if (accessory.kind === "tag") return <Tag key={index}>{accessory.text}</Tag>;
  const icon = renderPluginIcon(accessory.icon, 14);
  return accessory.label ? (
    <Tooltip key={index} content={accessory.label} side="top">
      {icon}
    </Tooltip>
  ) : (
    <Fragment key={index}>{icon}</Fragment>
  );
}

export function PluginListViewBody({
  view,
  busy,
  onResult,
  searchQuery = "",
  onQuery,
  viewStateKey,
}: PluginListViewBodyProps) {
  const { t } = useTranslation("plugins");
  const locale = useLocale();
  const pluginSearch = view.search;
  const [query, setQuery] = useState(pluginSearch ? searchQuery : "");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  // Plugin-computed search: send the settled text once per change. The answer
  // swaps this frame's content in place, so `view` (and `pluginSearch`) change
  // identity while `searchQuery` catches up — the equality check keeps that
  // from echoing the same text back to the plugin.
  useEffect(() => {
    if (!pluginSearch || !onQuery) return;
    const next = debouncedQuery.trim();
    if (next === searchQuery) return;
    void onQuery(next, () => pluginSearch.onQuery(next));
  }, [debouncedQuery, onQuery, pluginSearch, searchQuery]);
  const settling = pluginSearch !== undefined && query.trim() !== searchQuery;

  // Enter in a go-to box takes the first row, the way a command palette does.
  const submitFirst = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !pluginSearch || busy || settling) return;
    const first = view.items.find((item) => item.onSelect);
    if (!first) return;
    event.preventDefault();
    void onResult(() => first.onSelect!(), { presentation: first.presentation, dialogTitle: first.title });
  };
  // Defaults to "today" (the freshest slice), and remembers the user's choice
  // per view when a stable key is available.
  const [range, setRange] = useState<PluginTimelineRange>(() => readTimelineRange(viewStateKey));

  const selectRange = (next: PluginTimelineRange) => {
    setRange(next);
    if (viewStateKey) localKV.setItem(timelineStorageKey(viewStateKey), next);
  };

  const items = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    if (!needle || !view.searchable) return view.items;
    return view.items.filter((item) =>
      [item.title, item.subtitle, ...(item.keywords ?? [])]
        .filter((part): part is string => Boolean(part))
        .some((part) => part.toLocaleLowerCase().includes(needle)),
    );
  }, [debouncedQuery, view.items, view.searchable]);

  // One item as a virtual row: reuses the design-system ItemList.Item; the
  // top border stands in for ItemList's own `divide-y` (which a one-item list
  // can't draw), so consecutive items in a section keep their separator.
  const itemRowNode = (item: PluginListItem, withDivider: boolean): ReactNode => (
    <ItemList className={withDivider ? "border-t border-border/60" : undefined}>
      <ItemList.Item
        title={item.title}
        subtitle={item.subtitle}
        icon={renderPluginIcon(item.icon, 16)}
        accessories={item.accessories?.map(accessoryNode)}
        disclosure={item.presentation === "dialog" ? "none" : "chevron"}
        disabled={busy}
        onClick={
          item.onSelect
            ? () => void onResult(
                () => item.onSelect!(),
                { presentation: item.presentation, dialogTitle: item.title },
              )
            : undefined
        }
      />
    </ItemList>
  );

  const headerRowNode = (label: string, first: boolean): ReactNode => (
    <Eyebrow className={cn("block pb-2", first ? "pt-0" : "pt-5")}>{label}</Eyebrow>
  );

  const plainRows: VirtualRow[] = items.map((item, index) => ({
    key: item.id,
    size: item.subtitle ? 60 : 48,
    content: itemRowNode(item, index > 0),
  }));

  // Timeline content is built ONLY for the active range — the Tabs component
  // mounts every panel, so computing/flattening all four would put every
  // range's rows in the tree even when unseen.
  const activeTimelineRows = (): VirtualRow[] => {
    const sections = groupPluginTimelineItems(
      filterPluginTimelineItems(items, range),
      locale,
      {
        today: t("viewer.timeline.today"),
        yesterday: t("viewer.timeline.yesterday"),
        unknownDate: t("viewer.timeline.unknownDate"),
      },
    );
    const rows: VirtualRow[] = [];
    sections.forEach((section, sectionIndex) => {
      rows.push({
        key: `header:${section.key}`,
        size: sectionIndex === 0 ? 28 : 48,
        content: headerRowNode(section.label, sectionIndex === 0),
      });
      section.items.forEach((item, itemIndex) => {
        rows.push({
          key: `item:${item.id}`,
          size: item.subtitle ? 60 : 48,
          content: itemRowNode(item, itemIndex > 0),
        });
      });
    });
    return rows;
  };

  const timelineTabs = view.timeline
    ? TIMELINE_RANGES.map((tabRange) => {
        if (tabRange !== range) {
          // Inactive panel — an empty placeholder; content builds on activation.
          return { label: t(`viewer.timeline.${tabRange}`), content: null };
        }
        const rows = activeTimelineRows();
        return {
          label: t(`viewer.timeline.${tabRange}`),
          content:
            rows.length === 0 ? (
              <EmptyState
                title={
                  debouncedQuery.trim()
                    ? t("viewer.noMatches")
                    : t("viewer.timeline.noItems")
                }
                className="py-10"
              />
            ) : (
              <PluginVirtualRows rows={rows} />
            ),
        };
      })
    : [];

  const listActions = view.actions?.length ? (
    <PluginActionGroup
      actions={view.actions}
      busy={busy}
      align="end"
      display="toolbar"
      onResult={onResult}
    />
  ) : null;

  // A go-to box stays put while its long answer scrolls under it: the field is
  // the whole point of the surface, so it must never leave the viewport.
  const searchField = pluginSearch ? (
    <div className="sticky top-0 z-10 bg-[var(--ra-main-surface-color)]">
      <SearchField
        label={pluginSearch.placeholder ?? t("viewer.search")}
        placeholder={pluginSearch.placeholder ?? t("viewer.search")}
        value={query}
        autoFocus={pluginSearch.autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={submitFirst}
      />
    </div>
  ) : view.searchable ? (
    <SearchField
      label={view.searchPlaceholder ?? t("viewer.search")}
      placeholder={view.searchPlaceholder ?? t("viewer.search")}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
    />
  ) : null;

  if (view.items.length === 0) {
    // List-level actions must survive emptiness — on a fresh surface they are
    // the only way to create the first item at all. A plugin-computed search
    // keeps its field too: an empty answer is a state of the box, not its end.
    return (
      <Stack gap="sm">
        {pluginSearch && searchField}
        {listActions}
        <EmptyState
          icon={<ListBullets size={28} weight="regular" aria-hidden="true" />}
          title={view.emptyText ?? (pluginSearch && searchQuery ? t("viewer.noMatches") : t("viewer.empty"))}
          className="py-10"
        />
        <PluginViewPagination pagination={view.pagination} busy={busy} onResult={onResult} />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {searchField}

      {view.timeline ? (
        <Tabs
          items={timelineTabs}
          activeIndex={Math.max(0, TIMELINE_RANGES.indexOf(range))}
          onActiveIndexChange={(index) => selectRange(TIMELINE_RANGES[index])}
          ariaLabel={t("viewer.timeline.filter")}
          trailing={listActions}
        />
      ) : items.length === 0 ? (
        <EmptyState title={t("viewer.noMatches")} className="py-10" />
      ) : (
        <Stack
          gap="sm"
          aria-busy={settling || undefined}
          className={cn("transition-opacity", settling && "opacity-60")}
        >
          {listActions}
          <PluginVirtualRows rows={plainRows} />
        </Stack>
      )}
      <PluginViewPagination pagination={view.pagination} busy={busy} onResult={onResult} />
    </Stack>
  );
}
