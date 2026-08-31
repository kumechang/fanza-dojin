import type Database from "better-sqlite3";
import { getJstDateString, parseDbTimestamp } from "../../lib/time.js";

// postsテーブルへのアクセス層。1レコードがFANZA候補1件のライフサイクル全体
// (取得→承認待ち→承認/却下→投稿済み/失敗)を表す。
export type PostStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "posted"
  | "posted_dryrun"
  | "post_failed";

export interface CreatePostInput {
  platform: string;
  content_id: string;
  title: string;
  affiliate_url: string;
  sample_image_urls: string[];
  price: number | null;
  list_price: number | null;
  campaign_title: string | null;
  genre_names: string[];
  review_count: number | null;
  review_average: number | null;
  fetch_offset: number | null;
  run_id: string | null;
}

export interface PostRow {
  id: number;
  platform: string;
  content_id: string;
  title: string;
  affiliate_url: string;
  sample_image_urls: string;
  price: number | null;
  list_price: number | null;
  campaign_title: string | null;
  genre_names: string | null;
  review_count: number | null;
  review_average: number | null;
  fetch_offset: number | null;
  status: PostStatus;
  github_issue_number: number | null;
  github_issue_url: string | null;
  approved_by: string | null;
  approval_comment_body: string | null;
  thread_tweet_ids: string;
  images_posted_count: number;
  affiliate_tweet_posted: number;
  tweet_id: string | null;
  tweet_url: string | null;
  post_error: string | null;
  run_id: string | null;
  created_at: string;
  approved_at: string | null;
  posted_at: string | null;
  updated_at: string | null;
}

// パイプライン実行1回につき1行作成する。常にstatus='pending_approval'から開始し、
// その後の承認/投稿処理でstatusを進めていく。
export function createPost(db: Database.Database, input: CreatePostInput): number {
  const result = db
    .prepare(
      `INSERT INTO posts (platform, content_id, title, affiliate_url, sample_image_urls, price, list_price, campaign_title, genre_names, review_count, review_average, fetch_offset, status, run_id, updated_at)
       VALUES (@platform, @content_id, @title, @affiliate_url, @sample_image_urls, @price, @list_price, @campaign_title, @genre_names, @review_count, @review_average, @fetch_offset, 'pending_approval', @run_id, CURRENT_TIMESTAMP)`
    )
    .run({
      platform: input.platform,
      content_id: input.content_id,
      title: input.title,
      affiliate_url: input.affiliate_url,
      sample_image_urls: JSON.stringify(input.sample_image_urls),
      price: input.price,
      list_price: input.list_price,
      campaign_title: input.campaign_title,
      genre_names: JSON.stringify(input.genre_names),
      review_count: input.review_count,
      review_average: input.review_average,
      fetch_offset: input.fetch_offset,
      run_id: input.run_id,
    });
  return Number(result.lastInsertRowid);
}

export function setGithubIssue(db: Database.Database, postId: number, issueNumber: number, issueUrl: string): void {
  db.prepare(
    `UPDATE posts SET github_issue_number = ?, github_issue_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(issueNumber, issueUrl, postId);
}

export function getPostById(db: Database.Database, id: number): PostRow | undefined {
  return db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
}

export function getPostByIssueNumber(db: Database.Database, issueNumber: number): PostRow | undefined {
  return db.prepare(`SELECT * FROM posts WHERE github_issue_number = ?`).get(issueNumber) as PostRow | undefined;
}

// selectFanzaCandidate用: 既に候補になったことがある(=もう一度紹介する必要がない)content_idの集合。
// 却下・投稿失敗は限られたセール在庫の中で再候補になり得るため除外対象に含めない
// (承認済み・投稿済みのものだけを「もう紹介した」とみなす)。
export function getUsedContentIds(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT content_id FROM posts WHERE status IN ('approved', 'posted', 'posted_dryrun')`)
    .all() as { content_id: string }[];
  return new Set(rows.map((row) => row.content_id));
}

