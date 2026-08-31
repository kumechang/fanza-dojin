import type { SendTweetV2Params } from "twitter-api-v2";
import { getXClient } from "./xClient.js";
import { hasXCredentials } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getWeightedLength } from "../lib/tweetLength.js";

export interface PostTweetResult {
  dryRun: boolean;
  tweetId: string;
  tweetUrl: string;
}

export class TweetTooLongError extends Error {}

// twitter-api-v2の型はmedia_idsを1〜4要素の固定長タプルとして要求する。
// 実際の要素数はconfig.fanza.imagesPerTweet(既定2)以下であることを呼び出し側が保証しており、
// ここでは型システムにその事実を伝えるためだけにキャストする。
function toMediaPayload(mediaIds: string[] | undefined): Partial<SendTweetV2Params> | undefined {
  if (!mediaIds || mediaIds.length === 0) return undefined;
  return { media: { media_ids: mediaIds as [string, string, string, string] } };
}

// 元プロンプトには文字数ルールが無いため、投稿直前にアプリ側で文字数ガードをかける。
// セルフチェック済みの本文をここで黙って切り詰めると意味が変わってしまうため、
// 超過時は投稿せず例外として扱う。
// mediaIds: 画像スレッド投稿用。指定するとv2.tweetにmedia.media_idsとして渡す(本文が空文字でも画像のみで投稿できる)。
export async function postTweet(text: string, charLimit: number, mediaIds?: string[]): Promise<PostTweetResult> {
  const weightedLength = getWeightedLength(text);
  if (weightedLength > charLimit) {
    throw new TweetTooLongError(`tweet exceeds char limit: ${weightedLength} > ${charLimit}`);
  }

  if (!hasXCredentials()) {
    // X APIキー未取得の現段階では、ここで処理を止めずログのみでドライラン扱いにする。
    logger.warn("X API credentials not configured, skipping actual post (dry-run)", { text, mediaIds });
    return { dryRun: true, tweetId: "", tweetUrl: "" };
  }

  const result = await getXClient().v2.tweet(text, toMediaPayload(mediaIds));
  const tweetId = result.data.id;
  return {
    dryRun: false,
    tweetId,
    tweetUrl: `https://x.com/i/web/status/${tweetId}`,
  };
}

// 画像スレッドのリプライ版。文字数ガード・ドライラン挙動・mediaIdsの扱いはpostTweetと同じ。
export async function postReply(
  text: string,
  inReplyToTweetId: string,
  charLimit: number,
  mediaIds?: string[]
): Promise<PostTweetResult> {
  const weightedLength = getWeightedLength(text);
  if (weightedLength > charLimit) {
    throw new TweetTooLongError(`reply exceeds char limit: ${weightedLength} > ${charLimit}`);
  }

  if (!hasXCredentials()) {
    logger.warn("X API credentials not configured, skipping actual reply (dry-run)", { text, inReplyToTweetId, mediaIds });
    return { dryRun: true, tweetId: "", tweetUrl: "" };
  }

  const result = await getXClient().v2.reply(text, inReplyToTweetId, toMediaPayload(mediaIds));
  const tweetId = result.data.id;
  return {
    dryRun: false,
    tweetId,
    tweetUrl: `https://x.com/i/web/status/${tweetId}`,
  };
}
