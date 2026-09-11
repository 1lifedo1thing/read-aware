import { AppError } from "@read-aware/core";
import type { PluginText, PluginVoice } from "@read-aware/plugin-types";

const invalid = () => new AppError("plugin/invalid-input", "Voice provider returned an invalid voice list");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function label(value: unknown): PluginText {
  if (typeof value === "string") return value;
  if (!record(value) || typeof value.default !== "string") throw invalid();
  if (value.translations === undefined) return { default: value.default };
  if (!record(value.translations) || Object.values(value.translations).some(text => typeof text !== "string")) throw invalid();
  return { default: value.default, translations: { ...value.translations } as Record<string, string> };
}

/** Copy only declared data; callback-bearing extensions never enter reader state. */
export function normalizePluginVoices(value: unknown): PluginVoice[] {
  if (!Array.isArray(value)) throw invalid();
  const ids = new Set<string>();
  return Array.from(value, voice => {
    if (!record(voice) || typeof voice.id !== "string" || !voice.id.trim() || ids.has(voice.id)) throw invalid();
    ids.add(voice.id);
    if (voice.languages !== undefined && (!Array.isArray(voice.languages) || [...voice.languages].some(language => typeof language !== "string"))) throw invalid();
    return { id: voice.id, label: label(voice.label), ...(voice.languages === undefined ? {} : { languages: [...voice.languages as string[]] }) };
  });
}
