// 投稿候補プール(fanza_candidates)に保存済みの、サンプル画像1枚ごとの黒塗り面積率から、
// 「どのページを投稿してよいか」「その作品自体を投稿候補としてよいか」を判定する純粋関数群。
// 選定時(generate-posts実行のたび)に判定するため、閾値をconfig/app.jsonで変更しても
// 再解析(コストの高いYOLO推論のバッチ処理)なしにすぐ反映される。
export interface PageRedactionInfo {
  redactionRatio: number;
}

// 実データ(fanza_candidatesの解析結果)では、ページごとの黒塗り率はほぼ0%の安全なページと、
// ページ全体が黒塗りされる露骨なページとに二極化しており、20〜40%あたりは該当ページが
// ほとんど無い「谷間」になっている。maxPageRedactionRatio(既定30%)はこの谷間に置く。
export function selectPostablePageIndices(detail: PageRedactionInfo[], maxPageRedactionRatio: number): number[] {
  return detail.flatMap((page, index) => (page.redactionRatio <= maxPageRedactionRatio ? [index] : []));
}

// 投稿不可ページ(maxPageRedactionRatio超)が全体のmaxUnpostablePageRatio(既定50%)を超える
// 作品は、間引くとスレッドとして成立しない・元のサンプルの魅力を大きく損なうため、
// 個別ページを間引くのではなく作品自体を投稿候補から除外する。
export function isWorkPostable(
  detail: PageRedactionInfo[],
  maxPageRedactionRatio: number,
  maxUnpostablePageRatio: number
): boolean {
  if (detail.length === 0) return false;
  const postableCount = selectPostablePageIndices(detail, maxPageRedactionRatio).length;
  const unpostableRatio = (detail.length - postableCount) / detail.length;
  return unpostableRatio <= maxUnpostablePageRatio;
}
