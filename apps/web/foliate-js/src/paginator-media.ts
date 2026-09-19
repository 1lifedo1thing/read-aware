const mediaSelector = 'img, svg, video, canvas'

// Publishers wrap full-page artwork in anything from a div to a layout table.
// Identify the document without removing nodes: their positions are CFI anchors.
export const isImageOnlyDocument = (doc: Document): boolean => {
    const media = Array.from(doc.body.querySelectorAll(mediaSelector))
        .filter(el => !el.parentElement?.closest(mediaSelector))
    if (media.length !== 1) return false
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim() && !node.parentElement?.closest(`${mediaSelector}, script, style`)) return false
    }
    return true
}

// The paginator's height already excludes its outer page margin. Reserve the
// image's own margins and its containing blocks' spacing inside that height.
// Do not use bounding boxes: a fragmented image reports pieces on several pages.
export const imageBlockSpacing = (el: Element, win: Window): number => {
    const pixels = (value: string) => Number.parseFloat(value) || 0
    const style = win.getComputedStyle(el)
    let spacing = pixels(style.marginTop) + pixels(style.marginBottom)
    for (let parent = el.parentElement; parent && parent !== el.ownerDocument.documentElement; parent = parent.parentElement) {
        const css = win.getComputedStyle(parent)
        spacing += pixels(css.paddingTop) + pixels(css.paddingBottom)
            + pixels(css.borderTopWidth) + pixels(css.borderBottomWidth)
            + pixels(css.marginTop) + pixels(css.marginBottom)
    }
    return spacing
}
