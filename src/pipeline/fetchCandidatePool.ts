import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { fetchItemList, type FetchItemListResult } from "../fanza/client.js";
import { isComic, isDiscounted } from "../fanza/filterCandidates.js";
import { parsePrice } from "../fanza/priceUtils.js";
import { upsertCandidate } from "../db/repositories/fanzaCandidatesRepo.js";
import { logger } from "../lib/logger.js";

export interface FetchCandidatePoolResult {
  scanned: number;
  pooled: number;
}

// FANZA ItemList APIをsort=rank(人気順)でconfig.fanza.poolFetchPagesページ分舐め、
// 「コミック × 値引きキャンペーン中」の作品をすべて投稿候補プール(fanza_candidates)へ
// 反映する(UPSERT)。以前はgenerateCandidate実行のたびにここをライブで舐めて最初の
// 1件を採用していたが、投稿タイミングからFANZA API呼び出しを切り離すため、
// この関数はfetch-candidatesバッチから定期的に呼ばれる。
//
// アカウントごとの重複防止(すでに候補にした作品を除く)はここでは行わない
// (プールは全アカウント共通で、選定時にselectFanzaCandidate側でアカウント単位に除外する)。
export async function fetchCandidatePool(
  db: Database.Database,
  config: AppConfig,
  fetchFn: (params: Parameters<typeof fetchItemList>[0]) => Promise<FetchItemListResult> = fetchItemList
): Promise<FetchCandidatePoolResult> {
  const { fanza } = config;
  let scanned = 0;
  let pooled = 0;

  for (let page = 0; page < fanza.poolFetchPages; page++) {
    const offset = page * fanza.hits + 1;
    const { items } = await fetchFn({
      site: fanza.site,
      service: fanza.service,
      floor: fanza.floor,
      hits: fanza.hits,
      offset,
      sort: "rank",
    });

    if (items.length === 0) {
      logger.info("no more FANZA items to scan for pool", { page, offset });
      break;
    }

    items.forEach((item, index) => {
      scanned++;
      if (!isComic(item)) return;
      if (!isDiscounted(item)) return;

      upsertCandidate(db, {
        content_id: item.content_id,
        title: item.title,
        affiliate_url: item.affiliateURL,
        sample_image_urls: item.sampleImageURL?.sample_l?.image ?? [],
        price: parsePrice(item.prices?.price),
        list_price: parsePrice(item.prices?.list_price),
        campaign_title: item.campaign?.[0]?.title ?? null,
        genre_names: item.iteminfo?.genre?.map((g) => g.name).filter((n): n is string => Boolean(n)) ?? [],
        review_count: item.review?.count ?? null,
        review_average: item.review?.average !== undefined ? Number(item.review.average) : null,
        rank_order: offset + index,
      });
      pooled++;
    });
  }

  logger.info("fanza candidate pool fetch finished", { scanned, pooled });
  return { scanned, pooled };
}
