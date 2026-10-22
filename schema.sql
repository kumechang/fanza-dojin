-- FANZA ItemList APIから都度取得した候補1件につき1行。生成AIによる文面生成は行わず
-- 商品タイトルをそのまま投稿文として使うため、strategy_json等の生成AI関連カラムは持たない。
-- pending_approval -> approved/rejected -> posted/posted_dryrun/post_failed というライフサイクルは
-- 旧productsテーブル運用時から変更していない。
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL DEFAULT 'X',
  account_name TEXT NOT NULL DEFAULT '', -- X_ACCOUNTS_JSONのname。投稿履歴・重複防止・投稿頻度制御をアカウント単位で行うためのキー

  -- FANZA ItemList APIから取得した候補の情報(取得時点のスナップショット)。
  content_id TEXT NOT NULL, -- FANZA側の商品ID。UNIQUE制約は付けない(却下/投稿失敗した作品は
                             -- 限られたセール在庫の中で再候補になり得るため。除外は選定ロジック側で行う)
  title TEXT NOT NULL,      -- 投稿文としてそのまま使う
  affiliate_url TEXT NOT NULL,
  sample_image_urls TEXT NOT NULL, -- JSON配列(sampleImageURL.sample_l.image[]、順序保持)
  price INTEGER,            -- 取得時点のセール価格(price文字列のパース失敗時はNULL)
  list_price INTEGER,       -- 取得時点の定価(同上)
  campaign_title TEXT,      -- campaign[0].title等。値引き判定根拠の監査用
  genre_names TEXT,         -- iteminfo.genre[].name のJSON配列。コミック判定根拠の監査用
  review_count INTEGER,
  review_average REAL,
  fetch_offset INTEGER,     -- ItemList取得時のoffset(何ページ目から見つかったかの監査用)

  status TEXT NOT NULL DEFAULT 'pending_approval',
    -- pending_approval | approved | rejected | posted | posted_dryrun | post_failed
  github_issue_number INTEGER UNIQUE,
  github_issue_url TEXT,
  approved_by TEXT,
  approval_comment_body TEXT,

  -- Xスレッド投稿の進捗。中断(投稿失敗)からの再開に対応するため、1ツイート確定するごとに随時更新する。
  thread_tweet_ids TEXT NOT NULL DEFAULT '[]',    -- JSON配列。[0]=先頭ツイート, 以降=画像リプライ, 最後=アフィリエイトリンク
  images_posted_count INTEGER NOT NULL DEFAULT 0, -- スレッドに貼り終えたサンプル画像の累計枚数
  affiliate_tweet_posted INTEGER NOT NULL DEFAULT 0, -- アフィリエイトリンクのリプライまで完了したか(0/1)
  selected_image_indices TEXT, -- Telegram承認で人が選んだ画像のsample_image_urls上の添字(JSON配列、昇順)。NULLは全画像を投稿する

  tweet_id TEXT,   -- 先頭ツイートのID。post_metricsが参照する
  tweet_url TEXT,
  post_error TEXT, -- 投稿失敗時のエラーメッセージ
  run_id TEXT,     -- GitHub ActionsのRun ID(トレース用)
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  approved_at TEXT,
  posted_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_content_id ON posts(content_id);
CREATE INDEX IF NOT EXISTS idx_posts_account_status ON posts(account_name, status);

-- 投稿ごとのエンゲージメントを「最新値で上書き」ではなくスナップショットとして時系列に蓄積する
-- (将来のフィードバックループ用。engagement_rateは記録時点で計算して保存)。
CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  collected_at TEXT NOT NULL,
  impressions INTEGER,
  likes INTEGER,
  reposts INTEGER,
  replies INTEGER,
  bookmarks INTEGER,
  engagement_rate REAL
);
CREATE INDEX IF NOT EXISTS idx_metrics_post ON post_metrics(post_id);

-- 時間帯(JST 0-23時)ごとの投稿重み。週次のanalyze-posting-timesが更新する。
-- データ不足で未分析の時間帯はデフォルト1.0(均等)のまま残る。
CREATE TABLE IF NOT EXISTS posting_time_weights (
  hour INTEGER PRIMARY KEY, -- 0-23 (JST)
  weight REAL NOT NULL DEFAULT 1.0,
  reason TEXT,              -- Claudeが重みをそう判断した理由(監査用)
  updated_at TEXT
);

-- fetch-candidatesバッチが定期的にFANZA ItemList APIから取得する投稿候補プール。
-- 「コミック × 値引き中」の作品をcontent_id単位でUPSERTし、各作品のサンプル画像群について
-- どれくらい黒塗りが必要か(redaction_ratio)を非同期に判定しておく。投稿タイミング
-- (generateCandidate)ではこのテーブルを参照するだけで、FANZA APIのライブ呼び出しは行わない。
CREATE TABLE IF NOT EXISTS fanza_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL UNIQUE, -- postsと異なりプールは1作品1行のみ保持する(セール中は繰り返し観測されるため)
  title TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  sample_image_urls TEXT NOT NULL, -- JSON配列。この内容が変わった場合はredaction_statusをpendingへ戻す
  price INTEGER,
  list_price INTEGER,
  campaign_title TEXT,
  genre_names TEXT,
  review_count INTEGER,
  review_average REAL,
  rank_order INTEGER, -- sort=rank走査時の掲載順(値が小さいほど人気)。選定時の並び順に使う

  redaction_status TEXT NOT NULL DEFAULT 'pending', -- pending | analyzed | analysis_failed
  redaction_ratio REAL,   -- サンプル画像群のうち最大の黒塗り面積率(0〜1、監査・一覧表示用)。analyzed時のみ設定
  redaction_detail TEXT,  -- 画像ごとの検出詳細・黒塗り面積率のJSON配列(sample_image_urlsと同順)。
                          -- 投稿可否の判定(ページ単位の間引き・作品ごと除外)はこれを使う
  analyzed_at TEXT,

  fetched_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fanza_candidates_selection ON fanza_candidates(redaction_status, rank_order);
