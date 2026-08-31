import { describe, it, expect } from "vitest";
import { parsePrice } from "../src/fanza/priceUtils.js";

describe("parsePrice", () => {
  it("parses a plain numeric string", () => {
    expect(parsePrice("1000")).toBe(1000);
  });

  it("parses a range-style string by taking the leading number", () => {
    expect(parsePrice("100~")).toBe(100);
  });

  it("returns null for undefined", () => {
    expect(parsePrice(undefined)).toBeNull();
  });

  it("returns null when there is no digit", () => {
    expect(parsePrice("価格未定")).toBeNull();
  });
});
