import type { SectionReference } from './book.js'
import type { PDFPage } from './vendor/pdfjs/pdf.mjs'
import { checkContentText, ContentBudgetError, CONTENT_QUERY_MAX_CHARS } from './content-budget.js'

const annotationText = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && 'str' in value && typeof value.str === 'string') return value.str
    return ''
}

/** PDF.js annotation records only; never execute actions, attachments or rich-text markup. */
export async function readPDFReferences(page: Pick<PDFPage, 'getAnnotations'>, signal?: AbortSignal): Promise<SectionReference[]> {
    signal?.throwIfAborted()
    const annotations = await page.getAnnotations()
    signal?.throwIfAborted()
    if (annotations.length > 10_000) throw new ContentBudgetError()
    const references: SectionReference[] = []
    let chars = 0
    for (const item of annotations) {
        const text = annotationText(item.contentsObj ?? item.contents)
        const title = annotationText(item.titleObj ?? item.title)
        chars += text.length + title.length
        if (chars > CONTENT_QUERY_MAX_CHARS) throw new ContentBudgetError()
        if (item.subtype === 'Link') {
            const destination = item.dest
            const href = typeof item.url === 'string' ? item.url : typeof item.unsafeUrl === 'string' ? item.unsafeUrl
                : typeof destination === 'string' || Array.isArray(destination) ? JSON.stringify(destination) : undefined
            if (href && href.length > 8192) throw new ContentBudgetError()
            references.push({ kind: 'link', label: (title || text).trim().slice(0, 300), href,
                blocked: !href || Boolean(item.action || item.attachment || item.actions) })
        } else if (text && item.subtype !== 'Widget' && item.subtype !== 'Popup') {
            references.push({ kind: 'inline-note', label: title.trim().slice(0, 300), text })
        }
    }
    return references
}

/** Stable reader API works on older WKWebView; cancel the stream on abort/budget failure. */
export async function readPDFPageText(page: Pick<PDFPage, 'streamTextContent'>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const reader = page.streamTextContent().getReader()
    const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    let text = '', finished = false
    try {
        while (true) {
            signal?.throwIfAborted()
            const { value, done } = await reader.read()
            signal?.throwIfAborted()
            if (done) { finished = true; break }
            for (const item of value?.items ?? []) {
                if (!('str' in item)) continue
                if (text.length + item.str.length + 1 > CONTENT_QUERY_MAX_CHARS) throw new ContentBudgetError()
                text += item.str + (item.hasEOL ? '\n' : ' ')
            }
        }
        return checkContentText(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    } finally {
        signal?.removeEventListener('abort', cancel)
        if (!finished) await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
}
