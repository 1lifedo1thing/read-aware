import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Books,
  Brain,
  BracketsCurly,
  CaretDown,
  Check,
  Code,
  GearSix,
  Lightning,
  LinkSimple,
  MagnifyingGlass,
  PlugsConnected,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { DocsResource } from "../i18n";
import {
  useCapabilityDetail,
  useCapabilityExplorer,
  useCapabilityLink,
  useExplorerSearch,
  useExplorerReturnFocus,
} from "../hooks/useCapabilityExplorer";
import {
  API_METHOD_COUNT,
  CAPABILITIES,
  CAPABILITY_AUTHORITIES,
  CAPABILITY_FAMILIES,
  CAPABILITY_TOPICS,
  capabilityManifest,
  filterCapabilities,
  groupCapabilityMethods,
  type CapabilityAuthority,
  type CapabilityDescriptions,
  type CapabilityEntry,
  type CapabilityFamily,
} from "../lib/plugin-capabilities";
import { CodeBlock } from "./CodeBlock";

export type PluginCapabilityBrowserCopy = Omit<
  DocsResource["capabilityBrowser"],
  "descriptions" | "result" | "catalogSummary"
> & {
  explorer: DocsResource["explorer"];
  descriptions: CapabilityDescriptions;
  result: (count: number) => string;
  catalogSummary: (capabilities: number, methods: number) => string;
};
const TOPIC_ICONS = {
  reading: BookOpen,
  library: Books,
  intelligence: Brain,
  automation: Lightning,
  interface: GearSix,
  integration: PlugsConnected,
};

