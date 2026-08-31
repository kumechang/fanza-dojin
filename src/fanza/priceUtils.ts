// FANZAの価格文字列は "1000" のような単純な数値だけでなく、複数配信タイプがある場合
// "100~"のような幅表記になることがある。投稿用途では最安値が分かれば十分なため、
// 文字列先頭の数値部分だけを取り出す。パースできない場合はnullを返し、
// 呼び出し側で「値引き判定に使わない」よう扱う。
export function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/\d+/);
  if (!match) return null;
  return Number(match[0]);
}
