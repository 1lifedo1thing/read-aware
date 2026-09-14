import { WarningCircle } from "@phosphor-icons/react";
import type { PluginPermission } from "@read-aware/core";
import {
  inspectManifest,
  KNOWN_PERMISSION_SET,
  type PluginPermissionPreviewCopy,
} from "../lib/plugin-manifest-preview";
export type { PluginPermissionPreviewCopy } from "../lib/plugin-manifest-preview";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { JsonCodeEditor } from "./JsonCodeEditor";

export function PluginPermissionPreview({
  copy,
  source,
  onChange,
}: {
  copy: PluginPermissionPreviewCopy;
  source: string;
  onChange: (source: string) => void;
}) {
  const parsed = useMemo(() => {
    try {
      return inspectManifest(JSON.parse(source), copy);
    } catch {
      return { error: copy.invalidJson } as const;
    }
  }, [copy, source]);

  return (
    <div
      data-doc-slot="permission-preview"
      className="mt-6 grid gap-5 border-y border-border-strong py-5 lg:grid-cols-2"
    >
      <label className="block min-w-0">
        <span className="text-sm font-medium text-fg">{copy.inputLabel}</span>
        <span className="mt-1 block text-sm text-fg-muted">
          {copy.inputHint}
        </span>
        <JsonCodeEditor
          label={copy.inputLabel}
          value={source}
          onChange={onChange}
        />
      </label>

      <section
        aria-live="polite"
        className="min-w-0 lg:border-l lg:border-border lg:pl-5"
      >
        <h3 className="!mt-0">{copy.previewLabel}</h3>
        <p className="!mt-2 text-xs text-fg-muted">{copy.catalogNotice}</p>
        {"error" in parsed ? (
          <p className="mt-3 flex gap-2 border-l-2 border-red-700 pl-3 text-sm text-red-800 dark:text-red-300">
            <WarningCircle
              aria-hidden="true"
              className="mt-1 shrink-0"
              size={18}
            />
            {parsed.error}
          </p>
        ) : (
          <>
            {(parsed.issues.length > 0 || parsed.warnings.length > 0) && (
              <div className="mt-3 border-l-2 border-border-strong pl-3 text-sm">
                <strong>{copy.issuesTitle}</strong>
                <ul className="!mt-1">
                  {[...parsed.issues, ...parsed.warnings].map(
                    (issue, index) => (
                      <li key={`${index}:${issue}`}>{issue}</li>
                    ),
                  )}
                </ul>
              </div>
            )}

            <PreviewGroup title={copy.permissionsTitle} empty={copy.none}>
              {parsed.permissions.map((permission) => (
                <li key={permission}>
                  <code>{permission}</code>
                  {KNOWN_PERMISSION_SET.has(permission) && (
                    <>
                      {" "}
                      —{" "}
                      {
                        copy.permissionDescriptions[
                          permission as PluginPermission
                        ]
                      }
                    </>
                  )}
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.settingsTitle} empty={copy.none}>
              {parsed.grants.map((grant) => (
                <li key={`${grant.operation}:${grant.path}`}>
                  {copy.operationLabels[grant.operation]}{" "}
                  <code>{grant.path}</code>
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.networkTitle} empty={copy.none}>
              {parsed.origins.map((origin) => (
                <li key={origin}>
                  <code>{origin}</code>
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.requirementsTitle} empty={copy.none}>
              {parsed.requirements.map((requirement) => (
                <li key={`${requirement.family}:${requirement.id}`}>
                  {copy.familyLabels[requirement.family]}{" "}
                  <code>{requirement.id}</code> <code>{requirement.range}</code>
                </li>
              ))}
            </PreviewGroup>

            <PreviewGroup title={copy.declarationsTitle} empty={copy.none}>
              <li>
                {copy.schemaVersion}:{" "}
                <code>{String(parsed.declarations.schemaVersion ?? "—")}</code>
              </li>
              {parsed.declarations.schedules > 0 && (
                <li>{copy.schedules(parsed.declarations.schedules)}</li>
              )}
              {parsed.declarations.themes > 0 && (
                <li>{copy.themes(parsed.declarations.themes)}</li>
              )}
              {parsed.declarations.fonts > 0 && (
                <li>{copy.fonts(parsed.declarations.fonts)}</li>
              )}
            </PreviewGroup>

            {parsed.permissions.length === 0 && parsed.grants.length === 0 && (
              <p className="mt-4 border-l-2 border-border-strong pl-3 text-sm text-fg-muted">
                {copy.noAuthority}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function PreviewGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasItems = Array.isArray(items) ? items.length > 0 : Boolean(items);
  return (
    <div className="mt-5">
      <strong className="text-sm">{title}</strong>
      {hasItems ? (
        <ul className="!mt-1 text-sm">{items}</ul>
      ) : (
        <p className="!mt-1 text-sm text-fg-muted">{empty}</p>
      )}
    </div>
  );
}
