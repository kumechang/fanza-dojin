import { describe, it, expect } from "vitest";
import { buildCallbackData, parseCallbackData } from "../src/telegram/callbackData.js";

describe("callback data", () => {
  it("round-trips approve and reject", () => {
    expect(parseCallbackData(buildCallbackData("approve", 12))).toEqual({ action: "approve", postId: 12 });
    expect(parseCallbackData(buildCallbackData("reject", 3))).toEqual({ action: "reject", postId: 3 });
  });

  it("returns null for malformed or unknown data", () => {
    expect(parseCallbackData(undefined)).toBeNull();
    expect(parseCallbackData("")).toBeNull();
    expect(parseCallbackData("approve:")).toBeNull();
    expect(parseCallbackData("approve:abc")).toBeNull();
    expect(parseCallbackData("delete:1")).toBeNull();
    expect(parseCallbackData("approve:1;drop")).toBeNull();
  });
});
