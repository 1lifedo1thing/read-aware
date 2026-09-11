import { AppError } from "@read-aware/core";
import type { PluginBookContent } from "@read-aware/plugin-types";

const invalid = () => new AppError("plugin/invalid-input", "Content provider returned an invalid book");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function optionalText(value: unknown): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  throw invalid();
}

/** Only declared book data crosses into hashing, Foliate and derived text reads. */
export function normalizePluginBookContent(value: unknown): PluginBookContent {
  if (!record(value) || !Array.isArray(value.sections)) throw invalid();
  return {
    title: optionalText(value.title), author: optionalText(value.author), language: optionalText(value.language),
    sections: Array.from(value.sections, section => {
      if (!record(section) || typeof section.html !== "string") throw invalid();
      return { id: optionalText(section.id), title: optionalText(section.title), html: section.html };
    }),
  };
}
