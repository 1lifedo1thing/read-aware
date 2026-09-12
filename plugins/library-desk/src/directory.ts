import type { PluginContext, PluginListView, PluginViewResult } from "@read-aware/plugin-types";
import { inspectImportResource } from "./import-book";

const translations: Record<string, [string, string, string, string, string]> = {
  en: ["Browse folder", "Parent folder", "Next page", "Refresh", "Some links, special files or names were omitted"],
  "zh-CN": ["浏览文件夹", "上级文件夹", "下一页", "刷新", "部分链接、特殊文件或文件名已略过"],
  "zh-TW": ["瀏覽資料夾", "上層資料夾", "下一頁", "重新整理", "部分連結、特殊檔案或檔名已略過"],
  ja: ["フォルダーを参照", "親フォルダー", "次のページ", "更新", "リンク・特殊ファイル・一部の名前を省略しました"],
  ko: ["폴더 찾아보기", "상위 폴더", "다음 페이지", "새로 고침", "일부 링크, 특수 파일 또는 이름을 생략했습니다"],
  de: ["Ordner durchsuchen", "Übergeordneter Ordner", "Nächste Seite", "Aktualisieren", "Einige Links, spezielle Dateien oder Namen wurden ausgelassen"],
  fr: ["Parcourir un dossier", "Dossier parent", "Page suivante", "Actualiser", "Certains liens, fichiers spéciaux ou noms ont été omis"],
  es: ["Explorar carpeta", "Carpeta superior", "Página siguiente", "Actualizar", "Se omitieron algunos enlaces, archivos especiales o nombres"],
};
export const directoryStrings = (locale: string) => translations[locale] ?? translations[locale.split("-")[0]] ?? translations.en;

export async function browseDirectory(ctx: PluginContext): Promise<PluginViewResult> {
  const resources = ctx.services.resources, t = directoryStrings(ctx.locale);
  const { directory } = await resources.pickDirectory();
  if (!directory) return null;
  // Keep one root view in the navigation stack for the grant's lifetime. Child
  // views are ordinary navigation; only closing this root releases the grant.
  const page = async (relativePath = "", cursor?: string): Promise<PluginListView> => {
    const result = await resources.listDirectory(directory.id, { relativePath, cursor, limit: 50 });
    return { kind: "list", title: relativePath || directory.name, searchable: true,
      items: [
        ...(result.omittedCount ? [{ id: "omitted", title: `${t[4]} (${result.omittedCount})`, icon: "info" }] : []),
        ...result.entries.map(entry => ({ id: entry.relativePath, title: entry.name, icon: entry.kind === "directory" ? "folder" : "file-text",
          subtitle: entry.size === null ? undefined : `${entry.size} B`,
          onSelect: async (): Promise<PluginViewResult> => entry.kind === "directory"
            ? { view: await page(entry.relativePath) }
            : inspectImportResource(ctx, await resources.openDirectoryFile(directory.id, entry.relativePath)),
        })),
      ], actions: [
        { id: "refresh", label: t[3], icon: "arrows-clockwise", run: async () => ({ view: await page(relativePath) }) },
        ...(relativePath ? [{ id: "parent", label: t[1], icon: "arrow-up", run: async () => ({ view: await page(relativePath.split("/").slice(0, -1).join("/")) }) }] : []),
        ...(result.nextCursor ? [{ id: "next", label: t[2], icon: "arrow-right", run: async () => ({ view: await page(relativePath, result.nextCursor!) }) }] : []),
      ],
    };
  };
  try { return { view: { ...await page(), onClose: () => resources.releaseDirectory(directory.id) } }; }
  catch (error) { await resources.releaseDirectory(directory.id); throw error; }
}
