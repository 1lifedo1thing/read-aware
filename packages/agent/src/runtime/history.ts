/**
 * 持久化转录（TurnRecord）↔ pi AgentMessage 的换算。
 * 水化出的助手消息借用当前模型的 api/provider 标识，保证 pi-ai 的
 * 跨 provider 消息变换把它们当作已知格式处理。
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { TurnAttachment, TurnRecord } from "../ports";

export function formatUserTurn(content: string, attachments?: TurnAttachment[]): string {
  if (!attachments?.length) return content;
  const quoted = attachments
    .map((attachment) => {
      const body = attachment.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return attachment.chapter ? `${body}\n> — ${attachment.chapter}` : body;
    })
    .join("\n\n");
  return [quoted, content].filter(Boolean).join("\n\n");
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function turnRecordsToMessages(records: TurnRecord[], model: Model<Api>): AgentMessage[] {
  return records.map((record) => {
    const timestamp = Date.parse(record.createdAt) || Date.now();
    if (record.role === "user") {
      return {
        role: "user",
        content: formatUserTurn(record.content, record.attachments),
        timestamp,
      };
    }
    const assistant: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: record.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp,
    };
    return assistant;
  });
}

/**
 * 书线程无状态装配的历史尾巴：默认仍是最后一次完整的
 * user↔assistant 交换；需要重建安全边界时，调用方可以请求固定数量的
 * 最近完整交换。尾部未完成的 user 记录始终不会被装配，避免把当前问题
 * 重复喂给 Agent。
 */
export function lastTurnTail(records: TurnRecord[], maxTurns = 1): TurnRecord[] {
  const limit = Number.isFinite(maxTurns) ? Math.floor(maxTurns) : 0;
  if (limit <= 0) return [];

  let end = -1;
  let start = -1;
  let completeTurns = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.role !== "assistant") continue;
    if (end < 0) end = index + 1;
    start = records[index - 1]?.role === "user" ? index - 1 : index;
    completeTurns += 1;
    if (completeTurns >= limit) break;
  }
  return start >= 0 && end > start ? records.slice(start, end) : [];
}

export function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ("role" in message && message.role === "assistant" && Array.isArray(message.content)) {
      return message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
    }
  }
  return "";
}
