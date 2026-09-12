import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { elideStaleToolResults } from "./context-slim";

const user = (text: string) =>
  ({ role: "user", content: text, timestamp: 0 }) as unknown as AgentMessage;
const toolResult = (text: string, toolName = "read_chapter") =>
  ({
    role: "toolResult",
    toolCallId: "t1",
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  }) as unknown as AgentMessage;

function resultText(message: AgentMessage): string {
  return (message as { content: Array<{ text: string }> }).content[0].text;
}

describe("elideStaleToolResults", () => {
  test("折叠最后一个用户消息之前的大工具结果，保留头部与说明", () => {
    const big = "正".repeat(5000);
    const messages = [user("q1"), toolResult(big), user("q2"), toolResult(big)];
    const slimmed = elideStaleToolResults(messages, 100);

    expect(resultText(slimmed[1]).length).toBeLessThan(300);
    expect(resultText(slimmed[1])).toContain("正".repeat(100));
    expect(resultText(slimmed[1])).toContain("read_chapter");
    // 当前轮（最后一个用户消息之后）的结果原样保留
    expect(resultText(slimmed[3])).toBe(big);
  });

  test("小结果与非 toolResult 消息不动，且不改原数组", () => {
    const messages = [user("q1"), toolResult("short"), user("q2")];
    const slimmed = elideStaleToolResults(messages, 100);
    expect(slimmed[1]).toBe(messages[1]);
    expect(slimmed[0]).toBe(messages[0]);
  });

  test("单轮对话（没有历史轮）原样返回", () => {
    const big = "字".repeat(5000);
    const messages = [user("q1"), toolResult(big)];
    expect(elideStaleToolResults(messages, 100)).toBe(messages);
  });
});

test("earlier image blocks are removed even when their text metadata is short", () => {
  const image = { ...toolResult("image metadata"), content: [{ type: "image", mimeType: "image/png", data: "AAAA" }, { type: "text", text: "image metadata" }] } as AgentMessage;
  const messages = [user("q1"), image, user("q2"), image];
  const result = elideStaleToolResults(messages);
  expect(JSON.stringify(result[1])).not.toContain("AAAA");
  expect(resultText(result[1])).toContain("image inputs");
  expect(result[3]).toBe(image);
});

test("completed turns release pixel payloads from retained state while preserving tool identity and metadata", async () => {
  const { releaseToolImages } = await import("./context-slim");
  const message = { ...toolResult("descriptor", "read_book_image"), content: [{ type: "text", text: "descriptor" }, { type: "image", mimeType: "image/png", data: "AAAA" }] } as AgentMessage;
  const [released] = releaseToolImages([message]);
  expect(released).toMatchObject({ toolCallId: "t1", toolName: "read_book_image", content: [{ type: "text", text: "descriptor" }, { type: "text" }] });
  expect(JSON.stringify(released)).not.toContain("AAAA");
  expect(JSON.stringify(message)).toContain("AAAA");
});
