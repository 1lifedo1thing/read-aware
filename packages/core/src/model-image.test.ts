import { expect, test } from "bun:test";
import { validateModelImages } from "./model-image";

test("model image validation rejects malformed, sparse, foreign-field and aggregate oversized inputs", () => {
  const image = { mimeType: "image/png", data: "AAAA" };
  expect(validateModelImages([image])).toEqual([image]);
  for (const value of [null, Array(1), [undefined], [{ ...image, url: "file:///private" }], [{ ...image, data: "a===" }], Array(5).fill(image)])
    expect(() => validateModelImages(value)).toThrow();
  const large = { ...image, data: "AAAA".repeat(2 * 1024 * 1024) };
  expect(() => validateModelImages([large, large, large])).toThrow();
});
