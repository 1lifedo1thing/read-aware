/** 文本工具返回值的统一构造；图片工具另返回真正的 image 内容块。 */
export function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}
