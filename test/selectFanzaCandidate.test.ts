import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { selectFanzaCandidate } from "../src/fanza/selectCandidate.js";
import { createPost } from "../src/db/repositories/postsRepo.js";
import type { AppConfig } from "../src/config/types.js";
import type { FanzaItem } from "../src/fanza/types.js";
import type { FetchItemListResult } from "../src/fanza/client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

function markUsed(db: Database.Database, accountName: string, contentId: string): void {
  const id = createPost(db, {
    platform: "X",
    account_name: accountName,
    content_id: contentId,
    title: "used",
    affiliate_url: "https://example.com",
    sample_image_urls: [],
    price: null,
    list_price: null,
    campaign_title: null,
    genre_names: [],
    review_count: null,
    review_average: null,
    fetch_offset: 1,
    run_id: null,
  });
  db.prepare(`UPDATE posts SET status = 'posted' WHERE id = ?`).run(id);
}

function comicItem(contentId: string, overrides: Partial<FanzaItem> = {}): FanzaItem {
  return {
    content_id: contentId,
    title: `作品${contentId}`,
    affiliateURL: "https://example.com",
    imageURL: { large: `https://doujin-assets.dmm.co.jp/digital/comic/${contentId}/${contentId}pl.jpg` },
    campaign: [{ title: "30%OFF" }],
    ...overrides,
  };
}

function baseConfig(): AppConfig {
  return {
    approvalMode: "manual",
    claudeModel: "claude-sonnet-5",
    platform: "X",
    xCharLimit: 280,
    postingWindow: { startHour: 7, endHour: 23 },
    targetPostsPerDay: 4,
    minSpacingHours: 2,
    censorSampleImages: true,
    fanza: {
      site: "FANZA",
      service: "doujin",
      floor: "digital_doujin",
      hits: 100,
      maxPages: 3,
      imagesPerTweet: 2,
    },
  };
}

describe("selectFanzaCandidate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("picks the first item that is discounted, comic-genre, and unused", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({
      items: [comicItem("a1"), comicItem("a2")],
      totalCount: 2,
    });

    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result?.item.content_id).toBe("a1");
  });

  it("skips items that have already been used (approved/posted)", async () => {
    markUsed(db, "account1", "a1");
    const fetchFn = async (): Promise<FetchItemListResult> => ({
      items: [comicItem("a1"), comicItem("a2")],
      totalCount: 2,
    });

    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result?.item.content_id).toBe("a2");
  });

  it("does not exclude a content_id used by a different account", async () => {
    markUsed(db, "account2", "a1");
    const fetchFn = async (): Promise<FetchItemListResult> => ({
      items: [comicItem("a1"), comicItem("a2")],
      totalCount: 2,
    });

    // 重複防止はアカウント単位のみ。account2が使用済みでもaccount1からは選べる(要件通り)。
    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result?.item.content_id).toBe("a1");
  });

  it("skips non-comic items (imageURL path not under /digital/comic/)", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({
      items: [
        comicItem("a1", { imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/voice/a1/a1pl.jpg" } }),
        comicItem("a2"),
      ],
      totalCount: 2,
    });

    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result?.item.content_id).toBe("a2");
  });

  it("skips items that are not discounted (no campaign)", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({
      items: [comicItem("a1", { campaign: undefined, prices: { price: "100", list_price: "300" } }), comicItem("a2")],
      totalCount: 2,
    });

    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result?.item.content_id).toBe("a2");
  });

  it("pages through offsets and returns null after exhausting maxPages", async () => {
    const offsetsSeen: number[] = [];
    const fetchFn = async (params: { offset: number }): Promise<FetchItemListResult> => {
      offsetsSeen.push(params.offset);
      return { items: [comicItem(`unused-but-not-eligible-${params.offset}`, { campaign: undefined })], totalCount: 1 };
    };

    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result).toBeNull();
    expect(offsetsSeen).toEqual([1, 101, 201]);
  });

  it("stops early when a page returns no items", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({ items: [], totalCount: 0 });
    const result = await selectFanzaCandidate(db, baseConfig(), "account1", fetchFn);
    expect(result).toBeNull();
  });
});