// shouldGenerateNow用: 指定したJSTカレンダー日に生成された投稿候補数(承認/却下/投稿結果を問わない)。
// SQLでは前後1日を粗く絞り込み、JST日付の厳密な判定はJS側で行う
// (created_atはUTCで保存されているため)。
export function countPostsCreatedOnJstDate(db: Database.Database, jstDateString: string): number {
  const rows = db
    .prepare(
      `SELECT created_at FROM posts
       WHERE created_at >= datetime(?, '-1 day') AND created_at <= datetime(?, '+1 day')`
    )
    .all(jstDateString, jstDateString) as { created_at: string }[];
  return rows.filter((row) => getJstDateString(parseDbTimestamp(row.created_at)) === jstDateString).length;
}

// shouldGenerateNow用: 直近の投稿候補作成日時。minSpacingHoursの間隔判定に使う。
export function getLastPostCreatedAt(db: Database.Database): string | null {
  const row = db.prepare(`SELECT MAX(created_at) as last_created FROM posts`).get() as {
    last_created: string | null;
  };
  return row.last_created;
}

export function markApproved(db: Database.Database, id: number, approvedBy: string, commentBody: string): void {
  db.prepare(
    `UPDATE posts SET status = 'approved', approved_by = ?, approval_comment_body = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(approvedBy, commentBody, id);
}

export function markRejected(db: Database.Database, id: number, approvedBy: string, commentBody: string): void {
  db.prepare(
    `UPDATE posts SET status = 'rejected', approved_by = ?, approval_comment_body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(approvedBy, commentBody, id);
}

// 既に却下済みの投稿に対して、後から理由だけを追記/更新する。
// (承認/却下の判定自体はやり直さない。ステータスやIssueのopen/closedには触れない)
export function updateRejectionReason(db: Database.Database, id: number, approvedBy: string, commentBody: string): void {
  db.prepare(
    `UPDATE posts SET approved_by = ?, approval_comment_body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(approvedBy, commentBody, id);
}

// 「却下」というコメントから、キーワードを除いた自由記述部分を却下理由として取り出す。
// 単に「却下」とだけ書かれていた場合(理由なし)はnullを返す。
export function extractRejectionReason(commentBody: string): string | null {
  const stripped = commentBody.replace(/却下/g, "").trim();
  return stripped.length > 0 ? stripped : null;
}

// Xスレッド投稿の進捗を1ツイート確定するごとに記録する。投稿失敗→再承認での再実行時、
// finalizeApprovedPostがここに保存された進捗から続きを再開できるようにするための関数群。
export function appendThreadTweet(db: Database.Database, postId: number, tweetId: string, imagesAdded: number): void {
  const post = getPostById(db, postId);
  if (!post) throw new Error(`post not found: ${postId}`);
  const threadIds = JSON.parse(post.thread_tweet_ids) as string[];
  threadIds.push(tweetId);
  db.prepare(
    `UPDATE posts SET thread_tweet_ids = ?, images_posted_count = images_posted_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(JSON.stringify(threadIds), imagesAdded, postId);
}

export function setLeadTweet(db: Database.Database, postId: number, tweetId: string, tweetUrl: string): void {
  db.prepare(
    `UPDATE posts SET tweet_id = ?, tweet_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(tweetId, tweetUrl, postId);
}

export function markAffiliateTweetPosted(db: Database.Database, postId: number, tweetId: string): void {
  const post = getPostById(db, postId);
  if (!post) throw new Error(`post not found: ${postId}`);
  const threadIds = JSON.parse(post.thread_tweet_ids) as string[];
  threadIds.push(tweetId);
  db.prepare(
    `UPDATE posts SET thread_tweet_ids = ?, affiliate_tweet_posted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(JSON.stringify(threadIds), postId);
}

export function markPosted(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE posts SET status = 'posted', posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
}

export function markPostedDryRun(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE posts SET status = 'posted_dryrun', posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
}

export function markPostFailed(db: Database.Database, id: number, error: string): void {
  db.prepare(
    `UPDATE posts SET status = 'post_failed', post_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(error, id);
}
