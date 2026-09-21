import type { TextWalker } from './text-walker.js'
import { indexText, type TextMatchRange } from './text-index.js'
import { cooperativeCheckpoint } from './cooperative.js'

export type { TextMatchRange } from './text-index.js'

// length for context in excerpts
const CONTEXT_LENGTH = 50

export type SearchOptions = {
    locales?: string | string[]
    granularity?: Intl.SegmenterOptions['granularity']
    sensitivity?: Intl.CollatorOptions['sensitivity']
}

export type SearchExcerpt = { pre: string; match: string; post: string }
export type SearchResult<T = TextMatchRange> = { range: T; excerpt: SearchExcerpt }
export type SearchMatcherOptions = {
    defaultLocale?: string
    matchCase?: boolean
    matchDiacritics?: boolean
    matchWholeWords?: boolean
    acceptNode?: (node: Node) => number
}

const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ')

const makeExcerpt = (strs: string[], { startIndex, startOffset, endIndex, endOffset }: TextMatchRange): SearchExcerpt => {
    const start = strs[startIndex]
    const end = strs[endIndex]
    const match = startIndex === endIndex
        ? start.slice(startOffset, endOffset)
        : start.slice(startOffset)
            + strs.slice(startIndex + 1, endIndex).join('')
            + end.slice(0, endOffset)
    const trimmedStart = normalizeWhitespace(start.slice(0, startOffset)).trimStart()
    const trimmedEnd = normalizeWhitespace(end.slice(endOffset)).trimEnd()
    const ellipsisPre = trimmedStart.length < CONTEXT_LENGTH ? '' : '…'
    const ellipsisPost = trimmedEnd.length < CONTEXT_LENGTH ? '' : '…'
    const pre = `${ellipsisPre}${trimmedStart.slice(-CONTEXT_LENGTH)}`
    const post = `${trimmedEnd.slice(0, CONTEXT_LENGTH)}${ellipsisPost}`
    return { pre, match, post }
}

const simpleSearch = function* (strs: string[], query: string, options: SearchOptions = {}): Generator<SearchResult | undefined, void, unknown> {
    const { locales = 'en', sensitivity } = options
    const matchCase = sensitivity === 'variant'
    const indexed = indexText(strs)
    const haystack = indexed.text
    const lowerHaystack = matchCase ? haystack : haystack.toLocaleLowerCase(locales)
    const needle = matchCase ? query : query.toLocaleLowerCase(locales)
    const needleLength = needle.length
    // Bound candidate starts; overlap carries matches crossing a chunk edge.
    const chunkSize = 32768
    let from = 0
    while (from <= lowerHaystack.length - needleLength) {
        yield undefined
        const end = Math.min(from + chunkSize, lowerHaystack.length - needleLength + 1)
        const chunk = lowerHaystack.slice(from, end + needleLength - 1)
        let index = chunk.indexOf(needle)
        while (index !== -1 && from + index < end) {
            const range = indexed.range(from + index, from + index + needleLength)
            yield { range, excerpt: makeExcerpt(strs, range) }
            index = chunk.indexOf(needle, index + 1)
        }
        from = end
    }
}

type Folded = { text: string; starts: number[]; ends: number[] }

const FORMAT = /\p{Format}/u
const MARKS = /\p{M}/gu
const SPACE = /\s/u

/**
 * Fold text the way a collator would compare it, but once and linearly:
 * NFKD (canonical and compatibility equivalence, so full-width and ligature
 * forms meet their plain letters), combining marks dropped when accents do not
 * matter, lower-cased when case does not matter, whitespace runs collapsed to
 * one space and format characters made transparent. Every folded UTF-16 unit
 * remembers the source code point it came from, so a match maps back to the
 * exact source range. Yields periodically for cooperative scheduling.
 */
function* foldText(text: string, locales: string | string[], foldCase: boolean, foldAccents: boolean): Generator<undefined, Folded, unknown> {
    const parts: string[] = [], starts: number[] = [], ends: number[] = []
    let space = -1
    let count = 0
    const whitespace = (index: number, end: number) => {
        if (space === -1) { space = starts.length; parts.push(' '); starts.push(index); ends.push(end) }
        else ends[space] = end
    }
    for (let index = 0; index < text.length;) {
        if (++count % 2048 === 0) yield undefined
        const unit = text.charCodeAt(index)
        // ASCII and CJK ideographs are their own NFKD form; only ASCII letters
        // have case. Book text is almost entirely one or the other, so this
        // path decides the cost of folding.
        if (unit < 0x80) {
            if (unit === 0x20 || unit >= 0x09 && unit <= 0x0d) whitespace(index, index + 1)
            else {
                space = -1
                parts.push(String.fromCharCode(foldCase && unit >= 0x41 && unit <= 0x5a ? unit + 0x20 : unit))
                starts.push(index); ends.push(index + 1)
            }
            index++
            continue
        }
        if (unit >= 0x4e00 && unit <= 0x9fff || unit >= 0x3400 && unit <= 0x4dbf) {
            space = -1
            parts.push(text[index]); starts.push(index); ends.push(index + 1)
            index++
            continue
        }
        const code = text.codePointAt(index) ?? unit
        const length = code > 0xffff ? 2 : 1
        const end = index + length
        const char = text.slice(index, end)
        if (SPACE.test(char)) { whitespace(index, end); index = end; continue }
        space = -1
        if (!FORMAT.test(char)) {
            let piece = char.normalize('NFKD')
            if (foldAccents) piece = piece.replace(MARKS, '')
            if (foldCase) piece = piece.toLocaleLowerCase(locales)
            if (piece) {
                parts.push(piece)
                for (let offset = 0; offset < piece.length; offset++) { starts.push(index); ends.push(end) }
            } else if (ends.length) {
                // A bare combining mark belongs to the letter before it.
                ends[ends.length - 1] = end
            }
        }
        index = end
    }
    return { text: parts.join(''), starts, ends }
}

