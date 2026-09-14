import { expect, test } from "bun:test";
import { LOCALES, localizePath } from "../src/lib/i18n";
import { CAPABILITIES } from "../src/lib/plugin-capabilities";

const paths = [
  "/docs",
  "/docs/install",
  "/docs/getting-started",
  "/docs/plugins",
  "/docs/plugins/develop",
  "/docs/plugins/capabilities",
  "/docs/plugins/api",
  "/docs/plugins/publishing",
];

test("prerendered docs expose localized links and the capability catalog before opening tools", async () => {
  for (const locale of LOCALES) {
    for (const path of paths) {
      const page = localizePath(path, locale);
      const html = await Bun.file(
        new URL(`../dist${page}/index.html`, import.meta.url),
      ).text();
      const links: string[] = [],
        ids = new Set<string>(),
        slots: string[] = [];
      await new HTMLRewriter()
        .on("article a[href]", {
          element(el) {
            links.push(el.getAttribute("href")!);
          },
        })
        .on("article [id]", {
          element(el) {
            ids.add(el.getAttribute("id")!);
          },
        })
        .on("article [data-doc-slot]", {
          element(el) {
            slots.push(el.getAttribute("data-doc-slot")!);
          },
        })
        .transform(new Response(html))
        .text();
      for (const href of links) {
        if (href.startsWith("#"))
          expect(
            ids.has(decodeURIComponent(href.slice(1))),
            `${page}: ${href}`,
          ).toBe(true);
        if (href.startsWith("/")) {
          expect(href, `${page}: language escape`).toBe(
            localizePath(href, locale),
          );
          const target = new URL(
            href,
            "https://readaware.app",
          ).pathname.replace(/\/$/, "");
          expect(
            await Bun.file(
              new URL(`../dist${target}/index.html`, import.meta.url),
            ).exists(),
            `${page}: ${href}`,
          ).toBe(true);
        }
      }
      expect(html).not.toMatch(
        /READAWARE_(CAPABILITY_BROWSER|PERMISSION_PREVIEW)_SLOT/,
      );
      if (path.endsWith("/capabilities")) {
        expect(slots).toEqual(["capability-browser"]);
        expect(
          links.some(
            (href) =>
              new URL(href, "https://readaware.app").searchParams.get(
                "view",
              ) === "manifest",
          ),
        ).toBe(true);
        expect(
          links.filter((href) =>
            new URL(href, "https://readaware.app").searchParams.has("cap"),
          ),
        ).toHaveLength(CAPABILITIES.length);
        expect(ids.has("capability-details")).toBe(false);
      }
    }
  }
});
