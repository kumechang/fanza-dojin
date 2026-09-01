import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { computePostingProbability, countRemainingActiveHours, shouldGenerateNow } from "../src/pipeline/shouldGenerateNow.js";
import type { AppConfig } from "../src/config/types.js";

describe("computePostingProbability", () => {
  it("returns 0 once the daily target is already met", () => {
    expect(
      computePostingProbability({
        remainingTarget: 0,
        remainingActiveHours: 5,
        hourWeight: 1,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBe(0);
    expect(
      computePostingProbability({
        remainingTarget: -1,
        remainingActiveHours: 5,
        hourWeight: 1,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBe(0);
  });

  it("returns 1 once remaining time no longer has slack beyond what minSpacingHours requires, so the target isn't missed", () => {
    // remainingTarget(2) * minSpacingHours(2) = 4時間が締切。remainingActiveHoursがそれ以下なら必ず生成する。
    expect(
      computePostingProbability({
        remainingTarget: 2,
        remainingActiveHours: 4,
        hourWeight: 1,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBe(1);
    expect(
      computePostingProbability({
        remainingTarget: 2,
        remainingActiveHours: 1,
        hourWeight: 1,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBe(1);
  });

  it("still spreads probabilistically while there is slack beyond the minSpacingHours deadline", () => {
    // 締切(2*2=4時間)より残り時間が多いうちは、確率的なペース配分のまま。
    expect(
      computePostingProbability({
        remainingTarget: 2,
        remainingActiveHours: 8,
        hourWeight: 1,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBeCloseTo(0.25);
  });

  it("boosts probability for above-average hours and suppresses below-average ones", () => {
    const high = computePostingProbability({
      remainingTarget: 2,
      remainingActiveHours: 8,
      hourWeight: 2,
      averageWeight: 1,
      minSpacingHours: 2,
    });
    const low = computePostingProbability({
      remainingTarget: 2,
      remainingActiveHours: 8,
      hourWeight: 0.5,
      averageWeight: 1,
      minSpacingHours: 2,
    });
    expect(high).toBeCloseTo(0.5);
    expect(low).toBeCloseTo(0.125);
  });

  it("clamps the result to [0, 1]", () => {
    expect(
      computePostingProbability({
        remainingTarget: 10,
        remainingActiveHours: 2,
        hourWeight: 5,
        averageWeight: 1,
        minSpacingHours: 2,
      })
    ).toBe(1);
  });
});

describe("countRemainingActiveHours (overnight window, startHour > endHour)", () => {
  const config = { postingWindow: { startHour: 22, endHour: 2 } } as AppConfig;

  it("counts across midnight when still before it", () => {
    // JST 22:00, endHourは翌2時=26時扱いなので残り4時間
    expect(countRemainingActiveHours(new Date("2026-08-29T13:00:00Z"), config)).toBe(4);
  });

  it("counts normally once past midnight", () => {
    // JST 0:00, 終了は2時なので残り2時間
    expect(countRemainingActiveHours(new Date("2026-08-29T15:00:00Z"), config)).toBe(2);
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const schema = readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

// createdAtIso: ISO 8601 ("...T...Z")で受け取り、SQLiteのCURRENT_TIMESTAMPと同じ
// "YYYY-MM-DD HH:MM:SS" 形式(スペース区切り、Zなし)に変換して保存する。
// 本番のcreated_atは常にこの形式で入るため、テストデータもそれに合わせる。
function insertPost(db: Database.Database, accountName: string, createdAtIso: string): void {
  const sqliteFormat = createdAtIso.replace("T", " ").replace("Z", "");
  db.prepare(
    `INSERT INTO posts (platform, account_name, content_id, title, affiliate_url, sample_image_urls, status, created_at)
     VALUES ('X', ?, 'test001', 'test title', 'https://example.com', '[]', 'pending_approval', ?)`
  ).run(accountName, sqliteFormat);
}

describe("shouldGenerateNow", () => {
  let db: Database.Database;
  const config = {
    postingWindow: { startHour: 7, endHour: 23 },
    targetPostsPerDay: 4,
    minSpacingHours: 2,
  } as AppConfig;

  beforeEach(() => {
    db = createTestDb();
  });

  it("refuses to generate within minSpacingHours of the last post", () => {
    // 直近投稿が30分前(minSpacingHours=2時間未満)
    insertPost(db, "account1", "2026-08-30T00:30:00Z"); // JST 09:30
    const now = new Date("2026-08-30T01:00:00Z"); // JST 10:00, 30分後
    expect(shouldGenerateNow(db, config, now, "account1")).toBe(false);
  });

  it("always generates once the target is unmet and it's the last active hour", () => {
    const now = new Date("2026-08-29T13:30:00Z"); // JST 22:30 (endHour=23の最終アクティブ時間)
    expect(shouldGenerateNow(db, config, now, "account1")).toBe(true);
  });

  it("forces generation well before the last hour once remaining time can no longer absorb misses (deadline safety net)", () => {
    // target=4・minSpacingHours=2なので締切は残り8時間。まだ無投稿でJST 18:00(残り5時間、endHour=23)は
    // 「最終アクティブ時間」ではないが、確率任せだと1日の最低投稿数を割り込みかねないため必ず生成する。
    const now = new Date("2026-08-29T09:00:00Z"); // JST 18:00
    expect(shouldGenerateNow(db, config, now, "account1")).toBe(true);
  });

  it("never generates once today's target has already been met", () => {
    for (let i = 0; i < 4; i++) {
      insertPost(db, "account1", `2026-08-30T0${i}:00:00Z`); // すべてJST内の今日
    }
    const now = new Date("2026-08-30T05:00:00Z"); // JST 14:00
    expect(shouldGenerateNow(db, config, now, "account1")).toBe(false);
  });

  it("does not let another account's posts affect this account's target/spacing", () => {
    // account2が直近30分前・当日4件投稿していても、account1の判定には影響しない
    insertPost(db, "account2", "2026-08-30T00:30:00Z");
    for (let i = 0; i < 4; i++) {
      insertPost(db, "account2", `2026-08-30T0${i}:00:00Z`);
    }
    const now = new Date("2026-08-29T13:30:00Z"); // JST 22:30, account1は無投稿
    expect(shouldGenerateNow(db, config, now, "account1")).toBe(true);
  });
});
