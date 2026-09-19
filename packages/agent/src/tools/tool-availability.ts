import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError } from "@read-aware/core";
import type { ReaderToolContext, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";

export type ToolAvailability = { state: "available" | "unavailable" | "unknown"; reason?: string };
const metadata = new WeakMap<AgentTool, ToolAvailability>();
export const toolAvailability = (tool: AgentTool): ToolAvailability | undefined => metadata.get(tool);
const readerTools = new Set([
  "navigate_reading", "focus_reader", "set_reading_selection", "set_reader_controls",
  "set_reader_panel", "set_reader_panel_width", "configure_reading_mode", "control_read_aloud",
  "show_book_reference", "show_book_image", "explain_selection", "define_term", "translate_selection", "summarize_chapter",
]);
const selectionTools = new Set(["explain_selection", "define_term", "translate_selection"]);
const available: ToolAvailability = { state: "available" };
const unavailable = (reason: string): ToolAvailability => ({ state: "unavailable", reason });

function readContext(deps: RuntimeDeps): ReaderToolContext | null | undefined {
  if (!deps.reader.toolContext) return undefined;
  try { return deps.reader.toolContext(); } catch { return null; }
}
function check(name: string, scope: ThreadScope, deps: RuntimeDeps, context: ReturnType<typeof readContext>, turnState?: AgentTurnState): ToolAvailability {
  if (name === "web_search" || name === "web_fetch") return deps.web?.configured() ? available : unavailable("search-not-configured; enable Search in Settings → AI");
  if (name === "read_book_image") return !deps.bookText.readImageInput ? unavailable("image-input-unavailable")
    : turnState?.modelSupportsImages === false ? unavailable("model-image-unsupported") : available;
  if (selectionTools.has(name) && (turnState?.readingContextPermissions?.selection === false || deps.readingContextPolicy?.snapshot().selection === false)) return unavailable("selection-private");
  if (!readerTools.has(name) && name !== "control_reader_image") return available;
  if (context === undefined) return { state: "unknown", reason: "host-readiness-unavailable" };
  if (context === null) return unavailable("host-readiness-failed");
  if (name === "control_reader_image") return !context.imageBookId ? unavailable("no-image-viewer")
    : scope.kind === "book" && context.imageBookId !== scope.bookId ? unavailable("scope-not-active") : available;
  if (!context.session || !context.bookId) return unavailable("no-reader-session");
  if (scope.kind === "book" && context.bookId !== scope.bookId) return unavailable("scope-not-active");
  // Navigation also owns close/reload: preserve recovery while loading/error.
  if (name === "navigate_reading") return available;
  if (!context.ready) return unavailable("reader-not-ready");
  if (selectionTools.has(name) && !context.selection) return unavailable("no-selection");
  if (name === "set_reader_controls" && !context.controls) return unavailable("no-reader-controls");
  if ((name === "set_reader_panel" || name === "set_reader_panel_width") && !context.panels) return unavailable("no-reader-panels");
  if (name === "configure_reading_mode" && !context.modes) return unavailable("no-reading-mode");
  if (name === "control_read_aloud" && !context.playback) return unavailable("read-aloud-unavailable");
  return available;
}

/** All host tools share metadata semantics. Input-specific objects, permissions,
 * approval and per-action readiness remain authoritative in their domain calls.
 * Do not wrap extensions: their registration identity and availability are owned
 * by the plugin bridge, not a same-name host mapping. */
export function prepareHostTools(tools: AgentTool[], scope: ThreadScope, deps: RuntimeDeps, turnState?: AgentTurnState) {
  const context = readContext(deps);
  const all = tools.map(tool => {
    const wrapped: AgentTool = { ...tool, execute: async (...args) => {
      args[2]?.throwIfAborted();
      const current = check(tool.name, scope, deps, readContext(deps), turnState);
      if (current.state === "unavailable") throw new AppError("ui/unavailable", `Tool is currently unavailable: ${current.reason}`);
      return tool.execute(...args);
    } };
    metadata.set(wrapped, check(tool.name, scope, deps, context, turnState));
    return wrapped;
  });
  return { enabled: all.filter(tool => toolAvailability(tool)?.state !== "unavailable"), all };
}
