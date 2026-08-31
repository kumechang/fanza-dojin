import { describe, it, expect } from "vitest";
import { extractRejectionReason } from "../src/db/repositories/postsRepo.js";

describe("extractRejectionReason", () => {
  it("returns null when the comment is just the keyword", () => {
    expect(extractRejectionReason("却下")).toBeNull();
  });

  it("returns the remaining text as the reason", () => {
    expect(extractRejectionReason("却下 もう少し日常的な感じがいい")).toBe("もう少し日常的な感じがいい");
  });

  it("strips the keyword wherever it appears", () => {
    expect(extractRejectionReason("これは却下、広告っぽすぎる")).toBe("これは、広告っぽすぎる");
  });
});
