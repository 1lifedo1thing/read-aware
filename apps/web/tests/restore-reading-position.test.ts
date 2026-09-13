import { expect, test } from "bun:test";
import { restoreReadingPosition } from "../src/features/reader/lib/restore-reading-position";

test("fresh, reset and stale positions start at the beginning even when the renderer has already selected a page", async () => {
  for (const input of [
    { virtual: false, reset: false, target: null, fraction: 0 },
    { virtual: false, reset: true, target: "old-page", fraction: 0.8 },
    { virtual: true, reset: false, target: "missing-article", fraction: 0.8 },
    { virtual: false, reset: false, target: null, fraction: 0.8 },
  ]) {
    let page = 0;
    const view = {
      goTo: async () => undefined,
      goToFraction: async () => { throw Error("Stored position unavailable"); },
      init: async () => { page = 0; },
      renderer: { next: async () => { page++; } },
    };
    await restoreReadingPosition(view, input);
    expect(page).toBe(0);
  }
});

test("valid saved targets and fractions are retained instead of restarting the book", async () => {
  let page = 0;
  const view = {
    goTo: async () => { page = 2; return { index: 2 }; },
    goToFraction: async () => { page = 3; },
    init: async () => { page = 0; },
  };
  await restoreReadingPosition(view, { virtual: false, reset: false, target: "saved-page", fraction: 0.5 });
  expect(page).toBe(2);
  await restoreReadingPosition(view, { virtual: false, reset: false, target: null, fraction: 0.5 });
  expect(page).toBe(3);
});
