import type { NativeInputBridge, RendererResizeSample } from './renderer.js'

const sample = (element: HTMLElement): RendererResizeSample => ({ width: element.clientWidth, height: element.clientHeight,
    viewport: { width: element.ownerDocument.defaultView?.innerWidth ?? 0, height: element.ownerDocument.defaultView?.innerHeight ?? 0 } })
const equal = (a: RendererResizeSample, b: RendererResizeSample) => a.width === b.width && a.height === b.height
    && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height

/** Window-caused feedback gets a fresh opaque host context. Standalone engine
 * use and element-only relayout retain their existing synchronous behavior. */
export class RendererResizeObserver {
    #observer: ResizeObserver
    #element: HTMLElement | undefined
    #sample: RendererResizeSample | undefined
    #request = 0
    #pendingBefore: RendererResizeSample | undefined
    constructor(bridge: () => NativeInputBridge | undefined, context: () => object | undefined,
        navigation: () => number, render: (context?: object) => void) {
        this.#observer = new ResizeObserver(() => {
            const element = this.#element, before = this.#sample
            if (!element || !before) return
            const next = sample(element), currentContext = context(), currentNavigation = navigation(), input = bridge()
            if (this.#pendingBefore && equal(before, next)) return
            this.#sample = next
            const request = ++this.#request
            if (!input?.resize || !this.#pendingBefore && before.viewport.width === next.viewport.width && before.viewport.height === next.viewport.height) {
                this.#pendingBefore = undefined
                render(currentContext)
                return
            }
            const sourceBefore = this.#pendingBefore ?? before
            this.#pendingBefore = sourceBefore
            const current = () => this.#element === element && request === this.#request && input === bridge()
                && currentContext === context() && currentNavigation === navigation() && equal(next, sample(element))
            const finish = (source: object) => {
                if (request !== this.#request) return
                const accepted = current()
                this.#pendingBefore = undefined
                if (accepted) render(source)
            }
            void input.resize(sourceBefore, next).then(finish, () => finish({}))
        })
    }
    observe(element: HTMLElement) {
        this.disconnect()
        this.#element = element
        this.#sample = sample(element)
        this.#observer.observe(element)
    }
    disconnect() {
        this.#request++
        this.#element = undefined
        this.#sample = undefined
        this.#pendingBefore = undefined
        this.#observer.disconnect()
    }
}
