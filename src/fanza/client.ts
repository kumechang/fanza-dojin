import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { fanzaItemSchema, fanzaItemListResponseSchema, type FanzaItem } from "./types.js";

const ENDPOINT = "https://api.dmm.com/affiliate/v3/ItemList";

export interface FetchItemListParams {
  site: string;
  service: string;
  floor: string;
  hits: number;
  offset: number;
  sort?: string;
}

export interface FetchItemListResult {
  items: FanzaItem[];
  totalCount: number;
}

// FANZA(DMM affiliate) ItemList APIの薄いI/O層。
// レスポンスのitems[]は個別にsafeParseし、フィールド欠損等でスキーマに合わない
// 1件があっても全体を落とさずスキップする(ログのみ残す)。
export async function fetchItemList(params: FetchItemListParams): Promise<FetchItemListResult> {
  const query = new URLSearchParams({
    api_id: env.fanza.apiId,
    affiliate_id: env.fanza.affiliateId,
    site: params.site,
    service: params.service,
    floor: params.floor,
    hits: String(params.hits),
    offset: String(params.offset),
    sort: params.sort ?? "rank",
    output: "json",
  });

  const response = await fetch(`${ENDPOINT}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`FANZA ItemList API request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const parsed = fanzaItemListResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`FANZA ItemList API response did not match expected shape: ${parsed.error.message}`);
  }

  const rawItems = parsed.data.result.items ?? [];
  const items: FanzaItem[] = [];
  for (const raw of rawItems) {
    const itemParsed = fanzaItemSchema.safeParse(raw);
    if (!itemParsed.success) {
      logger.warn("skipping FANZA item that did not match expected schema", { error: itemParsed.error.message });
      continue;
    }
    items.push(itemParsed.data);
  }

  return { items, totalCount: parsed.data.result.total_count ?? items.length };
}
