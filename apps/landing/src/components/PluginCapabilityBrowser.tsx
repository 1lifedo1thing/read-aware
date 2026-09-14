import {
  ArrowSquareOut,
  Check,
  LinkSimple,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocsResource } from "../i18n";
import { useCapabilityExplorer } from "../hooks/useCapabilityExplorer";
import {
  API_METHOD_COUNT,
  CAPABILITIES,
  CAPABILITY_AUTHORITIES,
  CAPABILITY_FAMILIES,
  CAPABILITY_TOPICS,
  capabilityManifest,
  filterCapabilities,
  normalizeSearchText,
  type CapabilityAuthority,
  type CapabilityDescriptions,
  type CapabilityEntry,
  type CapabilityFamily,
  type CapabilityTopic,
} from "../lib/plugin-capabilities";
import { CodeBlock } from "./CodeBlock";

export type PluginCapabilityBrowserCopy = Omit<
  DocsResource["capabilityBrowser"],
  "descriptions" | "result" | "catalogSummary"
> & {
  descriptions: CapabilityDescriptions;
  result: (count: number) => string;
  catalogSummary: (capabilities: number, methods: number) => string;
};
const fieldClass =
  "h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-fg-muted";
const buttonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border-strong px-3 py-1.5 text-sm text-fg hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted";
const sourceUrl = (source: string, line: number) =>
  `https://github.com/ahpxex/read-aware/blob/main/${source}#L${line}`;
const PRESETS = {
  search: "searchLocations",
  memory: "memory",
  jobs: "jobs",
  network: "network",
} as const;

