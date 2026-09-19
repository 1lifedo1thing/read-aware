/**
 * Builds a foliate-compatible book object from plugin-provided content —
 * `view.open()` accepts any object honoring the section/toc contract, which
 * is exactly how virtual (plugin-served) books read like real ones: same
 * pagination, selection, CFI annotations, and progress model.
 */
import { AppError } from "@read-aware/core";
import { digestContent, virtualContentVersion } from "../../library/lib/content-version";
import { wrapSectionHtml } from "./section-document";
import type { FoliateBook } from './foliate-engine';

export type VirtualBookContent = {
  title?: string;
  author?: string;
  language?: string;
  sections: { id?: string; title?: string; html: string }[];
};

export async function buildVirtualFoliateBook(content: VirtualBookContent): Promise<FoliateBook> {
  const language = content.language ?? "und";
  const ids = content.sections.map((section, index) => section.id || `sec-${index}`);
  const docs = content.sections.map((section) =>
    wrapSectionHtml(section.html, section.title, language),
  );

  if (ids.length > 10000 || new Set(ids).size !== ids.length) {
    throw new AppError("library/content-unavailable", "Virtual section identities must be unique and bounded");
  }
  // Stable section identity plus exact wrapped source identity survives reorder.
  // Anonymous sections only survive an identical whole-book version.
  const version = await virtualContentVersion(content);
  const cfis: string[] = [];
  for (let index = 0; index < ids.length; index++) {
    const identity = content.sections[index]!.id ? `id:${ids[index]}` : `anonymous:${version}:${index}`;
    const token = `rav1-${await digestContent(identity)}-${await digestContent(docs[index]!)}`;
    cfis.push(`epubcfi(/6/${(index + 1) * 2}[${token}])`);
  }

  const sections = content.sections.map((_section, index) => {
    let url: string | null = null;
    return {
      id: ids[index],
      cfi: cfis[index],
      linear: "yes",
      size: docs[index].length,
      load: async () =>
        (url ??= URL.createObjectURL(new Blob([docs[index]], { type: "text/html" }))),
      unload: () => {
        if (url) {
          URL.revokeObjectURL(url);
          url = null;
        }
      },
      createDocument: async () =>
        new DOMParser().parseFromString(docs[index], "text/html"),
    };
  });

  return {
    metadata: {
      title: content.title ?? "",
      author: content.author ?? "",
      language,
    },
    sections,
    toc: content.sections.map((section, index) => ({
      label: section.title || `${index + 1}`,
      href: ids[index],
    })),
    resolveHref: (href: string) => {
      const id = href.split("#")[0];
      const index = ids.indexOf(id);
      if (index < 0) return undefined;
      const fragment = href.split("#")[1];
      return { index, anchor: (doc: Document) => fragment ? doc.getElementById(decodeURIComponent(fragment)) : null };
    },
    splitTOCHref: (href: string) => [href.split("#")[0], null],
    getTOCFragment: (doc: Document) => doc.documentElement,
  };
}
