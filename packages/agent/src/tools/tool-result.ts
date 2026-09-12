/** 文本工具返回值的统一构造；图片工具另返回真正的 image 内容块。 */
export function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}

/** Resource expiry is a timestamp for readers, not an epoch-millisecond counter. */
export function resourceTextResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, (key, item: unknown) =>
      key === "expiresAt" && typeof item === "number" && Number.isFinite(item)
        ? new Date(item).toISOString() : item) }],
    details: undefined,
  };
}
