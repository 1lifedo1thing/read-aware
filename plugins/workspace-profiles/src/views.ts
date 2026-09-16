import type {
  PluginAction,
  PluginContext,
  PluginDetailView,
  PluginDocument,
  PluginFormView,
  PluginListView,
  PluginView,
} from "@read-aware/plugin-types";
import {
  applyProfile,
  deleteProfile,
  describeProfile,
  listProfiles,
  parseProfile,
  profileCollection,
  profileName,
  renameProfile,
  saveProfile,
  undoProfile,
  type ProfileDescription,
} from "./profiles";
import { copy } from "./strings";

/** A host-localized settings reading, or the raw value when the catalog has no label for it. */
function valueText(ctx: PluginContext, entry: ProfileDescription["entries"][number]): string {
  const t = copy(ctx.locale);
  if (entry.value === null) return t.appDefault;
  if (typeof entry.value === "boolean") return entry.value ? t.on : t.off;
  return entry.valueLabel ?? String(entry.value);
}

function message(ctx: PluginContext, text: string): PluginDetailView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "back", label: t.back, icon: "cards", priority: "primary", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) },
  ] };
}

function saveForm(ctx: PluginContext): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: t.save, submitLabel: t.save,
    fields: [{ kind: "text", id: "name", label: t.name, value: "", placeholder: t.namePlaceholder }],
    onSubmit: async values => {
      let name: string;
      try { name = profileName(values.name); } catch { return { fieldErrors: { name: t.invalid } }; }
      const result = await saveProfile(ctx, name);
      if (result.status !== "saved") return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profileView(ctx, result.id), navigation: "reset", toast: t.saved };
    } };
}

function renameForm(ctx: PluginContext, doc: PluginDocument, currentName: string): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: t.rename, submitLabel: t.rename,
    fields: [{ kind: "text", id: "name", label: t.name, value: currentName }],
    onSubmit: async values => {
      let name: string;
      try { name = profileName(values.name); } catch { return { fieldErrors: { name: t.invalid } }; }
      const result = await renameProfile(ctx, doc.id, name, doc.revision);
      if (result.status !== "renamed") return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profileView(ctx, doc.id), navigation: "replace", toast: t.renamed };
    } };
}

function deleteForm(ctx: PluginContext, doc: PluginDocument, name: string): PluginFormView {
  const t = copy(ctx.locale);
  return { kind: "form", title: name, submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirmDelete, value: false }],
    onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: t.confirmRequired } };
      const result = await deleteProfile(ctx, doc.id, doc.revision);
      if (result.status !== "deleted") return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: await profilesView(ctx), navigation: "reset", toast: t.deleted };
    } };
}

/** The receipt after applying: the settings that changed, with one-step undo. */
function appliedView(ctx: PluginContext, id: string, name: string, transactionId: string): PluginDetailView {
  const t = copy(ctx.locale);
  return { kind: "detail", title: name, content: [{ kind: "alert", variant: "success", message: t.applied }], actions: [
    { id: "undo", label: t.undo, icon: "arrow-counter-clockwise", priority: "primary", run: async () => {
      await undoProfile(ctx, transactionId);
      return { view: await profilesView(ctx), navigation: "reset", toast: t.undone };
    } },
    { id: "back", label: t.back, icon: "cards", run: async () => ({ view: await profilesView(ctx), navigation: "reset" }) },
    { id: "profile", label: name, icon: "cards", priority: "secondary", run: async () => ({ view: await profileView(ctx, id), navigation: "reset" }) },
  ] };
}

export async function profileView(ctx: PluginContext, id: string): Promise<PluginView> {
  const t = copy(ctx.locale);
  const doc = await profileCollection(ctx).get(id);
  if (!doc) return message(ctx, t.missing);
  const profile = parseProfile(doc.data);
  const name = profile?.name ?? t.invalidProfile;
  const description = profile ? await describeProfile(ctx, profile) : null;
  const actions: PluginAction[] = [];
  if (profile) {
    actions.push({ id: "apply", label: t.apply, icon: "check", variant: "solid", priority: "primary", run: async () => {
      const result = await applyProfile(ctx, id, doc.revision);
      if (result.status !== "applied") return { view: message(ctx, t.conflict), navigation: "replace" };
      return { view: appliedView(ctx, id, profile.name, result.transactionId), navigation: "replace" };
    } });
    actions.push({ id: "rename", label: t.rename, icon: "pencil-simple", priority: "secondary", run: () => ({ view: renameForm(ctx, doc, profile.name) }) });
  }
  actions.push(
    { id: "delete", label: t.remove, icon: "trash", variant: "danger", priority: "secondary", run: () => ({ view: deleteForm(ctx, doc, name) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await profileView(ctx, id), navigation: "replace" }) },
  );
  return { kind: "detail", title: name,
    metadata: [{ kind: "label", label: t.savedAt, value: new Date(doc.updatedAt).toLocaleString(ctx.locale), icon: "clock" }],
    content: description
      ? [{ kind: "keyValue", rows: description.entries.map(entry => ({ label: entry.label, value: valueText(ctx, entry) })) }]
      : [{ kind: "alert", variant: "destructive", message: t.invalidProfile }],
    actions };
}

export async function profilesView(ctx: PluginContext, cursors: (string | undefined)[] = [undefined]): Promise<PluginView> {
  const t = copy(ctx.locale);
  const page = await listProfiles(ctx, cursors[cursors.length - 1]);
  if (page.status === "stale-cursor") return message(ctx, t.stalePage);
  const go = async (next: (string | undefined)[]) => ({ view: await profilesView(ctx, next), navigation: "replace" as const });
  const items = await Promise.all(page.items.map(async doc => {
    const profile = parseProfile(doc.data);
    const description = profile ? await describeProfile(ctx, profile) : null;
    return { id: doc.id, title: profile?.name ?? t.invalidProfile, icon: "cards",
      subtitle: description?.summary.map(entry => valueText(ctx, entry)).join(" · "),
      timestamp: doc.updatedAt, onSelect: async () => ({ view: await profileView(ctx, doc.id) }) };
  }));
  return { kind: "list", title: t.title, emptyText: t.empty, items, actions: [
    { id: "save", label: t.save, icon: "plus", variant: "solid", priority: "primary", run: () => ({ view: saveForm(ctx) }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", priority: "secondary", run: async () => ({ view: await profilesView(ctx), navigation: "replace" }) },
  ], pagination: { page: cursors.length,
    ...(cursors.length > 1 ? { onPrevious: () => go(cursors.slice(0, -1)) } : {}),
    ...(page.nextCursor ? { onNext: () => go([...cursors, page.nextCursor!]) } : {}),
  } } satisfies PluginListView;
}
