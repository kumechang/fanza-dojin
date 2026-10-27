import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertCandidate,
  getPendingCandidates,
  markAnalyzed,
  markAnalysisFailed,
  getAnalyzedCandidatesOrderedByRank,
  countAnalyzedCandidates,
} from "../src/db/repositories/fanzaCandidatesRepo.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

const EPOCH = "1970-01-01 00:00:00";

function baseInput(overrides: Partial<Parameters<typeof upsertCandidate>[1]> = {}) {
  return {
    content_id: "a1",
    title: "作品a1",
    affiliate_url: "https://example.com",
    sample_image_urls: ["https://example.com/1.jpg"],
    price: 100,
    list_price: 300,
    campaign_title: "30%OFF",
    genre_names: [],
    review_count: null,
    review_average: null,
    rank_order: 1,
    ...overrides,
  };
}

describe("fanzaCandidatesRepo", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("inserts a new candidate as pending", () => {
    upsertCandidate(db, baseInput());
    const row = db.prepare(`SELECT * FROM fanza_candidates WHERE content_id = 'a1'`).get() as { redaction_status: string };
    expect(row.redaction_status).toBe("pending");
  });

  it("updates metadata on re-upsert without resetting analysis when images are unchanged", () => {
    upsertCandidate(db, baseInput());
    const before = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = 'a1'`).get() as { id: number };
    markAnalyzed(db, before.id, 0.01, []);

    upsertCandidate(db, baseInput({ price: 90, title: "作品a1(改題)" }));

    const row = db.prepare(`SELECT redaction_status, redaction_ratio, price, title FROM fanza_candidates WHERE content_id = 'a1'`).get() as {
      redaction_status: string;
      redaction_ratio: number;
      price: number;
      title: string;
    };
    expect(row.redaction_status).toBe("analyzed");
    expect(row.redaction_ratio).toBeCloseTo(0.01);
    expect(row.price).toBe(90);
    expect(row.title).toBe("作品a1(改題)");
  });

  it("resets analysis to pending when sample_image_urls change", () => {
    upsertCandidate(db, baseInput());
    const before = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = 'a1'`).get() as { id: number };
    markAnalyzed(db, before.id, 0.01, []);

    upsertCandidate(db, baseInput({ sample_image_urls: ["https://example.com/2.jpg"] }));

    const row = db.prepare(`SELECT redaction_status, redaction_ratio FROM fanza_candidates WHERE content_id = 'a1'`).get() as {
      redaction_status: string;
      redaction_ratio: number | null;
    };
    expect(row.redaction_status).toBe("pending");
    expect(row.redaction_ratio).toBeNull();
  });

  it("getPendingCandidates respects the limit", () => {
    upsertCandidate(db, baseInput({ content_id: "a1" }));
    upsertCandidate(db, baseInput({ content_id: "a2" }));
    expect(getPendingCandidates(db, 1)).toHaveLength(1);
    expect(getPendingCandidates(db, 10)).toHaveLength(2);
  });

  it("markAnalysisFailed leaves the candidate out of getAnalyzedCandidatesOrderedByRank", () => {
    upsertCandidate(db, baseInput());
    const row = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = 'a1'`).get() as { id: number };
    markAnalysisFailed(db, row.id);

    expect(getAnalyzedCandidatesOrderedByRank(db, EPOCH)).toHaveLength(0);
  });

  it("getAnalyzedCandidatesOrderedByRank orders by rank_order and excludes pending/failed rows", () => {
    upsertCandidate(db, baseInput({ content_id: "a1", rank_order: 10 }));
    upsertCandidate(db, baseInput({ content_id: "a2", rank_order: 5 }));
    upsertCandidate(db, baseInput({ content_id: "a3", rank_order: 1 }));
    const a1 = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = 'a1'`).get() as { id: number };
    const a2 = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = 'a2'`).get() as { id: number };
    markAnalyzed(db, a1.id, 0.01, []);
    markAnalyzed(db, a2.id, 0.01, []);
    // a3はpendingのまま(未解析)

    const rows = getAnalyzedCandidatesOrderedByRank(db, EPOCH);
    expect(rows.map((r) => r.content_id)).toEqual(["a2", "a1"]);
  });

  const lastSeen = (contentId: string) =>
    (db.prepare(`SELECT last_seen_at FROM fanza_candidates WHERE content_id = ?`).get(contentId) as {
      last_seen_at: string | null;
    }).last_seen_at;

  it("records last_seen_at on insert and refreshes it on every re-upsert", () => {
    upsertCandidate(db, baseInput());
    expect(lastSeen("a1")).not.toBeNull();

    db.prepare(`UPDATE fanza_candidates SET last_seen_at = '2000-01-01 00:00:00' WHERE content_id = 'a1'`).run();
    upsertCandidate(db, baseInput());
    expect(lastSeen("a1")! > "2000-01-01 00:00:00").toBe(true);
  });

  it("getAnalyzedCandidatesOrderedByRank excludes rows not seen since the cutoff, including never-seen (NULL) rows", () => {
    for (const id of ["fresh", "stale", "never"]) upsertCandidate(db, baseInput({ content_id: id }));
    for (const id of ["fresh", "stale", "never"]) {
      const row = db.prepare(`SELECT id FROM fanza_candidates WHERE content_id = ?`).get(id) as { id: number };
      markAnalyzed(db, row.id, 0, []);
    }
    db.prepare(`UPDATE fanza_candidates SET last_seen_at = '2026-10-27 00:00:00' WHERE content_id = 'fresh'`).run();
    db.prepare(`UPDATE fanza_candidates SET last_seen_at = '2026-10-25 00:00:00' WHERE content_id = 'stale'`).run();
    db.prepare(`UPDATE fanza_candidates SET last_seen_at = NULL WHERE content_id = 'never'`).run();

    const rows = getAnalyzedCandidatesOrderedByRank(db, "2026-10-26 00:00:00");
    expect(rows.map((r) => r.content_id)).toEqual(["fresh"]);
    // 期限切れでも解析結果自体は残っている(セール復活時に再解析不要)
    expect(countAnalyzedCandidates(db)).toBe(3);
  });
});
