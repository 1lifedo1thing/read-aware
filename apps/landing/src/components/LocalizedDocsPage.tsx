import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DocsPageKey } from "../i18n";
import { docHeadings } from "../lib/doc-headings";
import { MarkdownDoc } from "./MarkdownDoc";

const SLOT_PATTERN =
  /(READAWARE_CAPABILITY_BROWSER_SLOT|READAWARE_PERMISSION_PREVIEW_SLOT)/g;

type DocsPageSlots = {
  capabilityBrowser?: ReactNode;
  permissionPreview?: ReactNode;
};

export function LocalizedDocsPage({
  page,
  slots,
}: {
  page: DocsPageKey;
  slots?: DocsPageSlots;
}) {
  const { t } = useTranslation("docs");
  const body = t(`pages.${page}.body`);

  const headings = docHeadings(body);
  const introEnd = Math.min(
    ...[body.search(/^## /m), body.search(SLOT_PATTERN)].filter(
      (index) => index >= 0,
    ),
  );
  const intro =
    Number.isFinite(introEnd) && introEnd > 0 ? body.slice(0, introEnd) : "";
  const content =
    Number.isFinite(introEnd) && introEnd > 0 ? body.slice(introEnd) : body;

  return (
    <article className={`doc-prose min-w-0 ${slots ? "" : "max-w-3xl"}`}>
      {intro && <MarkdownDoc>{intro}</MarkdownDoc>}
      {headings.length > 2 && (
        <nav
          aria-label={t("pageNavigation.title")}
          className="my-6 rounded-md border border-border px-4 py-3"
        >
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              {t("pageNavigation.title")}
            </summary>
            <ul className="!mt-3 grid gap-x-6 text-sm sm:grid-cols-2">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a href={`#${heading.id}`}>{heading.title}</a>
                </li>
              ))}
            </ul>
          </details>
        </nav>
      )}
      {content.split(SLOT_PATTERN).map((part, index) => {
        if (part === "READAWARE_CAPABILITY_BROWSER_SLOT") {
          return <Fragment key={part}>{slots?.capabilityBrowser}</Fragment>;
        }
        if (part === "READAWARE_PERMISSION_PREVIEW_SLOT") {
          return <Fragment key={part}>{slots?.permissionPreview}</Fragment>;
        }
        return (
          <Fragment key={`${index}:${part.slice(0, 20)}`}>
            <MarkdownDoc>{part}</MarkdownDoc>
          </Fragment>
        );
      })}
    </article>
  );
}
