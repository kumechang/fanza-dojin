import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { handleTelegramUpdates } from "../src/pipeline/handleTelegramUpdates.js";
import { createPost, getPostById, markPosted, markPostFailed, setLeadTweet } from "../src/db/repositories/postsRepo.js";
import type { AppConfig } from "../src/config/types.js";
import type { InlineButton, TelegramApi, TelegramUpdate } from "../src/telegram/client.js";

const OWNER = 111;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(readFileSync(path.resolve(process.cwd(), "schema.sql"), "utf-8"));
  return db;
}

function newPost(db: Database.Database): number {
  return createPost(db, {
    platform: "X",
    account_name: "acc",
    content_id: "d_1",
    title: "title",
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
}

function callback(postId: number, action: "approve" | "reject", fromId = OWNER, updateId = 1): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq${updateId}`,
      from: { id: fromId, username: "owner" },
      data: `${action}:${postId}`,
      message: { message_id: 50, text: "preview text", chat: { id: fromId } },
    },
  };
}

function fakeApi(updates: TelegramUpdate[], opts: { answerThrows?: boolean } = {}) {
  const log = {
    offsets: [] as (number | undefined)[],
    answers: [] as string[],
    edits: [] as { text: string; buttons?: InlineButton[] }[],
  };
  const api: TelegramApi = {
    async getUpdates(offset) {
      log.offsets.push(offset);
      return offset === undefined ? updates : [];
    },
    async answerCallbackQuery(_id, text) {
      if (opts.answerThrows) throw new Error("query is too old");
      log.answers.push(text ?? "");
    },
    async editMessageText(_chat, _msg, text, buttons) {
      log.edits.push({ text, buttons });
    },
  };
  return { api, log };
}

describe("handleTelegramUpdates", () => {
  let db: Database.Database;
  const config = {} as AppConfig;

  beforeEach(() => {
    db = createTestDb();
  });

  const run = (api: TelegramApi, finalize = async () => {}) =>
    handleTelegramUpdates(db, config, { api, finalize, allowedUserId: String(OWNER) });

  it("approves, finalizes the post, and reports the tweet url", async () => {
    const id = newPost(db);
    const { api, log } = fakeApi([callback(id, "approve", OWNER, 7)]);
    let finalizedStatus: string | undefined;

    const result = await run(api, async () => {
      finalizedStatus = getPostById(db, id)?.status;
      setLeadTweet(db, id, "t1", "https://x.com/acc/status/1");
      markPosted(db, id);
    });

    expect(result).toEqual({ approved: 1, rejected: 0, ignored: 0, failed: 0 });
    expect(finalizedStatus).toBe("approved");
    expect(getPostById(db, id)?.status).toBe("posted");
    expect(log.edits.at(-1)?.text).toContain("[投稿完了] https://x.com/acc/status/1");
    expect(log.edits.at(-1)?.buttons).toBeUndefined();
    expect(log.offsets).toEqual([undefined, 8]);
  });

  it("rejects without finalizing", async () => {
    const id = newPost(db);
    const { api, log } = fakeApi([callback(id, "reject")]);
    let finalized = false;

    const result = await run(api, async () => {
      finalized = true;
    });

    expect(result.rejected).toBe(1);
    expect(finalized).toBe(false);
    expect(getPostById(db, id)?.status).toBe("rejected");
    expect(log.edits.at(-1)?.text).toContain("[却下]");
  });

  it("ignores callbacks from anyone but the owner", async () => {
    const id = newPost(db);
    const { api } = fakeApi([callback(id, "approve", 999)]);
    let finalized = false;

    const result = await run(api, async () => {
      finalized = true;
    });

    expect(result.ignored).toBe(1);
    expect(finalized).toBe(false);
    expect(getPostById(db, id)?.status).toBe("pending_approval");
  });

  it("does nothing for an already posted post", async () => {
    const id = newPost(db);
    markPosted(db, id);
    const { api, log } = fakeApi([callback(id, "approve")]);
    let finalized = false;

    const result = await run(api, async () => {
      finalized = true;
    });

    expect(result.ignored).toBe(1);
    expect(finalized).toBe(false);
    expect(log.answers[0]).toContain("既に処理済み");
  });

  it("reports failure with retry button, and the retry succeeds from post_failed", async () => {
    const id = newPost(db);
    const first = fakeApi([callback(id, "approve", OWNER, 1)]);

    const failed = await run(first.api, async () => {
      markPostFailed(db, id, "X API error");
      throw new Error("X API error");
    });

    expect(failed.failed).toBe(1);
    const last = first.log.edits.at(-1)!;
    expect(last.text).toContain("[投稿失敗] X API error");
    expect(last.buttons?.map((b) => b.callback_data)).toEqual([`approve:${id}`, `reject:${id}`]);
    expect(getPostById(db, id)?.status).toBe("post_failed");

    const retry = fakeApi([callback(id, "approve", OWNER, 2)]);
    const ok = await run(retry.api, async () => {
      markPosted(db, id);
    });
    expect(ok.approved).toBe(1);
    expect(getPostById(db, id)?.status).toBe("posted");
  });

  it("still processes when answerCallbackQuery fails (expired query)", async () => {
    const id = newPost(db);
    const { api } = fakeApi([callback(id, "reject")], { answerThrows: true });

    const result = await run(api);

    expect(result.rejected).toBe(1);
    expect(getPostById(db, id)?.status).toBe("rejected");
  });

  it("ignores unknown posts and non-callback updates, and confirms the offset", async () => {
    const { api, log } = fakeApi([callback(9999, "approve", OWNER, 3), { update_id: 4 }]);

    const result = await run(api);

    expect(result.ignored).toBe(2);
    expect(log.offsets).toEqual([undefined, 5]);
  });

  it("does not confirm an offset when there are no updates", async () => {
    const { api, log } = fakeApi([]);
    await run(api);
    expect(log.offsets).toEqual([undefined]);
  });
});
