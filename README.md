# fanza-dojin

FANZA(DMM)の同人コミックアフィリエイトを絡めたX自動投稿システム。

FANZA ItemList APIから同人ジャンル(`service=doujin`, `floor=digital_doujin`)のコミック作品を検索し、値引きキャンペーン中かつその中で人気(ランク)が高い作品を1件選ぶ。GitHub Issueでの人による承認を経て、Xに以下の形式で投稿する。

1. 1件目のツイート: タイトル + サンプル画像2枚
2. リプライでサンプル画像を2枚ずつ、全サンプル画像を貼り終えるまで続ける
3. 最後のリプライでアフィリエイトリンクを貼る

承認モードは`config/app.json`の`approvalMode`で`"manual"` / `"auto"`を切り替え可能(成人向けコンテンツのため既定は`"manual"`)。

## セットアップ

```bash
npm install
cp .env.example .env
```

`.env`に以下を設定(ローカル実行時のみ必要。GitHub Actions上ではSecretsを使用):

- `ANTHROPIC_API_KEY`: Claude APIキー(投稿時間帯の重み分析にのみ使用。投稿文自体の生成には使わない)
- `FANZA_API_ID` / `FANZA_AFFILIATE_ID`: FANZA(DMM) Affiliate APIの認証情報
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET`: X API v2(OAuth 1.0a user context)の認証情報
- `GITHUB_TOKEN` / `GITHUB_REPOSITORY`: ローカルからGitHub Issue操作を試す場合のみ

各キーが未設定でも処理は落ちず、ドライラン(ログ出力のみ)で動作する。

## コマンド

```bash
npm run generate        # FANZA APIから値引き中×人気の高い同人コミックを1件選び、GitHub Issueを作成
npm run handle-approval # GitHub Issueコメント(承認/却下)を処理(Actionsのissue_commentイベント経由で実行)
npm run collect-metrics # 投稿済みツイートのエンゲージメントを取得
npm run analyze-posting-times # エンゲージメント実績から時間帯ごとの投稿重みを算出
npm test                # ユニットテスト
npm run typecheck
```

## 投稿候補の選定ロジック

`src/fanza/selectCandidate.ts`が、FANZA ItemList APIを`sort=rank`(人気順)でページングしながら舐め、以下をすべて満たす最初の1件を採用する。

- 値引きキャンペーン中(`campaign[]`が存在する。実地調査の結果、`prices.price < prices.list_price`は「常時のセール価格設定」の作品まで拾ってしまうため使わない)
- コミック作品である(`imageURL.large`のパスが`/digital/comic/`を含むかで判定。`iteminfo.genre[]`には「コミック」という汎用ジャンルタグがFANZA側に存在しないため、URLパスのメディア種別で判定している)
- まだ候補にしたことがない(`posts`テーブルの`content_id`で、承認済み・投稿済みのものだけを除外対象にする。却下・投稿失敗した作品は限られたセール在庫の中で再候補になり得るため除外しない)

## 画像スレッド投稿

`src/pipeline/finalizeApprovedPost.ts`が、承認された候補についてサンプル画像をダウンロード→Xへアップロード→スレッド投稿する。画像枚数は作品ごとに異なり、途中でX APIエラーが起きる可能性もあるため、1ツイート確定するごとに進捗(`posts.thread_tweet_ids` / `images_posted_count` / `affiliate_tweet_posted`)をDBへ即時反映する。投稿失敗後に承認コメントを再送すると、途中から再開する(重複投稿はしない)。

## GitHub Actions

- `generate-posts.yml`: 投稿可能時間帯(`postingWindow`、既定JST 7〜23時)の間、毎時投稿候補の生成を試みる。実際に生成するかは`shouldGenerateNow`(1日の目標投稿数`targetPostsPerDay`・直近投稿からの間隔`minSpacingHours`・時間帯の重み)が判断する。`approvalMode: "auto"`の場合はその場で投稿まで行う。
- `handle-approval.yml`: Issueコメントに「承認」/「却下」と書かれたら処理(`pending-approval`ラベルが付いたIssueのみ反応)。
- `collect-metrics.yml`: 毎日、投稿済みツイートのエンゲージメントを取得し`post_metrics`に記録。
- `analyze-posting-times.yml`: 週1回、`post_metrics`を時間帯別に集計しClaudeに分析させ、`posting_time_weights`(反応の良い時間帯ほど高い重み)を更新する。データが少ない(投稿済み10件未満)うちは分析をスキップし、重みは既定の均等のまま。

いずれも`data/app.db`(SQLite)を実行後にbotコミットしてリポジトリに戻す。DB書き込みが競合しないよう`concurrency: db-write`グループを共有。

GitHub Actionsの`schedule`は数時間単位で遅延・スキップされることがある(GitHub側の既知の制限)。毎時起動にしているのはこの影響を緩和するためで、`generate-posts.yml`が深夜など不自然な時間帯(`postingWindow`の範囲外)に実行された場合は投稿候補を作らずスキップする。

### 必要なSecrets

- `ANTHROPIC_API_KEY`
- `FANZA_API_ID` / `FANZA_AFFILIATE_ID`
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET`

`GITHUB_TOKEN`はActions上で自動付与される。
