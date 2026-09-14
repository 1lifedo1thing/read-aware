import { expect, test } from "bun:test";
import { actorCause, causalActor, stampEventCause } from "../../../platform/domain-actor";
import { resizeSource, type ResizeSample } from "./resize-source";

test("resize source uses matching native client geometry and does not reuse it for another size", async () => {
  const before: ResizeSample = { width: 700, height: 500, viewport: { width: 800, height: 600 } };
  const next: ResizeSample = { width: 1100, height: 800, viewport: { width: 1200, height: 900 } };
  const render = causalActor("user"), native = causalActor("plugin:window");
  const read = async () => stampEventCause({ width: 1200, height: 900 }, native);
  expect(actorCause(await resizeSource(before, next, render, read))).toBe(actorCause(native));
  const other = { ...next, viewport: { width: 1000, height: 900 } };
  expect(actorCause(await resizeSource(before, other, render, read))).not.toBe(actorCause(native));
  expect(await resizeSource(before, { ...before, height: 450 }, render, () => { throw Error("No viewport change"); })).toBe(render);
});
