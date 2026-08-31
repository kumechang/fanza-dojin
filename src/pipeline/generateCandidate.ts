import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { selectFanzaCandidate } from "../fanza/selectCandidate.js";
import { createPost, getPostById, setGithubIssue } from "../db/repositories/postsRepo.js";
import { createApprovalIssue } from "../github/createApprovalIssue.js";
import { finalizeApprovedPost } from "./finalizeApprovedPost.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { isWithinPostingWindow } from "../lib/postingWindow.js";
import { shouldGenerateNow } from "./shouldGenerateNow.js";

// 投稿候補を1件作るパイプライン全体の統括役。
// 投稿可能時間帯・生成タイミングの判定 → FANZA候補選定 → DB保存 → 承認Issue作成、
// の順に実行し、最後にautoモードなら即時投稿まで行う。
// GitHub Actionsのscheduleは数時間単位で遅延することがあり、想定外に深夜へズレ込んで
// 実行されることがあるため、そういう回は投稿候補自体を作らずスキップする(nullを返す)。
export async function generateCandidate(db: Database.Database, config: AppConfig): Promise<number | null> {
  const now = new Date();

  if (!isWithinPostingWindow(now, config)) {
    logger.warn("outside posting window, skipping this run", {
      postingWindow: config.postingWindow,
    });
    return null;
  }

  // generate-postsは投稿可能時間帯の間毎時起動する(schedule遅延・スキップへの耐性のため)。
  // 実際に生成するかどうかは、1日の目標数・直近投稿からの間隔・時間帯の重みをもとに
  // ここで判断する。
  if (!shouldGenerateNow(db, config, now)) {
    logger.info("skipping this run (throttled by shouldGenerateNow)");
    return null;
  }

  const candidate = await selectFanzaCandidate(db, config);
  if (!candidate) {
    logger.info("no eligible FANZA candidate found, skipping this run");
    return null;
  }

  const { item, price, listPrice, fetchOffset } = candidate;
  const sampleImageUrls = item.sampleImageURL?.sample_l?.image ?? [];
  const genreNames = item.iteminfo?.genre?.map((g) => g.name).filter((n): n is string => Boolean(n)) ?? [];
  const campaignTitle = item.campaign?.[0]?.title ?? null;
  const reviewAverage = item.review?.average !== undefined ? Number(item.review.average) : null;

  const postId = createPost(db, {
    platform: config.platform,
    content_id: item.content_id,
    title: item.title,
    affiliate_url: item.affiliateURL,
    sample_image_urls: sampleImageUrls,
    price,
    list_price: listPrice,
    campaign_title: campaignTitle,
    genre_names: genreNames,
    review_count: item.review?.count ?? null,
    review_average: reviewAverage,
    fetch_offset: fetchOffset,
    run_id: env.githubRunId || null,
  });

  const issue = await createApprovalIssue({
    title: item.title,
    price,
    listPrice,
    campaignTitle,
    reviewCount: item.review?.count ?? null,
    reviewAverage,
    sampleImageUrls,
    affiliateUrl: item.affiliateURL,
  });
  if (issue.number > 0) {
    setGithubIssue(db, postId, issue.number, issue.url);
  }

  logger.info("candidate created", { postId, issueNumber: issue.number, contentId: item.content_id });

  if (config.approvalMode === "auto") {
    const post = getPostById(db, postId);
    if (post) {
      await finalizeApprovedPost(db, config, post);
    }
  }

  return postId;
}
