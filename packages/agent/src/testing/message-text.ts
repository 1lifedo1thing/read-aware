import type { Message } from "@earendil-works/pi-ai";

/** Plain text of one model message for assertions; non-text blocks add nothing. */
export function messageText(message: Message | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}
