import { expect, test } from "bun:test";
import { RendererResizeObserver } from "../../../../foliate-js/src/resize-observer";
import type { NativeInputBridge, RendererResizeSample } from "../../../../foliate-js/src/renderer";

test("window feedback coalesces element resize and retires navigation and disposal races", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let notify = () => {}, navigation = 0, context: object = {};
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class {
    constructor(callback: () => void) { notify = callback; }
    observe() {} disconnect() {}
  } });
  const viewport = { innerWidth: 1000, innerHeight: 800 };
  const element = { clientWidth: 900, clientHeight: 700, ownerDocument: { defaultView: viewport } };
  const pending: Array<{ before: RendererResizeSample; resolve(value: object): void }> = [];
  const rendered: Array<object | undefined> = [];
  const bridge: NativeInputBridge = { context: () => ({}), selectionChanged() {}, focusDocument() {},
    resize: before => new Promise(resolve => pending.push({ before, resolve })) };
  const observer = new RendererResizeObserver(() => bridge, () => context, () => navigation, source => { rendered.push(source); context = source ?? {}; });
  try {
    observer.observe(element as unknown as HTMLElement);
    viewport.innerWidth = 600; element.clientWidth = 500; notify(); notify();
    expect(pending).toHaveLength(1);
    element.clientWidth = 450; notify();
    expect(pending).toHaveLength(2);
    expect(pending[1]!.before.viewport.width).toBe(1000);
    const source = {};
    pending[0]!.resolve({}); await Promise.resolve(); expect(rendered).toHaveLength(0);
    pending[1]!.resolve(source); await Promise.resolve(); expect(rendered).toEqual([source]);
    viewport.innerWidth = 1100; notify(); navigation++;
    pending[2]!.resolve({}); await Promise.resolve(); expect(rendered).toEqual([source]);
    viewport.innerWidth = 1200; notify(); observer.disconnect();
    pending[3]!.resolve({}); await Promise.resolve(); expect(rendered).toEqual([source]);
  } finally {
    observer.disconnect();
    if (saved) Object.defineProperty(globalThis, "ResizeObserver", saved); else Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
});
