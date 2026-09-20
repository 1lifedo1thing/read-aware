import { TOOL_FAMILIES } from "../tools/tool-families";

/** Keeps existing per-operation port fixtures while exercising the NEW public
 * tool schema. Used by scripted tests only, never by the production dispatcher. */
export function operationCall(name: string, args: Record<string, unknown> = {}) {
  for (const family of TOOL_FAMILIES) {
    const entry = Object.entries(family.members).find(([, member]) => member === name);
    if (entry) return { name: family.name, arguments: { request: { operation: entry[0], ...args } } };
  }
  if (name === "get_navigation_toc") return { name: "get_toc", arguments: { ...args, view: "navigation" } };
  if (name === "edit_annotation") return { name: "apply_annotation_changes", arguments: { changes: [
    { annotationId: args.annotationId, expectedRevision: args.expectedRevision,
      ...(args.body !== undefined ? { op: "updateNote", body: args.body } : { op: "recolorHighlight", color: args.color }) },
  ] } };
  return { name, arguments: args };
}
