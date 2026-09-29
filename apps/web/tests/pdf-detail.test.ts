import { expect, test } from "bun:test";
import { DETAIL_MARGIN, detailRegion, regionCovers } from "../foliate-js/src/pdf-detail";

const area = (r: { left: number; top: number; right: number; bottom: number }, w: number, h: number) =>
  (r.right - r.left) * w * (r.bottom - r.top) * h;

test("the visible part grows by the whole margin while it fits the budget", () => {
  const visible = { left: 0.4, top: 0.4, right: 0.5, bottom: 0.5 };
  const region = detailRegion(visible, 1000, 1000, 1e9);
  const grow = 0.1 * DETAIL_MARGIN;
  expect(region.left).toBeCloseTo(0.4 - grow);
  expect(region.right).toBeCloseTo(0.5 + grow);
  expect(regionCovers(region, visible)).toBe(true);
});

test("the margin clamps to the page", () => {
  const region = detailRegion({ left: 0, top: 0.9, right: 0.2, bottom: 1 }, 1000, 1000, 1e9);
  expect(region.left).toBe(0);
  expect(region.bottom).toBe(1);
});

test("only as much margin as the budget allows, still covering the visible part", () => {
  const visible = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
  const budget = 30_000_000;
  const region = detailRegion(visible, 10_000, 10_000, budget);
  expect(area(region, 10_000, 10_000)).toBeLessThanOrEqual(budget);
  expect(area(region, 10_000, 10_000)).toBeGreaterThan(area(visible, 10_000, 10_000));
  expect(regionCovers(region, visible)).toBe(true);
});

test("a visible part larger than the budget keeps its middle", () => {
  const visible = { left: 0, top: 0, right: 1, bottom: 1 };
  const region = detailRegion(visible, 10_000, 10_000, 25_000_000);
  expect(area(region, 10_000, 10_000)).toBeCloseTo(25_000_000, -3);
  expect((region.left + region.right) / 2).toBeCloseTo(0.5);
  expect((region.top + region.bottom) / 2).toBeCloseTo(0.5);
});
