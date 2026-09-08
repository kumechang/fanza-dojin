import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { fetchCandidatePool } from "../src/pipeline/fetchCandidatePool.js";
import type { AppConfig } from "../src/config/types.js";
import type { FanzaItem } from "../src/fanza/types.js";
import type { FetchItemListResult } from "../src/fanza/client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
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
      imagesPerTweet: 2,
      poolFetchPages: 3,
      maxAnalysisPerRun: 20,
      maxPageRedactionRatio: 0.3,
      maxUnpostablePageRatio: 0.5,
    },
  };
}

describe("fetchCandidatePool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("pools comic and discounted items only, skipping non-comic/non-discounted ones", async () => {
    const fetchFn = async (params: { offset: number }): Promise<FetchItemListResult> => {
      if (params.offset > 1) return { items: [], totalCount: 0 };
      return {
        items: [
          comicItem("a1"),
          comicItem("a2", { imageURL: { large: "https://doujin-assets.dmm.co.jp/digital/voice/a2/a2pl.jpg" } }),
          comicItem("a3", { campaign: undefined }),
        ],
        totalCount: 3,
      };
    };

    const result = await fetchCandidatePool(db, baseConfig(), fetchFn);
    expect(result.scanned).toBe(3);
    expect(result.pooled).toBe(1);

    const rows = db.prepare(`SELECT content_id FROM fanza_candidates`).all() as { content_id: string }[];
    expect(rows.map((r) => r.content_id)).toEqual(["a1"]);
  });

  it("marks newly pooled items as pending analysis", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({ items: [comicItem("a1")], totalCount: 1 });

    await fetchCandidatePool(db, baseConfig(), fetchFn);

    const row = db.prepare(`SELECT redaction_status FROM fanza_candidates WHERE content_id = 'a1'`).get() as {
      redaction_status: string;
    };
    expect(row.redaction_status).toBe("pending");
  });

  it("stops paging once a page returns no items", async () => {
    const offsetsSeen: number[] = [];
    const fetchFn = async (params: { offset: number }): Promise<FetchItemListResult> => {
      offsetsSeen.push(params.offset);
      if (params.offset > 1) return { items: [], totalCount: 0 };
      return { items: [comicItem("a1")], totalCount: 1 };
    };

    await fetchCandidatePool(db, baseConfig(), fetchFn);
    expect(offsetsSeen).toEqual([1, 101]);
  });

  it("upserts by content_id instead of duplicating rows across pages/runs", async () => {
    const fetchFn = async (): Promise<FetchItemListResult> => ({ items: [comicItem("a1")], totalCount: 1 });

    await fetchCandidatePool(db, baseConfig(), fetchFn);
    await fetchCandidatePool(db, baseConfig(), fetchFn);

    const rows = db.prepare(`SELECT content_id FROM fanza_candidates`).all() as { content_id: string }[];
    expect(rows).toHaveLength(1);
  });
});
