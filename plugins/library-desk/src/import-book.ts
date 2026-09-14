import type { PluginContext, PluginViewResult } from "@read-aware/plugin-types";
import { assetStrings } from "./assets-strings";
import { importTask } from "./import-task";

export async function importBook(ctx: PluginContext): Promise<PluginViewResult> {
  const library = ctx.domains.library!, resources = ctx.services.resources;
  const formats = await library.queries.books.listFormats();
  const picked = await resources.pick({ multiple: false, extensions: formats.flatMap(format => format.extensions) });
  const resource = picked.resources[0];
  if (!resource) return null;
  return inspectImportResource(ctx, resource);
}

export async function inspectImportResource(ctx: PluginContext, resource: Awaited<ReturnType<PluginContext["services"]["resources"]["stat"]>>): Promise<PluginViewResult> {
  const library = ctx.domains.library!, resources = ctx.services.resources, t = assetStrings(ctx.locale);
  let inspection, transferred = false;
  try { inspection = await library.queries.books.inspectResource(resource.id); }
  catch (error) { await resources.release(resource.id); throw error; }
  return { view: { kind: "detail", title: t.import, content: [
    { kind: "keyValue", rows: [
      { label: t.file, value: resource.name }, { label: t.size, value: String(resource.size) },
      { label: t.format, value: inspection.formatHint ?? t.unknown },
      { label: t.inspection, value: t[inspection.status] },
      { label: t.sections, value: inspection.sectionCount === null ? t.unknown : String(inspection.sectionCount) },
    ] },
    ...(inspection.errorCode ? [{ kind: "error" as const, code: inspection.errorCode }] : []),
  ], actions: inspection.status === "parsed" ? [{ id: "import", label: t.confirmImport, icon: "plus", run: async () => {
    const task = await library.commands!.books.startImport({ kind: "resource", resourceId: resource.id });
    transferred = true;
    return { view: importTask(ctx, task, resource.id), navigation: "replace" };
  } }] : [], onClose: () => transferred ? undefined : resources.release(resource.id) } };
}