export function PluginCapabilityBrowser({
  copy,
}: {
  copy: PluginCapabilityBrowserCopy;
}) {
  const { search, update, reset, pathname } = useCapabilityExplorer();
  const inputRef = useExplorerSearch();
  useExplorerReturnFocus(search.cap);
  const results = filterCapabilities(
    search,
    copy.descriptions,
    copy.topicNames,
  );
  const selected = search.cap
    ? CAPABILITIES.find((entry) => entry.key === search.cap)
    : undefined;
  const extraFilters =
    Number(Boolean(search.family)) + Number(Boolean(search.authority));

  return (
    <section data-doc-slot="capability-browser" aria-label={copy.browseLabel}>
      {selected ? (
        <CapabilityDetail
          key={selected.key}
          entry={selected}
          copy={copy}
          query={search.q ?? ""}
          back={() => update({ cap: undefined }, false)}
        />
      ) : (
        <>
          <div className="explorer-search" role="search">
            <MagnifyingGlass size={21} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              aria-label={copy.searchLabel}
              placeholder={copy.explorer.searchPlaceholder}
              value={search.q ?? ""}
              onChange={(event) =>
                update({ q: event.target.value || undefined, cap: undefined })
              }
            />
            {search.q ? (
              <button
                type="button"
                aria-label={copy.explorer.clearSearch}
                onClick={() => {
                  update({ q: undefined });
                  inputRef.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            ) : (
              <kbd aria-hidden="true">/</kbd>
            )}
          </div>
          <div className="explorer-topic-bar">
            <div
              className="explorer-topics"
              role="group"
              aria-label={copy.topicLabel}
            >
              <button
                type="button"
                aria-pressed={!search.topic}
                onClick={() => update({ topic: undefined })}
              >
                {copy.explorer.all}
              </button>
              {CAPABILITY_TOPICS.map((topic) => (
                <button
                  type="button"
                  key={topic}
                  aria-pressed={search.topic === topic}
                  onClick={() => update({ topic })}
                >
                  {copy.explorer.topics[topic]}
                </button>
              ))}
            </div>
            <details className="explorer-filters">
              <summary>
                <SlidersHorizontal size={16} aria-hidden="true" />
                {copy.explorer.filters}
                {extraFilters ? <span>{extraFilters}</span> : null}
              </summary>
              <div className="explorer-filter-fields">
                <label>
                  {copy.familyLabel}
                  <select
                    value={search.family ?? ""}
                    onChange={(event) =>
                      update({
                        family:
                          (event.target.value as CapabilityFamily) || undefined,
                      })
                    }
                  >
                    <option value="">{copy.allFamilies}</option>
                    {CAPABILITY_FAMILIES.map((family) => (
                      <option key={family} value={family}>
                        {copy.familyNames[family]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.authorityLabel}
                  <select
                    value={search.authority ?? ""}
                    onChange={(event) =>
                      update({
                        authority:
                          (event.target.value as CapabilityAuthority) ||
                          undefined,
                      })
                    }
                  >
                    <option value="">{copy.allAuthorities}</option>
                    {CAPABILITY_AUTHORITIES.map((authority) => (
                      <option key={authority} value={authority}>
                        {copy.authorityNames[authority]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </div>
          <div className="explorer-result-bar">
            <p role="status" aria-live="polite">
              {search.q || search.topic || extraFilters
                ? copy.result(results.length)
                : copy.catalogSummary(CAPABILITIES.length, API_METHOD_COUNT)}
            </p>
            {search.q || search.topic || extraFilters ? (
              <button
                type="button"
                className="explorer-text-button"
                onClick={reset}
              >
                {copy.clearFilters}
                <X size={13} aria-hidden="true" />
              </button>
            ) : (
              <span>{copy.catalogLabel}</span>
            )}
          </div>
          {results.length ? (
            <ul className="capability-grid">
              {results.map((entry) => {
                const Icon = TOPIC_ICONS[entry.topics[0]];
                return (
                  <li key={entry.key}>
                    <Link
                      to={pathname as never}
                      search={{ ...search, cap: entry.key } as never}
                      resetScroll={false}
                      className="capability-card"
                      data-capability={entry.key}
                    >
                      <div className="capability-card-top">
                        <Icon size={21} weight="regular" aria-hidden="true" />
                        <span>{copy.familyNames[entry.family]}</span>
                        <ArrowUpRight
                          size={16}
                          className="capability-card-arrow"
                          aria-hidden="true"
                        />
                      </div>
                      <h2>{entry.id}</h2>
                      <p>{copy.descriptions[entry.key].purpose}</p>
                      <div className="capability-card-bottom">
                        <span>
                          {entry.methods.length ? (
                            <>
                              <Code size={14} aria-hidden="true" />
                              {entry.methods.length} API
                            </>
                          ) : (
                            <>
                              <BracketsCurly size={14} aria-hidden="true" />
                              {copy.explorer.declaration}
                            </>
                          )}
                        </span>
                        <span>v{entry.version}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="explorer-empty">
              <MagnifyingGlass size={30} aria-hidden="true" />
              <p>{copy.noResults}</p>
              <button type="button" className="explorer-button" onClick={reset}>
                {copy.clearFilters}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CapabilityDetail({
  entry,
  copy,
  query,
  back,
}: {
  entry: CapabilityEntry;
  copy: PluginCapabilityBrowserCopy;
  query: string;
  back: () => void;
}) {
  const {
    access,
    setAccess,
    methodQuery,
    setMethodQuery,
    methods,
    headingRef,
    section,
    setSection,
  } = useCapabilityDetail(entry, query);
  const { status, copyLink } = useCapabilityLink(entry.key);
  const description = copy.descriptions[entry.key];
  const groups = groupCapabilityMethods(entry, methods);
  return (
    <div className="capability-detail" id="capability-details">
      <div className="capability-detail-nav">
        <button type="button" className="explorer-text-button" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
          {copy.explorer.back}
        </button>
        <button
          type="button"
          className="explorer-text-button"
          onClick={copyLink}
        >
          {status === "copied" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <LinkSimple size={15} aria-hidden="true" />
          )}
          {status === "copied" ? copy.copiedLabel : copy.shareLabel}
        </button>
      </div>
      {status === "failed" ? <p role="alert">{copy.copyFailed}</p> : null}
      <header className="capability-detail-heading">
        <div className="capability-detail-meta">
          {copy.familyNames[entry.family]}
          <span>v{entry.version}</span>
          {entry.bundledOnly ? <span>{copy.bundledOnly}</span> : null}
        </div>
        <h2 ref={headingRef} tabIndex={-1}>
          {entry.id}
        </h2>
        <p>{description.purpose}</p>
      </header>
      <div
        className="detail-mobile-tabs"
        role="group"
        aria-label={copy.explorer.detailTabs}
      >
        <button
          type="button"
          aria-pressed={section === "methods"}
          aria-controls="capability-methods"
          onClick={() => setSection("methods")}
        >
          {copy.methodsLabel}
          <span className="detail-method-count">{entry.methods.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={section === "configuration"}
          aria-controls="capability-configuration"
          onClick={() => setSection("configuration")}
        >
          {copy.explorer.configuration}
        </button>
      </div>
      <div className="capability-detail-columns">
        <section
          className="capability-methods"
          id="capability-methods"
          data-active={section === "methods"}
          aria-label={copy.methodsLabel}
        >
          <h3>
            {copy.methodsLabel}
            <span>{entry.methods.length}</span>
          </h3>
          {entry.methods.length ? (
            <>
              <label className="method-search">
                <MagnifyingGlass size={16} aria-hidden="true" />
                <input
                  type="search"
                  aria-label={copy.explorer.methodSearch}
                  placeholder={copy.explorer.methodSearch}
                  value={methodQuery}
                  onChange={(event) => setMethodQuery(event.target.value)}
                />
                {methodQuery ? (
                  <button
                    type="button"
                    aria-label={copy.explorer.clearSearch}
                    onClick={() => setMethodQuery("")}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </label>
              {groups.length ? (
                groups.map((group) => (
                  <div className="method-group" key={group.name}>
                    {group.name ? <h4>{group.name}</h4> : null}
                    {group.methods.map((method) => (
                      <details
                        className="method-row"
                        key={method.path}
                        open={methods.length === 1 && Boolean(methodQuery)}
                      >
                        <summary>
                          <span>
                            {method.name}
                            <span className="method-parens">(…)</span>
                          </span>
                          <CaretDown size={15} aria-hidden="true" />
                        </summary>
                        <div className="method-expanded">
                          <code className="method-full-path">
                            {method.path}
                          </code>
                          {method.signatures.map((signature) => (
                            <CodeBlock
                              key={signature}
                              language="typescript"
                              code={signature}
                            />
                          ))}
                          <a
                            href={`https://github.com/ahpxex/read-aware/blob/main/${method.source}#L${method.line}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {copy.sourceLabel}
                            <ArrowUpRight size={13} aria-hidden="true" />
                          </a>
                        </div>
                      </details>
                    ))}
                  </div>
                ))
              ) : (
                <div className="method-empty">
                  <p>{copy.explorer.noMethods}</p>
                  <button
                    type="button"
                    className="explorer-text-button"
                    onClick={() => setMethodQuery("")}
                  >
                    {copy.explorer.clearSearch}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="declaration-note">{copy.declarationOnly}</p>
          )}
        </section>
        <aside
          className="capability-setup"
          id="capability-configuration"
          data-active={section === "configuration"}
          aria-label={copy.explorer.setupTitle}
        >
          <h3>{copy.explorer.setupTitle}</h3>
          {entry.family === "domains" && entry.permissions.length ? (
            <div
              className="access-switch"
              role="group"
              aria-label={copy.accessLabel}
            >
              <button
                type="button"
                aria-pressed={access === "read"}
                onClick={() => setAccess("read")}
              >
                {copy.explorer.read}
              </button>
              <button
                type="button"
                aria-pressed={access === "write"}
                onClick={() => setAccess("write")}
              >
                {copy.explorer.write}
              </button>
            </div>
          ) : null}
          <CodeBlock
            code={JSON.stringify(capabilityManifest(entry, access), null, 2)}
            language="json"
          />
          <p className="setup-hint">{copy.manifestHint}</p>
          {entry.key === "domains:settings" ||
          entry.key === "services:network" ? (
            <p className="setup-hint">
              {entry.key === "domains:settings"
                ? copy.settingsHint
                : copy.networkHint}
            </p>
          ) : null}
          <details className="capability-scope">
            <summary>
              {copy.explorer.scope}
              <CaretDown size={14} aria-hidden="true" />
            </summary>
            <dl>
              <dt>{copy.permissionLabel}</dt>
              <dd className="scope-permissions">
                {entry.authority === "settings-grant"
                  ? "settingsAccess"
                  : entry.permissions.join(" / ") || copy.permissionFree}
              </dd>
              <dt>{copy.hostOwnsLabel}</dt>
              <dd>{description.hostOwns}</dd>
            </dl>
          </details>
        </aside>
      </div>
    </div>
  );
}
