import { ContentBudgetError } from './content-budget.js'

/** Narrow the PDF.js object/operator boundary; no parser objects escape the book adapter. */
export type PDFImagePage = {
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
    objs: { has(id: string): boolean; get(id: string): unknown }
    commonObjs: { has(id: string): boolean; get(id: string): unknown }
}
type ImageCandidate = { objectId: string } | { inline: unknown } | { unsupported: true }
const IMAGE_OPS = new Set([83, 84, 85, 86, 87, 88, 89, 90])

export async function pdfImageCandidates(page: PDFImagePage, signal?: AbortSignal): Promise<ImageCandidate[]> {
    signal?.throwIfAborted()
    const operators = await page.getOperatorList()
    signal?.throwIfAborted()
    if (operators.fnArray.length > 100_000) throw new ContentBudgetError()
    const images: ImageCandidate[] = []
    for (let i = 0; i < operators.fnArray.length; i++) {
        const op = operators.fnArray[i]
        if (!IMAGE_OPS.has(op)) continue
        const value = operators.argsArray[i]?.[0]
        // Masks depend on the surrounding paint state, so do not invent their colors.
        images.push((op === 85 || op === 88) && typeof value === 'string' ? { objectId: value }
            : op === 86 || op === 87 ? { inline: value } : { unsupported: true })
        if (images.length > 1000) throw new ContentBudgetError()
    }
    return images
}

export type PDFImagePixels = { width: number; height: number; bitmap?: ImageBitmap; rgba?: Uint8ClampedArray<ArrayBuffer> }
function imagePixels(value: unknown): PDFImagePixels | null {
    if (!value || typeof value !== 'object' || !('width' in value) || !('height' in value)) return null
    const { width, height } = value
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_000_000) throw new ContentBudgetError()
    if ('bitmap' in value && value.bitmap && typeof ImageBitmap !== 'undefined' && value.bitmap instanceof ImageBitmap)
        return { width, height, bitmap: value.bitmap }
    if (!('data' in value) || !(value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray) || !('kind' in value)) return null
    const data = value.data, kind = value.kind
    const stride = kind === 1 ? Math.ceil(width / 8) : kind === 2 ? width * 3 : kind === 3 ? width * 4 : 0
    if (!stride || data.length < stride * height) return null
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const out = (y * width + x) * 4
        if (kind === 1) {
            const gray = data[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0
            rgba[out] = gray; rgba[out + 1] = gray; rgba[out + 2] = gray; rgba[out + 3] = 255
        } else {
            const start = y * stride + x * (kind === 2 ? 3 : 4)
            rgba[out] = data[start]; rgba[out + 1] = data[start + 1]; rgba[out + 2] = data[start + 2]
            rgba[out + 3] = kind === 3 ? data[start + 3] : 255
        }
    }
    return { width, height, rgba }
}

const encodeImage = async ({ width, height, bitmap, rgba }: PDFImagePixels): Promise<Blob> => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Image canvas is unavailable')
        if (bitmap) context.drawImage(bitmap, 0, 0)
        else if (rgba) context.putImageData(new ImageData(rgba, width, height), 0, 0)
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed')), 'image/png'))
    } finally { canvas.width = 0; canvas.height = 0 }
}

export async function readPDFImage(page: PDFImagePage, index: number, signal?: AbortSignal,
    encode: (pixels: PDFImagePixels) => Promise<Blob> = encodeImage): Promise<Blob | null> {
    const candidate = (await pdfImageCandidates(page, signal))[index]
    if (!candidate || 'unsupported' in candidate) return null
    let value: unknown
    if ('objectId' in candidate) {
        const objects = candidate.objectId.startsWith('g_') ? page.commonObjs : page.objs
        // PDF.js may finish its operator list before worker image transfer finishes.
        // Keep the source lease while waiting; no permanent callbacks in PDFObjects.
        const deadline = Date.now() + 10_000
        while (!objects.has(candidate.objectId)) {
            signal?.throwIfAborted()
            if (Date.now() >= deadline) throw new Error('PDF image decode timed out')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        value = objects.get(candidate.objectId)
    } else value = candidate.inline
    signal?.throwIfAborted()
    const pixels = imagePixels(value)
    if (!pixels) return null
    const blob = await encode(pixels)
    signal?.throwIfAborted()
    if (!blob.size || blob.size > 16 * 1024 * 1024) throw new ContentBudgetError()
    return blob
}
