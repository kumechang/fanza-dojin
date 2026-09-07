import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { EUploadMimeType } from "twitter-api-v2";
import { analyzeCandidatePool } from "../src/pipeline/analyzeCandidatePool.js";
import { upsertCandidate } from "../src/db/repositories/fanzaCandidatesRepo.js";
import type { AppConfig } from "../src/config/types.js";
import type { DownloadedImage } from "../src/x/mediaUpload.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

function baseConfig(overrides: Partial<AppConfig["fanza"]> = {}): AppConfig {
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
      ...overrides,
    },
  };
}

function addPendingCandidate(db: Database.Database, contentId: string, sampleImageUrls: string[] = ["https://example.com/a.jpg"]): void {
  upsertCandidate(db, {
    content_id: contentId,
    title: `作品${contentId}`,
    affiliate_url: "https://example.com",
    sample_image_urls: sampleImageUrls,
    price: 100,
    list_price: 300,
    campaign_title: "30%OFF",
    genre_names: [],
    review_count: null,
    review_average: null,
    rank_order: 1,
  });
}

const dummyImage: DownloadedImage = { buffer: Buffer.from(""), mimeType: EUploadMimeType.Jpeg };

describe("analyzeCandidatePool", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("marks a candidate analyzed with the max redaction ratio across its sample images", async () => {
    addPendingCandidate(db, "a1", ["https://example.com/1.jpg", "https://example.com/2.jpg"]);

    const result = await analyzeCandidatePool(db, baseConfig(), {
      downloadFn: async () => dummyImage,
      analyzeFn: async () => [
        { redactionRatio: 0.02, detections: [] },
        { redactionRatio: 0.4, detections: [] },
      ],
    });

    expect(result).toEqual({ analyzed: 1, failed: 0 });
    const row = db.prepare(`SELECT redaction_status, redaction_ratio FROM fanza_candidates WHERE content_id = 'a1'`).get() as {
      redaction_status: string;
      redaction_ratio: number;
    };
    expect(row.redaction_status).toBe("analyzed");
    expect(row.redaction_ratio).toBeCloseTo(0.4);
  });

  it("marks analysis_failed when censorship analysis throws", async () => {
    addPendingCandidate(db, "a1");

    const result = await analyzeCandidatePool(db, baseConfig(), {
      downloadFn: async () => dummyImage,
      analyzeFn: async () => {
        throw new Error("model unavailable");
      },
    });

    expect(result).toEqual({ analyzed: 0, failed: 1 });
    const row = db.prepare(`SELECT redaction_status FROM fanza_candidates WHERE content_id = 'a1'`).get() as {
      redaction_status: string;
    };
    expect(row.redaction_status).toBe("analysis_failed");
  });

  it("marks analysis_failed when a candidate has no sample images, without calling analyzeFn", async () => {
    addPendingCandidate(db, "a1", []);
    let analyzeCalled = false;

    const result = await analyzeCandidatePool(db, baseConfig(), {
      downloadFn: async () => dummyImage,
      analyzeFn: async () => {
        analyzeCalled = true;
        return [];
      },
    });

    expect(result).toEqual({ analyzed: 0, failed: 1 });
    expect(analyzeCalled).toBe(false);
  });

  it("only processes up to maxAnalysisPerRun pending candidates", async () => {
    addPendingCandidate(db, "a1");
    addPendingCandidate(db, "a2");
    addPendingCandidate(db, "a3");

    const result = await analyzeCandidatePool(db, baseConfig({ maxAnalysisPerRun: 2 }), {
      downloadFn: async () => dummyImage,
      analyzeFn: async () => [{ redactionRatio: 0.01, detections: [] }],
    });

    expect(result.analyzed + result.failed).toBe(2);
    const pendingCount = db
      .prepare(`SELECT COUNT(*) as c FROM fanza_candidates WHERE redaction_status = 'pending'`)
      .get() as { c: number };
    expect(pendingCount.c).toBe(1);
  });
});
