import { describe, it, expect } from "vitest";
import { getJstDateString, parseDbTimestamp, getJstHour, formatDbTimestamp } from "../src/lib/time.js";

describe("getJstDateString", () => {
  it("returns the JST calendar date, which can differ from the UTC date", () => {
    // UTC 2026-08-29 15:02 = JST 2026-08-30 00:02 (日付をまたぐ)
    expect(getJstDateString(new Date("2026-08-29T15:02:34Z"))).toBe("2026-08-30");
    expect(getJstDateString(new Date("2026-08-29T01:00:00Z"))).toBe("2026-08-29");
  });
});

describe("parseDbTimestamp", () => {
  it("parses SQLite's CURRENT_TIMESTAMP format as UTC", () => {
    const parsed = parseDbTimestamp("2026-08-29 15:02:34");
    expect(parsed.toISOString()).toBe("2026-08-29T15:02:34.000Z");
    expect(getJstHour(parsed)).toBe(0); // JST 00:02
  });
});

describe("formatDbTimestamp", () => {
  it("formats as SQLite CURRENT_TIMESTAMP-style UTC and round-trips with parseDbTimestamp", () => {
    const date = new Date("2026-10-27T01:49:57.123Z");
    expect(formatDbTimestamp(date)).toBe("2026-10-27 01:49:57");
    expect(parseDbTimestamp(formatDbTimestamp(date)).getTime()).toBe(date.getTime() - 123);
  });

  it("sorts lexicographically in chronological order (relied on by SQL comparisons)", () => {
    expect(formatDbTimestamp(new Date("2026-10-26T23:59:59Z")) < formatDbTimestamp(new Date("2026-10-27T00:00:00Z"))).toBe(true);
  });
});