/** Whether `from` and `to` (source offsets) both fall on segment boundaries. */
function onBoundaries(segmenter: Intl.Segmenter, text: string, from: number, to: number, context: number): boolean {
    const low = Math.max(0, from - context), high = Math.min(text.length, to + context)
    let startsOk = from === 0 || from === text.length, endsOk = to === 0 || to === text.length
    for (const { index, segment } of segmenter.segment(text.slice(low, high))) {
        const start = low + index, end = start + segment.length
        if (start === from) startsOk = true
        if (end === to) endsOk = true
        if (start > to) break
    }
    return startsOk && endsOk
}

/**
 * Case-, accent- and width-insensitive search in linear time: fold the
 * content once, scan with indexOf, then confirm each candidate covers whole
 * source code points and sits on grapheme (or word) boundaries. This replaces
 * a collator-compared sliding window that cost a string allocation and a
 * comparison per grapheme, which made a book-length section take minutes.
 */
const foldedSearch = function* (strs: string[], query: string, options: SearchOptions = {}): Generator<SearchResult | undefined, void, unknown> {
    const { locales = 'en', granularity = 'grapheme', sensitivity = 'base' } = options
    const foldCase = sensitivity === 'base' || sensitivity === 'accent'
    const foldAccents = sensitivity === 'base' || sensitivity === 'case'
    let segmenter: Intl.Segmenter
    let localeTag: string | string[] = locales
    try { segmenter = new Intl.Segmenter(locales, { granularity }) }
    catch (e) {
        console.warn(e)
        localeTag = 'en'
        segmenter = new Intl.Segmenter('en', { granularity })
    }
    const needle = (yield* foldText(query, localeTag, foldCase, foldAccents)).text
    if (!needle) return
    const indexed = indexText(strs)
    const folded = yield* foldText(indexed.text, localeTag, foldCase, foldAccents)
    // One checkpoint per scan even when the folded text is shorter than the
    // needle, so a cancelled no-hit search still observes its signal.
    yield undefined
    const { text: haystack, starts, ends } = folded
    const context = granularity === 'word' ? 64 : 16
    const wholeCodePoints = (start: number, end: number) =>
        (start === 0 || starts[start] !== starts[start - 1]) && (end === haystack.length || starts[end] !== starts[end - 1])
    const chunkSize = 32768
    let from = 0
    while (from <= haystack.length - needle.length) {
        yield undefined
        const end = Math.min(from + chunkSize, haystack.length - needle.length + 1)
        const chunk = haystack.slice(from, end + needle.length - 1)
        let index = chunk.indexOf(needle)
        while (index !== -1 && from + index < end) {
            const start = from + index, stop = start + needle.length
            if (wholeCodePoints(start, stop)) {
                const sourceStart = starts[start], sourceEnd = ends[stop - 1]
                if (onBoundaries(segmenter, indexed.text, sourceStart, sourceEnd, context)) {
                    const range = indexed.range(sourceStart, sourceEnd)
                    yield { range, excerpt: makeExcerpt(strs, range) }
                }
            }
            index = chunk.indexOf(needle, index + 1)
        }
        from = end
    }
}

function* searchSteps(strs: string[], query: string, options: SearchOptions): Generator<SearchResult | undefined, void, unknown> {
    if (!strs.length || !query.length) return
    const { granularity = 'grapheme', sensitivity = 'base' } = options
    if (!Intl?.Segmenter || granularity === 'grapheme'
    && sensitivity === 'variant')
        yield* simpleSearch(strs, query, options)
    else yield* foldedSearch(strs, query, options)
}

export function* search(strs: string[], query: string, options: SearchOptions = {}): Generator<SearchResult, void, unknown> {
    for (const result of searchSteps(strs, query, options)) if (result) yield result
}

export async function* searchAsync(strs: string[], query: string, options: SearchOptions = {}, signal?: AbortSignal): AsyncGenerator<SearchResult, void, unknown> {
    const checkpoint = cooperativeCheckpoint(signal)
    signal?.throwIfAborted()
    for (const result of searchSteps(strs, query, options)) {
        const pending = checkpoint()
        if (pending) await pending
        if (result) yield result
        signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
}

export function matcherSearchOptions(doc: Document, opts: SearchMatcherOptions): SearchOptions {
    const { defaultLocale, matchCase, matchDiacritics, matchWholeWords } = opts
    return {
        locales: doc.body?.lang || doc.documentElement.lang || defaultLocale || 'en',
        granularity: matchWholeWords ? 'word' : 'grapheme',
        sensitivity: matchDiacritics && matchCase ? 'variant'
        : matchDiacritics && !matchCase ? 'accent'
        : !matchDiacritics && matchCase ? 'case'
        : 'base',
    }
}

export const searchMatcher = (textWalker: TextWalker, opts: SearchMatcherOptions) => {
    return function* (doc: Document, query: string): Generator<SearchResult<Range>, void, unknown> {
        const iter = textWalker(doc, function* (strs, makeRange) {
            for (const result of search(strs, query, matcherSearchOptions(doc, opts))) {
                const { startIndex, startOffset, endIndex, endOffset } = result.range
                yield { ...result, range: makeRange(startIndex, startOffset, endIndex, endOffset) }
            }
        }, opts.acceptNode)
        for (const result of iter) yield result
    }
}
