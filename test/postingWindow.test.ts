import { describe, it, expect } from "vitest";
import { getJstHour, isWithinPostingWindow } from "../src/lib/postingWindow.js";
import type { AppConfig } from "../src/config/types.js";

describe("getJstHour", () => {
  it("returns the correct hour for various JST times, including midnight", () => {
    expect(getJstHour(new Date("2026-08-29T15:02:34Z"))).toBe(0); // JST 00:02
    expect(getJstHour(new Date("2026-08-29T01:00:00Z"))).toBe(10); // JST 10:00
    expect(getJstHour(new Date("2026-08-29T14:59:00Z"))).toBe(23); // JST 23:59
  });
});

describe("isWithinPostingWindow", () => {
  const config = { postingWindow: { startHour: 7, endHour: 23 } } as AppConfig;

  it("rejects times outside the natural posting window (deep night)", () => {
    expect(isWithinPostingWindow(new Date("2026-08-29T15:02:34Z"), config)).toBe(false); // JST 0:02
  });

  it("accepts times inside the window", () => {
    expect(isWithinPostingWindow(new Date("2026-08-29T01:13:00Z"), config)).toBe(true); // JST 10:13
  });

  it("treats the boundary hours correctly (start inclusive, end exclusive)", () => {
    expect(isWithinPostingWindow(new Date("2026-08-28T22:00:00Z"), config)).toBe(true); // JST 7:00
    expect(isWithinPostingWindow(new Date("2026-08-29T14:00:00Z"), config)).toBe(false); // JST 23:00
  });
});

describe("isWithinPostingWindow (overnight window, startHour > endHour)", () => {
  const config = { postingWindow: { startHour: 22, endHour: 2 } } as AppConfig;

  it("accepts hours on the late-evening side (before midnight)", () => {
    expect(isWithinPostingWindow(new Date("2026-08-29T13:00:00Z"), config)).toBe(true); // JST 22:00
    expect(isWithinPostingWindow(new Date("2026-08-29T14:59:00Z"), config)).toBe(true); // JST 23:59
  });

  it("accepts hours on the early-morning side (after midnight)", () => {
    expect(isWithinPostingWindow(new Date("2026-08-29T15:00:00Z"), config)).toBe(true); // JST 0:00
    expect(isWithinPostingWindow(new Date("2026-08-29T16:59:00Z"), config)).toBe(true); // JST 1:59
  });

  it("rejects the end boundary and daytime hours", () => {
    expect(isWithinPostingWindow(new Date("2026-08-29T17:00:00Z"), config)).toBe(false); // JST 2:00
    expect(isWithinPostingWindow(new Date("2026-08-29T12:59:00Z"), config)).toBe(false); // JST 21:59
    expect(isWithinPostingWindow(new Date("2026-08-29T03:00:00Z"), config)).toBe(false); // JST 12:00
  });
});
