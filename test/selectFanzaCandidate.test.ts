import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { selectFanzaCandidate } from "../src/fanza/selectCandidate.js";
import { upsertCandidate, markAnalyzed } from "../src/db/repositories/fanzaCandidatesRepo.js";
import { createPost } from "../src/db/repositories/postsRepo.js";
import type { AppConfig } from "../src/config/types.js";

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

// プールに1件追加し、指定のredaction_ratioで解析済みにする(analyzed=デフォルト)。
function addAnalyzedCandidate(
  db: Database.Database,
  contentId: string,
  overrides: { rankOrder?: number; redactionRatio?: number } = {}
): void {
  upsertCandidate(db, {
    content_id: contentId,
    title: `作品${contentId}`,
    affiliate_url: "https://example.com",
    sample_image_urls: [`https://example.com/${contentId}.jpg`],
    price: 100,
    list_price: 300,
    campaign_title: "30%OFF",
    genre_names: [],
    review_count: null,
    review_average: null,
    rank_order: overrides.rankOrder ?? 1,
  });
  const row = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = ?`).get(contentId) as { id: number };
  markAnalyzed(db, row.id, overrides.redactionRatio ?? 0, []);
}

function addPendingCandidate(db: Database.Database, contentId: string): void {
  upsertCandidate(db, {
    content_id: contentId,
    title: `作品${contentId}`,
    affiliate_url: "https://example.com",
    sample_image_urls: [`https://example.com/${contentId}.jpg`],
    price: 100,
    list_price: 300,
    campaign_title: "30%OFF",
    genre_names: [],
    review_count: null,
    review_average: null,
    rank_order: 1,
  });
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
      poolFetchPages: 5,
      maxAnalysisPerRun: 20,
      maxRedactionRatio: 0.05,
    },
  };
}

describe("selectFanzaCandidate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("picks an analyzed, low-redaction, unused candidate from the pool", () => {
    addAnalyzedCandidate(db, "a1", { redactionRatio: 0.02 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a1");
  });

  it("returns null when the pool is empty", () => {
    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result).toBeNull();
  });

  it("skips candidates that are still pending analysis", () => {
    addPendingCandidate(db, "a1");
    addAnalyzedCandidate(db, "a2", { redactionRatio: 0.02 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a2");
  });

  it("skips candidates whose redaction_ratio exceeds maxRedactionRatio", () => {
    addAnalyzedCandidate(db, "a1", { redactionRatio: 0.5 });
    addAnalyzedCandidate(db, "a2", { redactionRatio: 0.01, rankOrder: 2 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a2");
  });

  it("skips candidates that have already been used (approved/posted) by this account", () => {
    markUsed(db, "account1", "a1");
    addAnalyzedCandidate(db, "a1", { redactionRatio: 0.01 });
    addAnalyzedCandidate(db, "a2", { redactionRatio: 0.01, rankOrder: 2 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a2");
  });

  it("does not exclude a content_id used by a different account", () => {
    markUsed(db, "account2", "a1");
    addAnalyzedCandidate(db, "a1", { redactionRatio: 0.01 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a1");
  });

  it("prefers the better-ranked candidate among eligible ones", () => {
    addAnalyzedCandidate(db, "a1", { redactionRatio: 0.01, rankOrder: 50 });
    addAnalyzedCandidate(db, "a2", { redactionRatio: 0.01, rankOrder: 5 });

    const result = selectFanzaCandidate(db, baseConfig(), "account1");
    expect(result?.contentId).toBe("a2");
  });
});
