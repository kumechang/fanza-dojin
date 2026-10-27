import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { ensureSchema } from "../src/db/client.js";

// last_seen_at追加前から存在する本番DBを模したfanza_candidatesテーブル(列が足りない状態)。
const OLD_FANZA_CANDIDATES = `
  CREATE TABLE fanza_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    affiliate_url TEXT NOT NULL,
    sample_image_urls TEXT NOT NULL,
    price INTEGER, list_price INTEGER, campaign_title TEXT, genre_names TEXT,
    review_count INTEGER, review_average REAL, rank_order INTEGER,
    redaction_status TEXT NOT NULL DEFAULT 'pending',
    redaction_ratio REAL, redaction_detail TEXT, analyzed_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT
  )`;

const hasColumn = (db: Database.Database, table: string, column: string) =>
  Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));

describe("ensureSchema", () => {
  it("creates the full schema, including last_seen_at, on an empty database", () => {
    const db = new Database(":memory:");
    ensureSchema(db);
    expect(hasColumn(db, "fanza_candidates", "last_seen_at")).toBe(true);
    expect(hasColumn(db, "posts", "account_name")).toBe(true);
  });

  it("adds last_seen_at to an existing fanza_candidates table, keeping rows (as never-seen/NULL)", () => {
    const db = new Database(":memory:");
    db.exec(OLD_FANZA_CANDIDATES);
    db.prepare(
      `INSERT INTO fanza_candidates (content_id, title, affiliate_url, sample_image_urls, redaction_status) VALUES ('d_1', 't', 'u', '[]', 'analyzed')`
    ).run();

    ensureSchema(db);

    expect(hasColumn(db, "fanza_candidates", "last_seen_at")).toBe(true);
    const row = db.prepare(`SELECT redaction_status, last_seen_at FROM fanza_candidates WHERE content_id = 'd_1'`).get();
    expect(row).toEqual({ redaction_status: "analyzed", last_seen_at: null });
  });

  it("is idempotent", () => {
    const db = new Database(":memory:");
    db.exec(OLD_FANZA_CANDIDATES);
    ensureSchema(db);
    expect(() => ensureSchema(db)).not.toThrow();
  });
});
