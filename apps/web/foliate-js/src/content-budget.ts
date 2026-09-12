/** Query extraction budgets; these do not limit rendering a book page. */
export const CONTENT_QUERY_MAX_CHARS = 2 * 1024 * 1024
export const CONTENT_QUERY_MAX_NODES = 100_000
export const CONTENT_QUERY_MAX_SOURCE_BYTES = 8 * 1024 * 1024
export class ContentBudgetError extends Error {
    readonly code = 'library/content-budget-exceeded'
    constructor() { super('Book section exceeds the content query budget'); this.name = 'ContentBudgetError' }
}
export function checkContentText(text: string): string {
    if (text.length > CONTENT_QUERY_MAX_CHARS) throw new ContentBudgetError()
    return text
}
/** Inspect nodes/attributes without serializing or cloning a large source tree. */
export function checkContentDocument(doc: Document): void {
    const walker = doc.createTreeWalker(doc, 1 | 4 | 8)
    let count = 0, chars = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (++count > CONTENT_QUERY_MAX_NODES) throw new ContentBudgetError()
        if (node.nodeType === 1) {
            for (const attr of (node as Element).attributes) chars += attr.value.length
        } else chars += node.nodeValue?.length ?? 0
        if (chars > CONTENT_QUERY_MAX_CHARS) throw new ContentBudgetError()
    }
}
