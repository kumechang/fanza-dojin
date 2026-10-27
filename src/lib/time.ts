// JST関連の時刻計算をまとめたユーティリティ。
// en-USロケール + hour12:false で取得する。日本語ロケールでは単位付き文字列になる
// (postConditions.tsの季節バグと同種の問題)ことがあるため避ける。
// また、深夜0時をhour12:falseで取得すると"24"を返す実装があるため0に正規化する。
export function getJstHour(date: Date): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false })
    .formatToParts(date)
    .find((p) => p.type === "hour");
  const hour = Number(part?.value);
  return hour === 24 ? 0 : hour;
}

// JSTでの日付を "YYYY-MM-DD" で返す。1日の投稿数カウントなど、JSTのカレンダー日で
// 区切りたい場面向け。en-CAロケールはハイフン区切りのYYYY-MM-DDを返すため利用する。
export function getJstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
}

// SQLiteのCURRENT_TIMESTAMPは "YYYY-MM-DD HH:MM:SS" (UTC、タイムゾーン情報なし)形式。
// そのままnew Date()に渡すとブラウザ/Node実装によって解釈が揺れるため、
// ISO 8601形式に変換してからパースする。
export function parseDbTimestamp(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

// parseDbTimestampの逆。DateをSQLiteのCURRENT_TIMESTAMPと同じ "YYYY-MM-DD HH:MM:SS" (UTC)形式にする。
// 文字列のまま列と大小比較できる(SQLの `last_seen_at >= ?` 等)。
export function formatDbTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
