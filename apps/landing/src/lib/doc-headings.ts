export const headingText = (text: string) =>
  text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
export const headingId = (text: string) =>
  headingText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

/** Headings in our authored Markdown; fenced examples are not page sections. */
export function docHeadings(body: string) {
  let fenced = false;
  return body.split("\n").flatMap((line) => {
    if (/^```/.test(line)) {
      fenced = !fenced;
      return [];
    }
    const match = !fenced && /^(##)\s+(.+)$/.exec(line);
    return match
      ? [{ title: headingText(match[2]), id: headingId(match[2]) }]
      : [];
  });
}
