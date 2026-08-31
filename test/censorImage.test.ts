import { describe, it, expect } from "vitest";
import { parseCensorOutput } from "../src/x/censorImage.js";

describe("parseCensorOutput", () => {
  it("parses a well-formed result array", () => {
    const stdout = JSON.stringify([{ input: "a", output: "b", detections: [] }]);
    expect(parseCensorOutput(stdout, 1)).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseCensorOutput("not json", 1)).toThrow(/not valid JSON/);
  });

  it("throws when the result count does not match", () => {
    const stdout = JSON.stringify([{ input: "a", output: "b", detections: [] }]);
    expect(() => parseCensorOutput(stdout, 2)).toThrow(/unexpected result shape/);
  });

  it("throws when the output is not an array", () => {
    const stdout = JSON.stringify({ input: "a" });
    expect(() => parseCensorOutput(stdout, 1)).toThrow(/unexpected result shape/);
  });
});
