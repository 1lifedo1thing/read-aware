import type { Anchor, ResolvedNavigation } from './book.js'
import { anchorElement, anchorValue } from './navigation.js'

const blocks = 'h1, h2, h3, h4, h5, h6, p, section, article, div'

/** Presentation boundaries in the original document. No nodes are removed or
 * reparented: published CFIs, annotations and links keep their source paths. */
export class ChapterRanges {
    readonly starts: (Element | null)[] = [null]
    readonly ranges: Range[] = []
    startsAtBeginning = false
    index = 0
    constructor(readonly doc: Document, targets: readonly ResolvedNavigation[]) {
        const elements = new Set<Element>()
        for (const target of targets) {
            const anchor = anchorValue(doc, target.anchor)
            // EPUB nav commonly targets <body id="…">, <html>, or the file
            // itself. These are chapter boundaries too, even though they must
            // not become in-body ranges or acquire a preceding blank page.
            if (anchor === 0 || target.anchor == null || anchor === doc.body || anchor === doc.documentElement)
                this.startsAtBeginning = true
            const element = anchorElement(anchor)
            const block = element?.closest(blocks) ?? element
            if (block && block !== doc.body && doc.body.contains(block)) elements.add(block)
        }
        const sorted = [...elements].sort((a, b) =>
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        for (const element of sorted) {
            const before = doc.createRange()
            before.selectNodeContents(doc.body)
            before.setEndBefore(element)
            const previous = before.toString().trim() || [...doc.body.querySelectorAll('img, svg, video, canvas')]
                .some(image => !!(image.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
            if (previous) this.starts.push(element)
            else this.startsAtBeginning = true
        }
        for (let i = 0; i < this.starts.length; i++) {
            const range = doc.createRange()
            range.selectNodeContents(doc.body)
            const start = this.starts[i], end = this.starts[i + 1]
            if (start) range.setStartBefore(start)
            if (end) range.setEndBefore(end)
            this.ranges.push(range)
        }
    }
    select(anchor: Exclude<Anchor, number>) {
        const point = this.doc.createRange()
        if ('startContainer' in anchor) point.setStart(anchor.startContainer, anchor.startOffset)
        else point.setStartBefore(anchor)
        point.collapse(true)
        this.index = Math.max(0, this.ranges.findLastIndex(range => range.compareBoundaryPoints(Range.START_TO_START, point) <= 0))
    }
    clamp(range: Range): Range {
        const chapter = this.ranges[this.index]
        if (range.compareBoundaryPoints(Range.START_TO_START, chapter) < 0)
            range.setStart(chapter.startContainer, chapter.startOffset)
        if (range.compareBoundaryPoints(Range.END_TO_END, chapter) > 0)
            range.setEnd(chapter.endContainer, chapter.endOffset)
        return range
    }
    hasAdjacent(dir: -1 | 1) { return !!this.ranges[this.index + dir] }
}
