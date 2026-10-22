import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import type { InlineButton, TelegramApi, TelegramCallbackQuery } from "../telegram/client.js";
import { buildCallbackData, parseCallbackData } from "../telegram/callbackData.js";
import { buildReviewButtons } from "./sendTelegramPreview.js";
import {
  getPostById,
  getSelectedImageIndices,
  markApproved,
  markRejected,
  toggleSelectedImage,
  type PostRow,
} from "../db/repositories/postsRepo.js";
import { logger } from "../lib/logger.js";

export interface HandleTelegramUpdatesDeps {
  api: TelegramApi;
  finalize: (db: Database.Database, config: AppConfig, post: PostRow) => Promise<void>;
  // 承認操作を受け付ける唯一のTelegramユーザーID(承認者本人との1対1チャットのID)。
  allowedUserId: string;
}

export interface HandleTelegramUpdatesResult {
  approved: number;
  rejected: number;
  toggled: number;
  ignored: number;
  failed: number;
}

// 投稿確定前(確認待ち)に加え、approvedのまま止まった(確定処理中にプロセスが落ちた)ものと
// post_failed(投稿失敗後の再試行)も操作可能にする。finalizeApprovedPostは進捗から再開でき
// 重複投稿しないため、approvedからの再実行も安全。
const ACTIONABLE_STATUSES = ["pending_approval", "approved", "post_failed"];

// Telegram承認モードの承認ボタン押下(callback_query)をまとめて処理する。
// 押下はポーリング(getUpdates)で拾うため、callback_queryの応答期限(answerCallbackQuery)は
// とうに切れていることが多く、応答・メッセージ編集の失敗では処理全体を落とさない。
export async function handleTelegramUpdates(
  db: Database.Database,
  config: AppConfig,
  deps: HandleTelegramUpdatesDeps
): Promise<HandleTelegramUpdatesResult> {
  const result: HandleTelegramUpdatesResult = { approved: 0, rejected: 0, toggled: 0, ignored: 0, failed: 0 };
  const updates = await deps.api.getUpdates();

  for (const update of updates) {
    const query = update.callback_query;
    if (!query) {
      result.ignored++;
      continue;
    }
    try {
      const outcome = await handleCallback(db, config, deps, query);
      result[outcome]++;
    } catch (error) {
      logger.error("failed to handle telegram callback", { updateId: update.update_id, error: String(error) });
      result.failed++;
    }
  }

  // 処理した分をTelegram側で確定させる(offset=最大update_id+1)。失敗した操作はボタンの
  // 再試行で再実行できるため、ここでは常に確定させて同じ押下を繰り返し処理しないようにする。
  if (updates.length > 0) {
    await deps.api.getUpdates(Math.max(...updates.map((u) => u.update_id)) + 1);
  }
  return result;
}

async function handleCallback(
  db: Database.Database,
  config: AppConfig,
  deps: HandleTelegramUpdatesDeps,
  query: TelegramCallbackQuery
): Promise<"approved" | "rejected" | "toggled" | "ignored" | "failed"> {
  if (String(query.from.id) !== deps.allowedUserId) {
    logger.warn("ignoring telegram callback from unauthorized user", { fromId: query.from.id });
    return "ignored";
  }

  const parsed = parseCallbackData(query.data);
  if (!parsed) return "ignored";

  const ui = createMessageUi(deps.api, query);
  const post = getPostById(db, parsed.postId);
  if (!post) {
    await ui.answer("対象の投稿が見つかりません");
    return "ignored";
  }
  if (!ACTIONABLE_STATUSES.includes(post.status)) {
    await ui.answer(`既に処理済みです(状態: ${post.status})`);
    await ui.setStatus(`[処理済み] 状態: ${post.status}`);
    return "ignored";
  }

  if (parsed.action === "toggle") {
    const selected = toggleSelectedImage(db, post.id, parsed.imageIndex ?? -1);
    if (!selected) {
      await ui.answer("この画像は選択できません");
      return "ignored";
    }
    const imageCount = (JSON.parse(post.sample_image_urls) as string[]).length;
    await ui.answer(`${selected.length}枚選択中`);
    await ui.setButtons(buildReviewButtons(post.id, imageCount, selected));
    return "toggled";
  }

  // 画像を1枚も選ばないまま投稿を押された場合は、投稿もステータス変更もしない。
  if (parsed.action === "approve" && post.status === "pending_approval" && getSelectedImageIndices(post).length === 0) {
    await ui.answer("投稿する画像を1枚以上選んでください");
    return "ignored";
  }

  const approver = `telegram:${query.from.username ?? query.from.id}`;

  if (parsed.action === "reject") {
    markRejected(db, post.id, approver, "telegram:reject");
    await ui.answer("却下しました");
    await ui.setStatus("[却下] 却下しました");
    logger.info("post rejected via telegram", { postId: post.id });
    return "rejected";
  }

  markApproved(db, post.id, approver, "telegram:approve");
  await ui.answer("投稿を開始します");
  // ボタンを消して二重押下を防ぐ。
  await ui.setStatus("[処理中] 投稿しています...");

  try {
    const approvedPost = getPostById(db, post.id);
    if (!approvedPost) throw new Error(`post disappeared after approval update: ${post.id}`);
    await deps.finalize(db, config, approvedPost);

    const done = getPostById(db, post.id);
    await ui.setStatus(
      done?.status === "posted_dryrun"
        ? "[ドライラン] X APIキー未設定のため実際の投稿は行っていません"
        : `[投稿完了] ${done?.tweet_url ?? ""}`
    );
    logger.info("post approved and finalized via telegram", { postId: post.id });
    return "approved";
  } catch (error) {
    const failed = getPostById(db, post.id);
    await ui.setStatus(
      `[投稿失敗] ${failed?.post_error ?? String(error)}\n途中経過は保存済みです。再試行する場合は下のボタンを押してください。`,
      [
        [
          { text: "再試行", callback_data: buildCallbackData("approve", post.id) },
          { text: "却下", callback_data: buildCallbackData("reject", post.id) },
        ],
      ]
    );
    logger.error("telegram-approved post failed to finalize", { postId: post.id, error: String(error) });
    return "failed";
  }
}

// 押されたボタンのメッセージへの応答・編集。ポーリングで遅れて拾うため期限切れ等で失敗しやすく、
// 失敗しても承認/却下の処理結果には影響させない。
function createMessageUi(api: TelegramApi, query: TelegramCallbackQuery) {
  const message = query.message;
  return {
    async answer(text: string): Promise<void> {
      try {
        await api.answerCallbackQuery(query.id, text);
      } catch (error) {
        logger.warn("answerCallbackQuery failed (likely expired)", { error: String(error) });
      }
    },
    async setButtons(buttons: InlineButton[][]): Promise<void> {
      if (!message) return;
      try {
        await api.editMessageButtons(message.chat.id, message.message_id, buttons);
      } catch (error) {
        logger.warn("editMessageButtons failed", { error: String(error) });
      }
    },
    async setStatus(status: string, buttons?: InlineButton[][]): Promise<void> {
      if (!message) return;
      try {
        await api.editMessageText(message.chat.id, message.message_id, `${message.text ?? ""}\n\n${status}`, buttons);
      } catch (error) {
        logger.warn("editMessageText failed", { error: String(error) });
      }
    },
  };
}
