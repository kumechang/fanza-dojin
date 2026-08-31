import type Database from "better-sqlite3";
import type { PostRow } from "../db/repositories/postsRepo.js";
import { getXClient } from "../x/xClient.js";
import { hasXCredentials } from "../lib/env.js";
import { listPostedWithinDays } from "../db/repositories/metricsRepo.js";
import { insertMetrics } from "../db/repositories/metricsRepo.js";
import { logger } from "../lib/logger.js";

// フィードバックループv1: 直近days日分の投稿済みツイートのエンゲージメントを取得し、
// post_metricsにスナップショットとして記録する(analyzePostingTimesが時間帯重みの算出に使う)。
// 投稿済みツイートの取得にはアカウント固有のトークンが必要なため、account_nameごとに
// グルーピングしてから対応するXクライアントで呼び出す。
export async function collectMetrics(db: Database.Database, days: number): Promise<number> {
  const posts = listPostedWithinDays(db, days).filter((post) => post.tweet_id);
  if (posts.length === 0) {
    logger.info("no posted tweets to collect metrics for");
    return 0;
  }

  const byAccount = new Map<string, PostRow[]>();
  for (const post of posts) {
    const list = byAccount.get(post.account_name) ?? [];
    list.push(post);
    byAccount.set(post.account_name, list);
  }

  const collectedAt = new Date().toISOString();
  let count = 0;

  for (const [accountName, accountPosts] of byAccount) {
    if (!hasXCredentials(accountName)) {
      logger.warn("X API credentials not configured for account, skipping", { accountName });
      continue;
    }

    const ids = accountPosts.map((post) => post.tweet_id as string);
    const response = await getXClient(accountName).v2.tweets(ids, { "tweet.fields": ["public_metrics"] });

    for (const post of accountPosts) {
      const tweet = response.data.find((t) => t.id === post.tweet_id);
      const metrics = tweet?.public_metrics;
      if (!metrics) continue;

      insertMetrics(db, {
        post_id: post.id,
        collected_at: collectedAt,
        impressions: metrics.impression_count ?? null,
        likes: metrics.like_count ?? null,
        reposts: metrics.retweet_count ?? null,
        replies: metrics.reply_count ?? null,
        bookmarks: metrics.bookmark_count ?? null,
      });
      count += 1;
    }
  }

  logger.info("collected metrics", { count });
  return count;
}
