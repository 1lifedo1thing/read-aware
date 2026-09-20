/**
 * 阅读位置 href → 抽取章节的反查。文件路径比较与 apps/web reader 的
 * epub-utils 保持一致；章节反查先保留 fragment 精确匹配，再尝试无歧义的文件匹配。
 * 后缀匹配要求落在路径边界上（"text/ch1.html" ↔ "ch1.html" 匹配，
 * "part0010.html" ↔ "0.html" 不匹配）。
 */

function canonicalHref(href: string): string {
  const bare = href.split("#")[0];
  let decoded = bare;
  try {
    decoded = decodeURI(bare);
  } catch {
    // 非法转义序列 —— 保留原样参与比较
  }
  return decoded.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
}

export function hrefMatches(left: string, right: string): boolean {
  const a = canonicalHref(left);
  const b = canonicalHref(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** Prefer exact anchors. A file shared by several chapters cannot identify an
 * arbitrary paragraph's chapter: leave it unknown rather than guess the first. */
export function findChapterByHref<T extends { index: number; hrefs?: readonly string[] }>(
  toc: readonly T[], href: string,
): T | undefined {
  const fragment = (value: string) => {
    const raw = value.includes("#") ? value.slice(value.indexOf("#") + 1) : "";
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const exact = toc.filter(chapter => chapter.hrefs?.some(candidate =>
    hrefMatches(candidate, href) && fragment(candidate) === fragment(href)));
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const sameFile = toc.filter(chapter => chapter.hrefs?.some(candidate => hrefMatches(candidate, href)));
  return sameFile.length === 1 ? sameFile[0] : undefined;
}
