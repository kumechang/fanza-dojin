import { describe, it, expect } from "vitest";
import { selectPostablePageIndices, isWorkPostable } from "../src/fanza/redactionPolicy.js";

describe("selectPostablePageIndices", () => {
  it("keeps pages at or below the threshold and drops pages above it", () => {
    const detail = [{ redactionRatio: 0.02 }, { redactionRatio: 0.31 }, { redactionRatio: 0.3 }, { redactionRatio: 0.9 }];
    expect(selectPostablePageIndices(detail, 0.3)).toEqual([0, 2]);
  });

  it("returns all indices when every page is under the threshold", () => {
    const detail = [{ redactionRatio: 0 }, { redactionRatio: 0.1 }];
    expect(selectPostablePageIndices(detail, 0.3)).toEqual([0, 1]);
  });

  it("returns an empty array when every page exceeds the threshold", () => {
    const detail = [{ redactionRatio: 0.9 }, { redactionRatio: 1 }];
    expect(selectPostablePageIndices(detail, 0.3)).toEqual([]);
  });
});

describe("isWorkPostable", () => {
  it("is postable when the fraction of unpostable pages is at or below the limit", () => {
    // 10ページ中5ページが投稿不可(=50%)、上限50%ちょうどなのでpostable
    const detail = [0.9, 0.9, 0.9, 0.9, 0.9, 0, 0, 0, 0, 0].map((redactionRatio) => ({ redactionRatio }));
    expect(isWorkPostable(detail, 0.3, 0.5)).toBe(true);
  });

  it("is not postable when the fraction of unpostable pages exceeds the limit", () => {
    // 10ページ中6ページが投稿不可(=60% > 50%)
    const detail = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0, 0, 0, 0].map((redactionRatio) => ({ redactionRatio }));
    expect(isWorkPostable(detail, 0.3, 0.5)).toBe(false);
  });

  it("is not postable when there are no sample images at all", () => {
    expect(isWorkPostable([], 0.3, 0.5)).toBe(false);
  });

  it("is postable when every page is well within the per-page threshold", () => {
    const detail = [{ redactionRatio: 0 }, { redactionRatio: 0.02 }, { redactionRatio: 0.1 }];
    expect(isWorkPostable(detail, 0.3, 0.5)).toBe(true);
  });
});
