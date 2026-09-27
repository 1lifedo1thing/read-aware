/**
 * The chat surface's half of the ConversationPort contract, for tests and
 * evals. The runtime never writes the transcript; the desktop host
 * (useBookConversation → conversation-store → ai_chat_commit) does, in this
 * order:
 *
 * 1. Before the turn: persist the user message (a retry/regenerate first
 *    truncates the transcript at that message) and pass its id as `turnId`.
 * 2. Stream the turn.
 * 3. After the stream: persist the visible reply — the text chunks, or an
 *    empty-text message when only reference/interaction cards were shown. A
 *    stopped turn keeps its partial reply; a failed one leaves only an error
 *    stub, which the port never returns from `load`, so nothing is recorded.
 *
 * Image attachments are not recorded: the product port never returns them
 * (local image references stay presentation state).
 */
import type { ThreadChunk } from "../chunks";
import type { TurnRecord } from "../ports";
import type { SendTurnInput } from "../runtime/thread";

export interface TranscriptHostTarget {
  /** threadScopeKey() of the thread — the transcript map key. */
  key: string;
  sendTurn(input: SendTurnInput): AsyncIterable<ThreadChunk>;
}

export async function* hostTurn(
  transcripts: Map<string, TurnRecord[]>,
  target: TranscriptHostTarget,
  input: SendTurnInput,
): AsyncGenerator<ThreadChunk> {
  const turnId = input.turnId ?? crypto.randomUUID();
  const persisted = transcripts.get(target.key) ?? [];
  const existing = persisted.findIndex((record) => record.id === turnId);
  const history = existing < 0 ? persisted : persisted.slice(0, existing);
  const user: TurnRecord = {
    id: turnId,
    role: "user",
    content: input.text,
    createdAt: new Date().toISOString(),
    ...(input.attachments?.length ? { attachments: structuredClone(input.attachments) } : {}),
  };
  const withUser = [...history, user];
  transcripts.set(target.key, withUser);

  let text = "";
  let structured = false;
  let failed = false;
  try {
    for await (const chunk of target.sendTurn({ ...input, turnId })) {
      if (chunk.type === "text") text += chunk.text;
      else if (chunk.type === "reference" || chunk.type === "interaction") structured = true;
      yield chunk;
    }
  } catch (error) {
    failed = !input.signal?.aborted;
    throw error;
  } finally {
    if (!failed && (text || structured)) {
      transcripts.set(target.key, [...withUser, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: text,
        createdAt: new Date().toISOString(),
      }]);
    }
  }
}
