import type { InteractionFormField, InteractionFormValues } from "@read-aware/core";

/** Display the submitted choices using the labels the reader actually saw. */
export function formatInteractionFormSummary(
  fields: readonly InteractionFormField[],
  values: InteractionFormValues,
  checkboxLabels: { checked: string; unchecked: string },
): string {
  return fields.map(field => {
    const value = values[field.id];
    const label = value == null ? "-"
      : field.kind === "select" ? field.options.find(option => option.value === value)?.label ?? String(value)
      : field.kind === "checkbox" && typeof value === "boolean" ? (value ? checkboxLabels.checked : checkboxLabels.unchecked)
      : String(value);
    return `${field.label}: ${label}`;
  }).join("\n");
}
