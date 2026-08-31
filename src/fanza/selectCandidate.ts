import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { getUsedContentIds } from "../db/repositories/postsRepo.js";
import { fetchItemList, type FetchItemListResult } from "./client.js";
import { isComic, isDiscounted } from "./filterCandidates.js";
import { parsePrice } from "./priceUtils.js";
import type { FanzaItem } from "./types.js";
import { logger } from "../lib/logger.js";

export interface SelectedFanzaCandidate {
  item: FanzaItem;
  price: number | null;
  listPrice: number | null;
  fetchOffset: number;
}

// FANZA ItemList APIをsort=rank(人気順)でページングしながら舐め、
// 「値引き中 × コミック判定OK × まだ候補にしていない」に最初に合致した1件を採用する。
// スキャン順=ランク順であることを利用し、"値引き中の中でできるだけランクが高いもの"という
// 要件を素直に満たす。
export async function selectFanzaCandidate(
  db: Database.Database,
  config: AppConfig,
  fetchFn: (params: Parameters<typeof fetchItemList>[0]) => Promise<FetchItemListResult> = fetchItemList
): Promise<SelectedFanzaCandidate | null> {
  const usedContentIds = getUsedContentIds(db);
  const { fanza } = config;

  for (let page = 0; page < fanza.maxPages; page++) {
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
      logger.info("no more FANZA items to scan", { page, offset });
      break;
    }

    for (const item of items) {
      if (usedContentIds.has(item.content_id)) continue;
      if (!isComic(item)) continue;
      if (!isDiscounted(item)) continue;

      return {
        item,
        price: parsePrice(item.prices?.price),
        listPrice: parsePrice(item.prices?.list_price),
        fetchOffset: offset,
      };
    }
  }

  logger.info("no eligible FANZA candidate found within maxPages", { maxPages: fanza.maxPages });
  return null;
}
