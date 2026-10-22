import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { getUsedContentIds, type PostStatus } from "../db/repositories/postsRepo.js";
import { getAnalyzedCandidatesOrderedByRank } from "../db/repositories/fanzaCandidatesRepo.js";
import { selectPostablePageIndices, isWorkPostable, type PageRedactionInfo } from "./redactionPolicy.js";
import { logger } from "../lib/logger.js";

export interface SelectedFanzaCandidate {
  contentId: string;
  title: string;
  affiliateUrl: string;
  sampleImageUrls: string[]; // 投稿不可ページ(黒塗りが多すぎるページ)を間引いた、実際に投稿する画像URL
  price: number | null;
  listPrice: number | null;
  campaignTitle: string | null;
  genreNames: string[];
  reviewCount: number | null;
  reviewAverage: number | null;
  rankOrder: number | null;
  totalPageCount: number; // プール上の元々のサンプル画像枚数
  droppedPageCount: number; // 黒塗り超過で間引いた枚数(totalPageCount - sampleImageUrls.length)
}

// 投稿候補プール(fanza_candidates、fetch-candidatesバッチが事前に取得・黒塗り解析済み)の中から、
// 「投稿可能(isWorkPostable) × このアカウントがまだ候補にしていない」を満たす作品を、
// ランクの良い順(rank_order昇順)に1件選ぶ。FANZA APIへのライブ呼び出しはここでは行わない。
//
// 投稿可否・間引きページの判定は選定のたびにここで行う(バッチ解析時に確定させない)。
// ページごとの黒塗り面積率はfanza_candidates.redaction_detailに保存済みのため、
// config/app.jsonのmaxPageRedactionRatio/maxUnpostablePageRatioを変更しても、
// 高コストなYOLO再解析なしにすぐ反映される。
export function selectFanzaCandidate(
  db: Database.Database,
  config: AppConfig,
  accountName: string
): SelectedFanzaCandidate | null {
  return selectFanzaCandidates(db, config, accountName, 1)[0] ?? null;
}

// 上と同じ条件で、ランクの良い順に最大limit件を選ぶ(Telegramのバッチ確認用)。
export function selectFanzaCandidates(
  db: Database.Database,
  config: AppConfig,
  accountName: string,
  limit: number
): SelectedFanzaCandidate[] {
  const selected: SelectedFanzaCandidate[] = [];
  const extraStatuses: PostStatus[] =
    config.approvalMode === "telegram" ? ["pending_approval", "rejected", "post_failed"] : [];
  const usedContentIds = getUsedContentIds(db, accountName, extraStatuses);
  const { maxPageRedactionRatio, maxUnpostablePageRatio } = config.fanza;

  for (const row of getAnalyzedCandidatesOrderedByRank(db)) {
    if (usedContentIds.has(row.content_id)) continue;

    const detail = (row.redaction_detail ? JSON.parse(row.redaction_detail) : []) as PageRedactionInfo[];
    if (!isWorkPostable(detail, maxPageRedactionRatio, maxUnpostablePageRatio)) continue;

    const allImageUrls = JSON.parse(row.sample_image_urls) as string[];
    const postableIndices = selectPostablePageIndices(detail, maxPageRedactionRatio);
    const sampleImageUrls = postableIndices.map((i) => allImageUrls[i]!);

    selected.push({
      contentId: row.content_id,
      title: row.title,
      affiliateUrl: row.affiliate_url,
      sampleImageUrls,
      price: row.price,
      listPrice: row.list_price,
      campaignTitle: row.campaign_title,
      genreNames: row.genre_names ? (JSON.parse(row.genre_names) as string[]) : [],
      reviewCount: row.review_count,
      reviewAverage: row.review_average,
      rankOrder: row.rank_order,
      totalPageCount: allImageUrls.length,
      droppedPageCount: allImageUrls.length - sampleImageUrls.length,
    });
    if (selected.length >= limit) break;
  }

  if (selected.length === 0) {
    logger.info("no eligible pooled FANZA candidate found (pool empty or all rejected by redaction policy)", {
      maxPageRedactionRatio,
      maxUnpostablePageRatio,
    });
  }
  return selected;
}
