import { describe, it, expect } from "vitest";
import { isComic, isDiscounted } from "../src/fanza/filterCandidates.js";
import type { FanzaItem } from "../src/fanza/types.js";

function baseItem(overrides: Partial<FanzaItem> = {}): FanzaItem {
  return {
    content_id: "d_123",
    title: "テスト作品",
    affiliateURL: "https://example.com",
    ...overrides,
  };
}

describe("isComic", () => {
  it("returns true when imageURL.large is under /digital/comic/", () => {
    const item = baseItem({ imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/comic/d_123/d_123pl.jpg" } });
    expect(isComic(item)).toBe(true);
  });

  it("returns false for other media paths (game/cg/voice)", () => {
    expect(
      isComic(baseItem({ imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/game/d_123/d_123pl.jpg" } }))
    ).toBe(false);
    expect(
      isComic(baseItem({ imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/cg/d_123/d_123pl.jpg" } }))
    ).toBe(false);
    expect(
      isComic(baseItem({ imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/voice/d_123/d_123pl.jpg" } }))
    ).toBe(false);
  });

  it("returns false when imageURL is missing", () => {
    expect(isComic(baseItem())).toBe(false);
  });
});

describe("isDiscounted", () => {
  it("returns true when a campaign is present", () => {
    const item = baseItem({ campaign: [{ title: "30%OFF" }] });
    expect(isDiscounted(item)).toBe(true);
  });

  it("returns false when campaign is empty even if price is below list_price", () => {
    // 実地調査の結果、campaignなしでも定価より安い「常時セール価格」の作品が多く見つかったため、
    // 「値引きキャンペーンが行われている」の判定にはprice比較を使わない。
    const item = baseItem({ prices: { price: "100", list_price: "300" } });
    expect(isDiscounted(item)).toBe(false);
  });

  it("returns false when there is no campaign at all", () => {
    expect(isDiscounted(baseItem())).toBe(false);
  });
});
