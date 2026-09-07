import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { getUsedContentIds } from "../db/repositories/postsRepo.js";
import { selectBestCandidate } from "../db/repositories/fanzaCandidatesRepo.js";
import { logger } from "../lib/logger.js";

export interface SelectedFanzaCandidate {
  contentId: string;
  title: string;
  affiliateUrl: string;
  sampleImageUrls: string[];
  price: number | null;
  listPrice: number | null;
  campaignTitle: string | null;
  genreNames: string[];
  reviewCount: number | null;
  reviewAverage: number | null;
  rankOrder: number | null;
  redactionRatio: number | null;
}

// 投稿候補プール(fanza_candidates、fetch-candidatesバッチが事前に取得・黒塗り要否解析
// 済み)の中から、「黒塗りがほとんど不要(redaction_ratio <= config.fanza.maxRedactionRatio)
// × このアカウントがまだ候補にしていない」を満たす作品を、ランクの良い順(rank_order昇順)に
// 1件選ぶ。FANZA APIへのライブ呼び出しはここでは行わない(バッチ取得済みのプールを
// 参照するのみ)。
export function selectFanzaCandidate(
  db: Database.Database,
  config: AppConfig,
  accountName: string
): SelectedFanzaCandidate | null {
  const usedContentIds = getUsedContentIds(db, accountName);
  const row = selectBestCandidate(db, usedContentIds, config.fanza.maxRedactionRatio);
  if (!row) {
    logger.info("no eligible pooled FANZA candidate found (pool empty or all above redaction threshold)", {
      maxRedactionRatio: config.fanza.maxRedactionRatio,
    });
    return null;
  }

  return {
    contentId: row.content_id,
    title: row.title,
    affiliateUrl: row.affiliate_url,
    sampleImageUrls: JSON.parse(row.sample_image_urls) as string[],
    price: row.price,
    listPrice: row.list_price,
    campaignTitle: row.campaign_title,
    genreNames: row.genre_names ? (JSON.parse(row.genre_names) as string[]) : [],
    reviewCount: row.review_count,
    reviewAverage: row.review_average,
    rankOrder: row.rank_order,
    redactionRatio: row.redaction_ratio,
  };
}
