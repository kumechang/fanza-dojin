import type { FanzaItem } from "./types.js";

// 同人フロア(digital_doujin)にはコミック以外(CG集・ボイス・ゲーム等)も混在しており、
// iteminfo.genre[]には汎用的な「コミック」ジャンルタグが存在しない(実地調査で確認済み)。
// 代わりにimageURL.largeのパスに/digital/comic/(コミック)/digital/game/(ゲーム)/
// /digital/cg/(CG集)/digital/voice/(ボイス)というメディア種別が現れることを利用して判定する。
export function isComic(item: FanzaItem): boolean {
  const url = item.imageURL?.large;
  if (!url) return false;
  return /\/digital\/comic\//.test(url);
}

// セール専用のbooleanフィールドは存在しない。実地調査の結果、price<list_priceは
// 「常時のセール価格設定」の作品まで拾ってしまい「値引きキャンペーンが行われている」という
// 要件とズレるため、"○○%OFF"等の名称を持つcampaign[]の有無のみで判定する。
export function isDiscounted(item: FanzaItem): boolean {
  return Boolean(item.campaign && item.campaign.length > 0);
}
