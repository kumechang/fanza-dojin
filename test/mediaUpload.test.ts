import { describe, it, expect } from "vitest";
import { chunkImages } from "../src/x/mediaUpload.js";

describe("chunkImages", () => {
  it("splits evenly divisible arrays", () => {
    expect(chunkImages([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("leaves a smaller final chunk when not evenly divisible", () => {
    expect(chunkImages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunkImages([], 2)).toEqual([]);
  });

  it("throws for a non-positive chunk size", () => {
    expect(() => chunkImages([1, 2], 0)).toThrow();
  });
});
