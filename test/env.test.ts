import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { filterActiveAccounts } from "../src/lib/env.js";

// listXAccounts()はモジュール内でメモ化するため、環境変数を切り替えてテストするには
// 毎回モジュールキャッシュをリセットして再importする必要がある。
// 値を"未設定"にする際は delete ではなく空文字列を使う: env.tsは`import "dotenv/config"`しており、
// dotenvはprocess.env[key]===undefinedの場合だけ.envの値で埋めるため、deleteすると
// .envに実際に設定された値(開発者のローカルX_ACCOUNTS_JSON等)で上書きされてテストが不安定になる。

describe("listXAccounts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns an empty array when unset", async () => {
    process.env.X_ACCOUNTS_JSON = "";
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(listXAccounts()).toEqual([]);
  });

  it("parses a valid JSON array", async () => {
    process.env.X_ACCOUNTS_JSON = JSON.stringify([
      { name: "a", accessToken: "t1", accessSecret: "s1" },
      { name: "b", accessToken: "t2", accessSecret: "s2" },
    ]);
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(listXAccounts()).toEqual([
      { name: "a", accessToken: "t1", accessSecret: "s1" },
      { name: "b", accessToken: "t2", accessSecret: "s2" },
    ]);
  });

  it("throws on invalid JSON", async () => {
    process.env.X_ACCOUNTS_JSON = "{not json";
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(() => listXAccounts()).toThrow(/not valid JSON/);
  });

  it("throws when the JSON is not an array", async () => {
    process.env.X_ACCOUNTS_JSON = JSON.stringify({ name: "a" });
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(() => listXAccounts()).toThrow(/must be a JSON array/);
  });

  it("throws when an entry is missing a required field", async () => {
    process.env.X_ACCOUNTS_JSON = JSON.stringify([{ name: "a", accessToken: "t1" }]);
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(() => listXAccounts()).toThrow(/must have string fields/);
  });

  it("throws on duplicate account names", async () => {
    process.env.X_ACCOUNTS_JSON = JSON.stringify([
      { name: "a", accessToken: "t1", accessSecret: "s1" },
      { name: "a", accessToken: "t2", accessSecret: "s2" },
    ]);
    const { listXAccounts } = await import("../src/lib/env.js");
    expect(() => listXAccounts()).toThrow(/duplicate account name/);
  });
});

describe("hasXCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("is false when the account is not in X_ACCOUNTS_JSON", async () => {
    process.env.X_API_KEY = "key";
    process.env.X_API_SECRET = "secret";
    process.env.X_ACCOUNTS_JSON = JSON.stringify([{ name: "a", accessToken: "t", accessSecret: "s" }]);
    const { hasXCredentials } = await import("../src/lib/env.js");
    expect(hasXCredentials("unknown")).toBe(false);
  });

  it("is true when the app key/secret and account both exist", async () => {
    process.env.X_API_KEY = "key";
    process.env.X_API_SECRET = "secret";
    process.env.X_ACCOUNTS_JSON = JSON.stringify([{ name: "a", accessToken: "t", accessSecret: "s" }]);
    const { hasXCredentials } = await import("../src/lib/env.js");
    expect(hasXCredentials("a")).toBe(true);
  });
});

describe("filterActiveAccounts", () => {
  const accounts = [
    { name: "a", accessToken: "t1", accessSecret: "s1" },
    { name: "b", accessToken: "t2", accessSecret: "s2" },
  ];

  it("excludes accounts listed in pausedAccountNames", () => {
    expect(filterActiveAccounts(accounts, ["a"])).toEqual([accounts[1]]);
  });

  it("returns all accounts when pausedAccountNames is empty", () => {
    expect(filterActiveAccounts(accounts, [])).toEqual(accounts);
  });

  it("ignores paused names that don't match any account", () => {
    expect(filterActiveAccounts(accounts, ["unknown"])).toEqual(accounts);
  });
});