export function PluginCapabilityBrowser({
  copy,
}: {
  copy: PluginCapabilityBrowserCopy;
}) {
  const { search, update, reset } = useCapabilityExplorer();
  const results = useMemo(
    () => filterCapabilities(search, copy.descriptions, copy.topicNames),
    [
      search.q,
      search.family,
      search.authority,
      search.topic,
      copy.descriptions,
      copy.topicNames,
    ],
  );
  const selected =
    results.find((entry) => entry.key === search.cap) ?? results[0];
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyLink() {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("cap", selected.key);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus("copied");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section
      data-doc-slot="capability-browser"
      aria-label={copy.browseLabel}
      className="capability-explorer my-7 min-w-0 rounded-lg border border-border-strong bg-surface/40"
    >
      <div className="space-y-4 border-b border-border px-4 py-5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="!m-0 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              {copy.catalogLabel}
            </p>
            <p className="!mb-0 !mt-1 text-sm text-fg-muted">
              {copy.catalogSummary(CAPABILITIES.length, API_METHOD_COUNT)}
            </p>
          </div>
          <button type="button" onClick={copyLink} className={buttonClass}>
            {copyStatus === "copied" ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <LinkSimple size={16} aria-hidden="true" />
            )}
            {copyStatus === "copied" ? copy.copiedLabel : copy.shareLabel}
          </button>
        </div>
        {copyStatus === "failed" ? (
          <p role="alert" className="!m-0 text-sm text-fg-muted">
            {copy.copyFailed}
          </p>
        ) : null}
        <label className="relative block">
          <span className="sr-only">{copy.searchLabel}</span>
          <MagnifyingGlass
            size={19}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            value={search.q ?? ""}
            onChange={(event) =>
              update({ q: event.target.value || undefined, cap: undefined })
            }
            placeholder={copy.searchPlaceholder}
            className={`${fieldClass} !pl-10`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Filter
            label={copy.topicLabel}
            value={search.topic ?? ""}
            all={copy.allTopics}
            options={CAPABILITY_TOPICS.map((value) => [
              value,
              copy.topicNames[value],
            ])}
            onChange={(value) =>
              update({
                topic: (value as CapabilityTopic) || undefined,
                cap: undefined,
              })
            }
          />
          <Filter
            label={copy.familyLabel}
            value={search.family ?? ""}
            all={copy.allFamilies}
            options={CAPABILITY_FAMILIES.map((value) => [
              value,
              copy.familyNames[value],
            ])}
            onChange={(value) =>
              update({
                family: (value as CapabilityFamily) || undefined,
                cap: undefined,
              })
            }
          />
          <Filter
            label={copy.authorityLabel}
            value={search.authority ?? ""}
            all={copy.allAuthorities}
            options={CAPABILITY_AUTHORITIES.map((value) => [
              value,
              copy.authorityNames[value],
            ])}
            onChange={(value) =>
              update({
                authority: (value as CapabilityAuthority) || undefined,
                cap: undefined,
              })
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-fg-subtle">{copy.quickStartLabel}</span>
          {Object.entries(PRESETS).map(([key, query]) => (
            <button
              type="button"
              key={key}
              className="text-left text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg focus-visible:outline-2"
              onClick={() =>
                update({
                  q: query,
                  family: undefined,
                  authority: undefined,
                  topic: undefined,
                  cap: undefined,
                })
              }
            >
              {copy.quickStarts[key as keyof typeof PRESETS]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p
            aria-live="polite"
            role="status"
            className="!m-0 text-sm text-fg-muted"
          >
            {copy.result(results.length)}
          </p>
          {search.q || search.topic || search.family || search.authority ? (
            <button
              type="button"
              onClick={reset}
              className="text-sm underline underline-offset-4"
            >
              {copy.clearFilters}
            </button>
          ) : null}
        </div>
      </div>
      {selected ? (
        <div className="grid min-w-0 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.7fr)]">
          <nav
            aria-label={copy.browseLabel}
            className="max-h-64 overflow-y-auto border-b border-border lg:max-h-[44rem] lg:border-b-0 lg:border-r"
          >
            <ul className="!m-0 !list-none !p-2">
              {results.map((entry) => (
                <li key={entry.key} className="!m-0">
                  <button
                    type="button"
                    aria-pressed={selected.key === entry.key}
                    aria-controls="capability-details"
                    onClick={() => update({ cap: entry.key }, false)}
                    className={`w-full rounded-md px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${selected.key === entry.key ? "bg-fg text-paper" : "text-fg hover:bg-surface"}`}
                  >
                    <span className="block break-words font-mono text-sm font-medium">
                      {entry.id}
                    </span>
                    <span
                      className={`mt-1 block text-xs ${selected.key === entry.key ? "opacity-75" : "text-fg-subtle"}`}
                    >
                      {copy.familyNames[entry.family]} · {entry.version}
                    </span>
                    <span
                      className={`mt-1.5 line-clamp-2 text-xs leading-relaxed ${selected.key === entry.key ? "opacity-85" : "text-fg-muted"}`}
                    >
                      {copy.descriptions[entry.key].purpose}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <CapabilityDetail
            key={selected.key}
            entry={selected}
            copy={copy}
            query={search.q ?? ""}
          />
        </div>
      ) : (
        <div className="px-5 py-12 text-center">
          <p className="!mt-0 text-fg-muted">{copy.noResults}</p>
          <button type="button" onClick={reset} className={buttonClass}>
            {copy.clearFilters}
          </button>
        </div>
      )}
    </section>
  );
}

function Filter({
  label,
  value,
  all,
  options,
  onChange,
}: {
  label: string;
  value: string;
  all: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs text-fg-muted">{label}</span>
      <select
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function CapabilityDetail({
  entry,
  copy,
  query,
}: {
  entry: CapabilityEntry;
  copy: PluginCapabilityBrowserCopy;
  query: string;
}) {
  const [access, setAccess] = useState<"read" | "write">("read");
  const [showAll, setShowAll] = useState(false);
  const description = copy.descriptions[entry.key];
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const matchingMethods = terms.length
    ? entry.methods.filter((method) =>
        terms.every((term) => normalizeSearchText(method.path).includes(term)),
      )
    : [];
  const methods = matchingMethods.length ? matchingMethods : entry.methods;
  const visibleMethods = showAll ? methods : methods.slice(0, 12);
  return (
    <section
      id="capability-details"
      aria-label={copy.detailsLabel}
      className="min-w-0 px-4 py-5 sm:px-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="!m-0 break-all !font-mono !text-xl">{entry.id}</h3>
        <span className="text-xs text-fg-subtle">
          {copy.familyNames[entry.family]} · v{entry.version}
        </span>
      </div>
      {entry.bundledOnly ? (
        <p className="!mb-0 !mt-2 text-sm font-medium">{copy.bundledOnly}</p>
      ) : null}
      <p className="!mt-3 text-sm leading-relaxed">{description.purpose}</p>
      <dl className="space-y-3 border-y border-border py-4 text-sm">
        <div>
          <dt className="font-medium">{copy.permissionLabel}</dt>
          <dd className="mt-1 break-words font-mono text-xs">
            {entry.authority === "settings-grant"
              ? "settingsAccess"
              : entry.permissions.join(" / ") || copy.permissionFree}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{copy.hostOwnsLabel}</dt>
          <dd className="mt-1 leading-relaxed text-fg-muted">
            {description.hostOwns}
          </dd>
        </div>
      </dl>
      <h4 className="!mb-2 !mt-5 text-sm font-medium">
        {copy.methodsLabel}{" "}
        <span className="text-fg-subtle">({methods.length})</span>
      </h4>
      {methods.length ? (
        <>
          <p className="!mt-0 text-xs text-fg-muted">{copy.methodsHint}</p>
          <div className="divide-y divide-border">
            {visibleMethods.map((method) => (
              <details key={method.path} className="min-w-0 py-2">
                <summary className="cursor-pointer break-words text-xs leading-relaxed focus-visible:outline-2">
                  <code>
                    {method.path.replace(
                      `ctx.${entry.family}.${entry.id}.`,
                      "",
                    )}
                  </code>
                </summary>
                <div className="min-w-0 pb-2 pt-3">
                  <code className="block break-all text-xs text-fg-muted">
                    {method.path}
                  </code>
                  {method.signatures.map((signature) => (
                    <pre
                      key={signature}
                      className="!my-2 max-w-full overflow-x-auto rounded border border-border p-3 !text-xs"
                    >
                      <code>{signature}</code>
                    </pre>
                  ))}
                  <a
                    href={sourceUrl(method.source, method.line)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs"
                  >
                    {copy.sourceLabel}
                    <ArrowSquareOut size={13} aria-hidden="true" />
                  </a>
                </div>
              </details>
            ))}
          </div>
          {methods.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className={`${buttonClass} mt-3`}
            >
              {showAll ? copy.showFewerMethods : copy.showAllMethods} (
              {methods.length})
            </button>
          ) : null}
        </>
      ) : (
        <p className="!mt-0 text-sm text-fg-muted">{copy.declarationOnly}</p>
      )}
      <h4 className="!mb-2 !mt-6 text-sm font-medium">{copy.manifestLabel}</h4>
      {entry.family === "domains" && entry.permissions.length ? (
        <label className="block">
          <span className="sr-only">{copy.accessLabel}</span>
          <select
            className={fieldClass}
            value={access}
            onChange={(event) =>
              setAccess(event.target.value as "read" | "write")
            }
          >
            <option value="read">{copy.readAccess}</option>
            <option value="write">{copy.writeAccess}</option>
          </select>
        </label>
      ) : null}
      <CodeBlock
        code={JSON.stringify(capabilityManifest(entry, access), null, 2)}
        language="json"
      />
      <p className="!mt-2 text-xs leading-relaxed text-fg-muted">
        {copy.manifestHint}
      </p>
      {entry.key === "domains:settings" || entry.key === "services:network" ? (
        <p className="!mt-2 text-xs leading-relaxed text-fg-muted">
          {entry.key === "domains:settings"
            ? copy.settingsHint
            : copy.networkHint}
        </p>
      ) : null}
    </section>
  );
}
