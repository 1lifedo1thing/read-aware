import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { normalizeChangesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildChangeTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const port = deps.changes?.(scope); if (!port) return [];
  const query = Type.Object({
    areas: Type.Array(Type.Union(["library", "reading", "annotations", "conversations", "memory", "settings"].map(value => Type.Literal(value))), { minItems: 1, maxItems: 6 }),
    bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    settingsPaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 32 })),
  }, { additionalProperties: false });
  const accepted = (raw: unknown) => normalizeChangesQuery(raw);
  return [{ name: "open_change_cursor", label: "Start tracking changes",
    description: "Open a persistent change cursor BEFORE reading a baseline with domain query tools. Select areas and optional bookId; book conversations must specify their own bookId. Settings require exact readable catalog settingsPaths, including credentialConfigured presence metadata. Returns a cursor owned by this conversation scope, with no content or event history.",
    parameters: Type.Object({ query }, { additionalProperties: false }),
    execute: async (_id, raw, signal) => textResult(await port.open(accepted((raw as { query: unknown }).query), signal)),
  }, { name: "read_changes", label: "Read changes since cursor",
    description: "Continue using the same query and cursor. Notices are conservative reload hints, not actual values, raw events, or exact edit counts; query affected domains again. Empty pages with hasMore still need continuation. Use the returned cursor after processing the page. Expired cursors require opening a new cursor then reloading a baseline. Settings hints invalidate requested authorized paths sharing their storage namespace.",
    parameters: Type.Object({ query, cursor: Type.String({ pattern: "^[a-f0-9]{48}$" }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
    execute: async (_id, raw, signal) => { const input = raw as { query: unknown; cursor: string; limit?: number };
      return textResult(await port.read(accepted(input.query), input.cursor, input.limit, signal)); },
  }];
}
