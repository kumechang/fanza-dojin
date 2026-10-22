import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { selectFanzaCandidate } from "../fanza/selectCandidate.js";
import { createPost, getPostById, markPostFailed, setGithubIssue } from "../db/repositories/postsRepo.js";
import { createApprovalIssue } from "../github/createApprovalIssue.js";
import { finalizeApprovedPost } from "./finalizeApprovedPost.js";
import { sendTelegramPreview } from "./sendTelegramPreview.js";
import { logger } from "../lib/logger.js";
import { env, hasTelegramCredentials } from "../lib/env.js";
import { isWithinPostingWindow } from "../lib/postingWindow.js";
import { shouldGenerateNow } from "./shouldGenerateNow.js";

// 投稿候補を1件作るパイプライン全体の統括役。
// 投稿可能時間帯・生成タイミングの判定 → FANZA候補選定 → DB保存 → 承認依頼、の順に実行する。
// 承認依頼はapprovalModeで異なる: manualはGitHub Issue、telegramは黒塗り済み画像のTelegram送信
// (承認ボタンの押下はhandle-telegramが拾って投稿する)、autoは承認なしで即時投稿まで行う。
// GitHub Actionsのscheduleは数時間単位で遅延することがあり、想定外に深夜へズレ込んで
// 実行されることがあるため、そういう回は投稿候補自体を作らずスキップする(nullを返す)。
export async function generateCandidate(db: Database.Database, config: AppConfig, accountName: string): Promise<number | null> {
  const now = new Date();

  if (!isWithinPostingWindow(now, config)) {
    logger.warn("outside posting window, skipping this run", {
      accountName,
      postingWindow: config.postingWindow,
    });
    return null;
  }

  // generate-postsは投稿可能時間帯の間毎時起動する(schedule遅延・スキップへの耐性のため)。
  // 実際に生成するかどうかは、1日の目標数・直近投稿からの間隔・時間帯の重みをもとに
  // ここで判断する(目標数・間隔はアカウントごとに独立して判定する)。
  if (!shouldGenerateNow(db, config, now, accountName)) {
    logger.info("skipping this run (throttled by shouldGenerateNow)", { accountName });
    return null;
  }

  // Telegram承認モードで送信先が未設定の場合、候補を作っても誰にも確認依頼が届かず
  // 1日の生成枠だけを消費してしまうため、候補を作る前にスキップする。
  if (config.approvalMode === "telegram" && !hasTelegramCredentials()) {
    logger.warn("approvalMode is telegram but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set, skipping", {
      accountName,
    });
    return null;
  }

  const candidate = selectFanzaCandidate(db, config, accountName);
  if (!candidate) {
    logger.info("no eligible FANZA candidate found, skipping this run", { accountName });
    return null;
  }

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

  if (config.approvalMode === "telegram") {
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
      throw error;
    }
    logger.info("candidate created (awaiting telegram review)", {
      accountName,
      postId,
      contentId: candidate.contentId,
      totalPageCount: candidate.totalPageCount,
      droppedPageCount: candidate.droppedPageCount,
    });
    return postId;
  }

  const issue = await createApprovalIssue({
    accountName,
    title: candidate.title,
    price: candidate.price,
    listPrice: candidate.listPrice,
    campaignTitle: candidate.campaignTitle,
    reviewCount: candidate.reviewCount,
    reviewAverage: candidate.reviewAverage,
    sampleImageUrls: candidate.sampleImageUrls,
    affiliateUrl: candidate.affiliateUrl,
  });
  if (issue.number > 0) {
    setGithubIssue(db, postId, issue.number, issue.url);
  }

  logger.info("candidate created", {
    accountName,
    postId,
    issueNumber: issue.number,
    contentId: candidate.contentId,
    totalPageCount: candidate.totalPageCount,
    droppedPageCount: candidate.droppedPageCount,
  });

  if (config.approvalMode === "auto") {
    const post = getPostById(db, postId);
    if (post) {
      await finalizeApprovedPost(db, config, post);
    }
  }

  return postId;
}
