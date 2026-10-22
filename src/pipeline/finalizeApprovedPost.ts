import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import type { PostRow } from "../db/repositories/postsRepo.js";
import {
  getPostById,
  markPosted,
  markPostedDryRun,
  markPostFailed,
  setLeadTweet,
  appendThreadTweet,
  markAffiliateTweetPosted,
} from "../db/repositories/postsRepo.js";
import { postTweet, postReply, TweetTooLongError } from "../x/postTweet.js";
import { downloadImage, uploadImages, chunkImages } from "../x/mediaUpload.js";
import { censorImages } from "../x/censorImage.js";
import { closeIssueWithResult, commentOnIssue } from "../github/closeIssueWithResult.js";
import { logger } from "../lib/logger.js";
import { describeXApiError } from "../lib/xErrorMessage.js";
import { hasXCredentials } from "../lib/env.js";

// 承認済み投稿の最終処理(Xスレッド投稿→DB更新→Issue通知)をまとめた共通関数。
// 手動承認フロー(handleApproval.ts)からも、autoモードの即時投稿(generateCandidate.ts)からも
// 同じ関数を呼ぶことで、承認方法が違っても投稿後の扱いが一貫するようにしている。
//
// 画像枚数は作品ごとに可変で、途中でX APIエラーが起きる可能性もあるため、
// 1ツイート確定するごとに即座にDBへ進捗(thread_tweet_ids/images_posted_count/affiliate_tweet_posted)を
// 反映する。再承認や再実行でこの関数がもう一度呼ばれても、DBの進捗から続きを再開でき、
// 既に投稿済みの部分を重複投稿しない。
export async function finalizeApprovedPost(db: Database.Database, config: AppConfig, post: PostRow): Promise<void> {
  const issueNumber = post.github_issue_number && post.github_issue_number > 0 ? post.github_issue_number : null;
  const accountName = post.account_name;

  if (!hasXCredentials(accountName)) {
    // X APIキー未取得ではin_reply_toによるスレッド構造を模擬できないため、
    // ドライランはここで完結させる(個別ツイートのドライラン合成はしない)。
    logger.warn("X API credentials not configured, skipping actual post (dry-run)", { accountName, postId: post.id });
    markPostedDryRun(db, post.id);
    if (issueNumber) {
      await closeIssueWithResult(
        issueNumber,
        "ドライラン: X APIキー未設定のため実際の投稿は行っていません(DB上はposted_dryrunとして記録)。"
      );
    }
    return;
  }

  try {
    const allImageUrls = JSON.parse(post.sample_image_urls) as string[];
    // Telegramで人が選んだ画像がある場合は、その画像だけを番号順に投稿する(未選択=全画像)。
    const sampleImageUrls = post.selected_image_indices
      ? (JSON.parse(post.selected_image_indices) as number[]).map((i) => allImageUrls[i]!).filter(Boolean)
      : allImageUrls;
    let current = post;

    // ① 先頭ツイート(タイトル+先頭imagesPerTweet枚)。まだ投稿していなければ実行する。
    if ((JSON.parse(current.thread_tweet_ids) as string[]).length === 0) {
      const leadImages = sampleImageUrls.slice(0, config.fanza.imagesPerTweet);
      const mediaIds = leadImages.length > 0 ? await downloadAndUpload(accountName, config, leadImages) : undefined;
      const result = await postTweet(accountName, current.title, config.xCharLimit, mediaIds);
      setLeadTweet(db, current.id, result.tweetId, result.tweetUrl);
      appendThreadTweet(db, current.id, result.tweetId, leadImages.length);
      current = requirePost(db, current.id);
    }

    // ② 残り画像をimagesPerTweet枚ずつリプライ。images_posted_countから再開する。
    const remainingImages = sampleImageUrls.slice(current.images_posted_count);
    for (const chunk of chunkImages(remainingImages, config.fanza.imagesPerTweet)) {
      const threadIds = JSON.parse(current.thread_tweet_ids) as string[];
      const lastTweetId = threadIds[threadIds.length - 1]!;
      const mediaIds = await downloadAndUpload(accountName, config, chunk);
      const result = await postReply(accountName, "", lastTweetId, config.xCharLimit, mediaIds);
      appendThreadTweet(db, current.id, result.tweetId, chunk.length);
      current = requirePost(db, current.id);
    }

    // ③ 全画像投稿完了後、アフィリエイトリンクのみのリプライ。
    if (!current.affiliate_tweet_posted) {
      const threadIds = JSON.parse(current.thread_tweet_ids) as string[];
      const lastTweetId = threadIds[threadIds.length - 1]!;
      const result = await postReply(accountName, current.affiliate_url, lastTweetId, config.xCharLimit);
      markAffiliateTweetPosted(db, current.id, result.tweetId);
      current = requirePost(db, current.id);
    }

    markPosted(db, post.id);
    if (issueNumber) {
      await closeIssueWithResult(issueNumber, `投稿しました: ${current.tweet_url ?? ""}`);
    }
    logger.info("post finalized", { accountName, postId: post.id, tweetUrl: current.tweet_url });
  } catch (error) {
    const message =
      error instanceof TweetTooLongError
        ? `文字数超過のため投稿できませんでした: ${error.message}`
        : describeXApiError(error);
    markPostFailed(db, post.id, message);
    if (issueNumber) {
      await commentOnIssue(
        issueNumber,
        `投稿に失敗しました(途中経過は保存済みです。承認コメントを再送すると続きから再開します): ${message}`
      );
    }
    throw error;
  }
}

async function downloadAndUpload(accountName: string, config: AppConfig, urls: string[]): Promise<string[]> {
  const downloaded = await Promise.all(urls.map((url) => downloadImage(url)));
  const images = config.censorSampleImages ? await censorImages(downloaded) : downloaded;
  return uploadImages(accountName, images);
}

function requirePost(db: Database.Database, id: number): PostRow {
  const post = getPostById(db, id);
  if (!post) throw new Error(`post disappeared during finalize: ${id}`);
  return post;
}
