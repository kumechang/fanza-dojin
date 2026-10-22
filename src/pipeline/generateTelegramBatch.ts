import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { selectFanzaCandidates } from "../fanza/selectCandidate.js";
import { countPendingApproval, createPost, getPostById, markPostFailed } from "../db/repositories/postsRepo.js";
import { sendTelegramPreview } from "./sendTelegramPreview.js";
import { logger } from "../lib/logger.js";
import { env, hasTelegramCredentials } from "../lib/env.js";

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_SEND_PER_RUN = 3;

// Telegram承認モードのバッチ生成。ランク上位の投稿可能な作品を順に黒塗りしてTelegramへ送り、
// 人が投稿する画像を選ぶ。1回の実行で送る作品数はmaxSendPerRun(Telegramの送信レート制限対策)、
// 確認待ち(pending_approval)がsize件に達している間は追加しない。投稿可能時間帯・生成頻度の
// 抑制(shouldGenerateNow)は適用しない(確認依頼を送るだけで、投稿は人が承認したときに行うため)。
// 戻り値は作成した投稿のid。1件の送信失敗で残りの作品の機会を奪わないよう、失敗したものは
// post_failedにして続行し、最後に失敗があれば例外を投げる。
export async function generateTelegramBatch(
  db: Database.Database,
  config: AppConfig,
  accountName: string
): Promise<number[]> {
  if (!hasTelegramCredentials()) {
    logger.warn("approvalMode is telegram but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set, skipping", {
      accountName,
    });
    return [];
  }

  const size = config.telegramBatch?.size ?? DEFAULT_BATCH_SIZE;
  const maxSendPerRun = config.telegramBatch?.maxSendPerRun ?? DEFAULT_MAX_SEND_PER_RUN;
  const pending = countPendingApproval(db, accountName);
  const toSend = Math.min(maxSendPerRun, size - pending);
  if (toSend <= 0) {
    logger.info("too many posts awaiting telegram review, skipping this run", { accountName, pending, size });
    return [];
  }

  const candidates = selectFanzaCandidates(db, config, accountName, toSend);
  const postIds: number[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    const postId = createPost(db, {
      platform: config.platform,
      account_name: accountName,
      content_id: candidate.contentId,
      title: candidate.title,
      affiliate_url: candidate.affiliateUrl,
      sample_image_urls: candidate.sampleImageUrls,
      price: candidate.price,
      list_price: candidate.listPrice,
      campaign_title: candidate.campaignTitle,
      genre_names: candidate.genreNames,
      review_count: candidate.reviewCount,
      review_average: candidate.reviewAverage,
      fetch_offset: candidate.rankOrder,
      run_id: env.githubRunId || null,
    });
    const post = getPostById(db, postId);
    if (!post) throw new Error(`post disappeared right after creation: ${postId}`);

    try {
      await sendTelegramPreview(config, post, {
        accountName,
        title: candidate.title,
        price: candidate.price,
        listPrice: candidate.listPrice,
        campaignTitle: candidate.campaignTitle,
        reviewCount: candidate.reviewCount,
        reviewAverage: candidate.reviewAverage,
        pageCount: candidate.sampleImageUrls.length,
        droppedPageCount: candidate.droppedPageCount,
      });
    } catch (error) {
      markPostFailed(db, postId, `Telegramへの確認依頼の送信に失敗: ${String(error)}`);
      logger.error("failed to send telegram preview", { accountName, postId, error: String(error) });
      errors.push(String(error));
      continue;
    }

    postIds.push(postId);
    logger.info("candidate created (awaiting telegram review)", {
      accountName,
      postId,
      contentId: candidate.contentId,
      rankOrder: candidate.rankOrder,
      droppedPageCount: candidate.droppedPageCount,
    });
  }

  if (errors.length > 0) throw new Error(`${errors.length}件のTelegram確認依頼の送信に失敗: ${errors[0]}`);
  return postIds;
}
