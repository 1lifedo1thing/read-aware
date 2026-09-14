import { actorFromEvent, causalActor, ObservationCauses, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
/**
 * Declarative plugin settings (manifest.settings): the app renders the form,
 * values persist as ONE object under the plugin's storage key `settings`
 * (plugins read `ctx.services.storage.get("settings")`). The Plugins panel opens this
 * as a Dialog via the standard view pipeline.
 */
import { pluginDataRevision, withPluginDataWrites } from "../../../platform/plugin-data-access";
import { emitAppEvent } from "../../../platform/app-events";
import { localKV, onLocalKVChange } from "../../../platform/local-store";
import {
  deletePluginSecret,
  getPluginSecret,
  setPluginSecret,
} from "../../../platform/secret-store";
import { getSettingsOptionsProvider } from "../state/plugin-store";
import type {
  InstalledPlugin,
  PluginFormField,
  PluginFormValues,
  PluginFormView,
  PluginManifest,
} from "./plugin-types";

export function pluginSettingsKey(pluginId: string): string {
  return `read-aware-plugin.${pluginId}.settings`;
}

// Invalidate from the actual overlay, including failed-write rollback. Defer
// until all KV observers have run so Worker mirrors precede provider callbacks.
const pendingInvalidations = new Map<string, ObservationCauses>();
onLocalKVChange((key, _value, origin) => {
  const prefix = "read-aware-plugin.";
  const suffix = ".settings";
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
  const pluginId = key.slice(prefix.length, -suffix.length);
  const pending = pendingInvalidations.get(pluginId);
  if (pending) { pending.add(stampEventCause({}, origin)); return; }
  const causes = new ObservationCauses(origin);
  pendingInvalidations.set(pluginId, causes);
  queueMicrotask(() => {
    pendingInvalidations.delete(pluginId);
    emitAppEvent("plugin-storage-changed", { pluginId }, actorFromEvent(causes.take({})));
  });
});

export function readPluginSettingsValues(pluginId: string): PluginFormValues {
  try {
    const raw = localKV.getItem(pluginSettingsKey(pluginId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as PluginFormValues) : {};
  } catch {
    return {};
  }
}

/** Build the settings form for a manifest, prefilled with stored values. */
export function buildPluginSettingsView(
  manifest: PluginManifest,
): PluginFormView | null {
  const fields = manifest.settings;
  if (!fields || fields.length === 0) return null;
  const stored = readPluginSettingsValues(manifest.id);
  const expected = new Map([[manifest.id, pluginDataRevision(manifest.id)]]);
  return {
    kind: "form",
    title: manifest.name,
    submitMode: "change",
    fields: fields.map((field) => {
      // A secret field carries no value — it lives in the secret store, not
      // in the settings object, and is never echoed back.
      if (field.kind === "secret") return { ...field };
      const value = stored[field.id];
      if (field.kind === "toggle" || field.kind === "checkbox") {
        return { ...field, value: typeof value === "boolean" ? value : field.value };
      }
      if (field.kind === "number") {
        return { ...field, value: typeof value === "number" ? value : field.value };
      }
      return { ...field, value: typeof value === "string" ? value : field.value };
    }),
    onSubmit: (values) => {
      const origin = causalActor("user");
      return withPluginDataWrites([manifest.id],
        () => localKV.setItemAsync(pluginSettingsKey(manifest.id), JSON.stringify(values), origin), expected);
    },
    // Dynamic selects resolve through the source the plugin bound at
    // activate() (ctx.contributions.settingsOptions.register); an unbound field resolves
    // empty and renders as free text input.
    resolveOptions: (fieldId, values) =>
      getSettingsOptionsProvider(manifest.id, fieldId)?.resolve(values) ?? [],
    // Secret fields write straight to the plugin's encrypted secret
    // namespace — the same store ctx.secrets reads on the plugin side.
    secrets: {
      has: async (id) => {
        const value = await getPluginSecret(manifest.id, id);
        return value != null && value !== "";
      },
      set: (id, value) => {
        const origin = causalActor("user");
        return withPluginDataWrites([manifest.id], () => setPluginSecret(manifest.id, id, value, origin), expected);
      },
      remove: (id) => {
        const origin = causalActor("user");
        return withPluginDataWrites([manifest.id], () => deletePluginSecret(manifest.id, id, origin), expected);
      },
    },
  };
}

/** Declarative form writes return their exact durability receipt. */
export function writePluginSettingsValues(
  pluginId: string,
  values: PluginFormValues,
  origin: DomainActor = "user",
): Promise<void> {
  origin = causalActor(origin);
  return withPluginDataWrites([pluginId], () => localKV.setItemAsync(pluginSettingsKey(pluginId), JSON.stringify(values), origin));
}

export type AgentPluginSettings = {
  pluginId: string;
  pluginName: string;
  fields: PluginFormField[];
};

/**
 * The declared settings the agent may see: enabled plugins only, minus
 * password fields and anything the author marked `agentHidden`. Disabled
 * plugins keep their stored values but drop out of the catalog, mirroring
 * how their other contributions disappear.
 */
export function agentVisiblePluginSettings(
  plugins: InstalledPlugin[],
): AgentPluginSettings[] {
  return plugins
    .filter((plugin) => plugin.enabled && plugin.manifest.settings?.length)
    .map((plugin) => ({
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
      fields: (plugin.manifest.settings ?? []).filter(
        (field) =>
          !field.agentHidden &&
          field.kind !== "secret" &&
          !(field.kind === "text" && field.inputMode === "password"),
      ),
    }))
    .filter((plugin) => plugin.fields.length > 0);
}
