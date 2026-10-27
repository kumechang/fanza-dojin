import type Database from "better-sqlite3";

// fanza_candidatesテーブルへのアクセス層。fetch-candidatesバッチが取得・検閲解析した
// 投稿候補プールを保持する(投稿タイミングでのFANZA APIライブ呼び出しをなくすため)。
export type RedactionStatus = "pending" | "analyzed" | "analysis_failed";

export interface UpsertCandidateInput {
  content_id: string;
  title: string;
  affiliate_url: string;
  sample_image_urls: string[];
  price: number | null;
  list_price: number | null;
  campaign_title: string | null;
  genre_names: string[];
  review_count: number | null;
  review_average: number | null;
  rank_order: number | null;
}

export interface FanzaCandidateRow {
  id: number;
  content_id: string;
  title: string;
  affiliate_url: string;
  sample_image_urls: string;
  price: number | null;
  list_price: number | null;
  campaign_title: string | null;
  genre_names: string | null;
  review_count: number | null;
  review_average: number | null;
  rank_order: number | null;
  redaction_status: RedactionStatus;
  redaction_ratio: number | null;
  redaction_detail: string | null;
  analyzed_at: string | null;
  fetched_at: string;
  last_seen_at: string | null;
  updated_at: string | null;
}

// fetch-candidatesバッチが取得した1件をプールへ反映する。content_id単位でUPSERTする
// (セール中は同じ作品が繰り返し観測されるため、プールには1作品1行のみ保持する)。
// サンプル画像URLが前回取得時と変わっていた場合、既存の検閲解析結果は古いサンプルに
// 基づくものになってしまうため、redaction_statusをpendingへ戻して再解析させる。
export function upsertCandidate(db: Database.Database, input: UpsertCandidateInput): void {
  const sampleImageUrlsJson = JSON.stringify(input.sample_image_urls);
  const existing = db
    .prepare(`SELECT sample_image_urls FROM fanza_candidates WHERE content_id = ?`)
    .get(input.content_id) as { sample_image_urls: string } | undefined;
  const imagesChanged = existing !== undefined && existing.sample_image_urls !== sampleImageUrlsJson;

  db.prepare(
    `INSERT INTO fanza_candidates
       (content_id, title, affiliate_url, sample_image_urls, price, list_price, campaign_title, genre_names, review_count, review_average, rank_order, last_seen_at, updated_at)
     VALUES (@content_id, @title, @affiliate_url, @sample_image_urls, @price, @list_price, @campaign_title, @genre_names, @review_count, @review_average, @rank_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(content_id) DO UPDATE SET
       title = excluded.title,
       affiliate_url = excluded.affiliate_url,
       sample_image_urls = excluded.sample_image_urls,
       price = excluded.price,
       list_price = excluded.list_price,
       campaign_title = excluded.campaign_title,
       genre_names = excluded.genre_names,
       review_count = excluded.review_count,
       review_average = excluded.review_average,
       rank_order = excluded.rank_order,
       last_seen_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  ).run({
    content_id: input.content_id,
    title: input.title,
    affiliate_url: input.affiliate_url,
    sample_image_urls: sampleImageUrlsJson,
    price: input.price,
    list_price: input.list_price,
    campaign_title: input.campaign_title,
    genre_names: JSON.stringify(input.genre_names),
    review_count: input.review_count,
    review_average: input.review_average,
    rank_order: input.rank_order,
  });

  if (imagesChanged) {
    db.prepare(
      `UPDATE fanza_candidates
       SET redaction_status = 'pending', redaction_ratio = NULL, redaction_detail = NULL, analyzed_at = NULL
       WHERE content_id = ?`
    ).run(input.content_id);
  }
}

// analyzeCandidatePool用: まだ黒塗り要否を判定していない候補を、取得が古い順にlimit件返す。
// 1回のバッチ実行で処理する件数を絞る(YOLO推論はコストが高いため)。処理しきれなかった分は
// pendingのまま残り、次回のバッチ実行に持ち越される。
export function getPendingCandidates(db: Database.Database, limit: number): FanzaCandidateRow[] {
  return db
    .prepare(`SELECT * FROM fanza_candidates WHERE redaction_status = 'pending' ORDER BY fetched_at ASC LIMIT ?`)
    .all(limit) as FanzaCandidateRow[];
}

// redactionRatioはサンプル画像群のうち最大の黒塗り面積率(監査・一覧表示用)。
// 投稿可否の判定自体はdetail(画像ごとのredactionRatio)を見るfanza/redactionPolicy.tsが行う。
export function markAnalyzed(db: Database.Database, id: number, redactionRatio: number, detail: unknown): void {
  db.prepare(
    `UPDATE fanza_candidates
     SET redaction_status = 'analyzed', redaction_ratio = ?, redaction_detail = ?, analyzed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(redactionRatio, JSON.stringify(detail), id);
}

// 解析に失敗した候補(画像ダウンロード失敗・サンプル画像なし等)。安全側に倒し、
// 黒塗り要否が判定できない作品は投稿候補として選ばれないようanalyzed以外のステータスに留める。
export function markAnalysisFailed(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE fanza_candidates SET redaction_status = 'analysis_failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
}

// selectFanzaCandidate用: 黒塗り要否の解析が完了し、かつseenSince以降にfetch-candidatesが観測した
// (=セールが続いているとみなせる)候補を、ランクの良い(rank_orderが小さい)順に全件返す。
// last_seen_atがNULL(未観測)の行は比較が偽になるため除外される。seenSinceは"YYYY-MM-DD HH:MM:SS"(UTC)。「黒塗りがほとんど不要か」の判定(ページ単位の間引き・作品ごと除外)はページごとの
// redaction_detailを見る必要があり、かつ閾値を選定のたびに(再解析なしで)反映したいため、
// SQL側では絞り込まずfanza/redactionPolicy.tsを使う呼び出し側(selectCandidate.ts)に委ねる。
export function getAnalyzedCandidatesOrderedByRank(db: Database.Database, seenSince: string): FanzaCandidateRow[] {
  return db
    .prepare(
      `SELECT * FROM fanza_candidates
       WHERE redaction_status = 'analyzed' AND last_seen_at >= ?
       ORDER BY rank_order ASC`
    )
    .all(seenSince) as FanzaCandidateRow[];
}

// 観測時刻に関係なく、解析済みの候補の総数。fetch-candidatesが止まってプール全体が古くなった状況を
// 「候補が無い」と区別して警告するために使う。
export function countAnalyzedCandidates(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM fanza_candidates WHERE redaction_status = 'analyzed'`).get() as {
    c: number;
  };
  return row.c;
}
