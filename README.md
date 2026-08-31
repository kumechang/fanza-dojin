# fanza-dojin

FANZA(DMM)の同人コミックアフィリエイトを絡めたX自動投稿システム。

FANZA ItemList APIから同人ジャンル(`service=doujin`, `floor=digital_doujin`)のコミック作品を検索し、値引きキャンペーン中かつその中で人気(ランク)が高い作品を1件選ぶ。GitHub Issueでの人による承認を経て、Xに以下の形式で投稿する。

1. 1件目のツイート: タイトル + サンプル画像2枚
2. リプライでサンプル画像を2枚ずつ、全サンプル画像を貼り終えるまで続ける
3. 最後のリプライでアフィリエイトリンクを貼る

承認モードは`config/app.json`の`approvalMode`で`"manual"` / `"auto"`を切り替え可能。現在は`"auto"`(選定された候補をサンプル画像検閲込みでそのまま投稿する)で運用している。コミック判定・値引き判定の誤爆は人の目を経ずそのまま投稿されるため、選定ロジック(`src/fanza/filterCandidates.ts`)を変更した際は特に注意すること。

**複数のXアカウントで同時に運用できる**(それぞれ別の作品を投稿する)。アカウント間の重複投稿防止は行わない(たまたま同じ作品が被ることは許容する)。

## セットアップ

```bash
npm install
cp .env.example .env
```

サンプル画像の性的な描写部分を自動で黒塗りする検閲機能(後述)にはPython 3.11が必要。

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

`.env`に以下を設定(ローカル実行時のみ必要。GitHub Actions上ではSecretsを使用):

- `ANTHROPIC_API_KEY`: Claude APIキー(投稿時間帯の重み分析にのみ使用。投稿文自体の生成には使わない)
- `FANZA_API_ID` / `FANZA_AFFILIATE_ID`: FANZA(DMM) Affiliate APIの認証情報
- `X_API_KEY` / `X_API_SECRET`: X API v2のDeveloperアプリキー(全アカウント共通)
- `X_ACCOUNTS_JSON`: 投稿先アカウントごとの認証情報をまとめたJSON配列(後述)
- `GITHUB_TOKEN` / `GITHUB_REPOSITORY`: ローカルからGitHub Issue操作を試す場合のみ

各キーが未設定でも処理は落ちず、ドライラン(ログ出力のみ)で動作する。

## 複数アカウントの追加方法

新しいXアカウントでこのシステムを使いたい場合、コードやworkflowの変更は不要で、`X_ACCOUNTS_JSON`に1エントリ追記するだけでよい。

1. 追加したいXアカウントでログインした状態のブラウザを用意する
2. `npm run get-x-token:start` を実行し、表示されたURLをそのブラウザで開いて認可、PINコードを取得する
3. `npm run get-x-token:finish -- <PINコード>` を実行すると、`X_ACCOUNTS_JSON`に追記すべきJSON片が出力される
4. それを`.env`(ローカル)または`X_ACCOUNTS_JSON` Secret(GitHub Actions)のJSON配列に追記する

`X_ACCOUNTS_JSON`の形式:
```json
[
  {"name": "account1", "accessToken": "...", "accessSecret": "..."},
  {"name": "account2", "accessToken": "...", "accessSecret": "..."}
]
```

`npm run x-whoami -- <account名>` で、その名前がどのXアカウントに紐づいているか確認できる。

複数アカウントを認可する場合、一時ファイル`.x-oauth-temp.json`を使い回すため、1アカウントずつ`start`→`finish`を完了させてから次に進むこと(並行実行不可)。

`npm run generate`は`X_ACCOUNTS_JSON`に登録された全アカウント分を順番に処理する(投稿頻度・重複防止の判定はアカウントごとに独立)。1アカウントの失敗が他アカウントの処理を止めることはない。

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

`src/pipeline/finalizeApprovedPost.ts`が、承認された候補についてサンプル画像をダウンロード→(検閲)→Xへアップロード→スレッド投稿する。画像枚数は作品ごとに異なり、途中でX APIエラーが起きる可能性もあるため、1ツイート確定するごとに進捗(`posts.thread_tweet_ids` / `images_posted_count` / `affiliate_tweet_posted`)をDBへ即時反映する。投稿失敗後に承認コメントを再送すると、途中から再開する(重複投稿はしない)。

## サンプル画像の検閲(黒塗り)

サンプル画像の性的に露骨な描写部分は、投稿前に[EraX-NSFW-V1.0](https://huggingface.co/erax-ai/EraX-NSFW-V1.0)(YOLO11ベースの物体検出モデル、Apache 2.0)で自動検出し黒塗りする。

- 検出はNode.js(`src/x/censorImage.ts`)からPythonスクリプト(`scripts/censor_image.py`)をサブプロセスとして呼び出す形で行う(NudeNet等の実写向けモデルは同人イラストにほぼ機能しないことを実地検証済みで、EraX-NSFWに切り替えている)
- 検出対象クラス(5種類全部): `anus`, `make_love`, `nipple`, `penis`, `vagina`。`make_love`は性交描写全体を囲む広めのボックスで、画像の大部分〜全体が黒塗りされることがあるが、安全側に倒す判断で対象に含めている
- confidence閾値は0.15(アニメ調イラストは実写より確信度が出にくいため低めに設定)
- モデルファイル(`models/erax_nsfw_yolo11m.pt`、約40MB)は`.gitignore`対象で、`scripts/ensure_erax_model.py`が無ければHugging Faceから取得する。GitHub Actionsでは`actions/cache`でキャッシュし、実行のたびのダウンロードを避けている
- 検閲に失敗した場合(Pythonプロセスの起動失敗・タイムアウト等)は例外として投稿処理全体が失敗する(`markPostFailed`、`post_failed`扱いになりIssueに通知される)。**検閲できなければ投稿しない**というフェイルセーフをこの仕組みで実現している
- `config/app.json`の`censorSampleImages`(既定`true`)を`false`にすると検閲をスキップできる(検出モデル側で問題が起きた際の緊急停止用)

## GitHub Actions

- `generate-posts.yml`: 投稿可能時間帯(`postingWindow`、既定JST 7時〜翌2時。日をまたぐ時間帯は`startHour > endHour`で表現する)の間、30分おきに投稿候補の生成を試みる。実際に生成するかは`shouldGenerateNow`(1日の目標投稿数`targetPostsPerDay`・直近投稿からの間隔`minSpacingHours`・時間帯の重み)が判断する。`approvalMode: "auto"`の場合はその場で投稿(検閲含む)まで行うため、`approvalMode`が`"auto"`のときだけPythonセットアップ・検閲モデルのキャッシュ復元を行い、`"manual"`(既定)ではスキップしてActions実行時間を節約する。
- `handle-approval.yml`: Issueコメントに「承認」/「却下」と書かれたら処理(`pending-approval`ラベルが付いたIssueのみ反応)。承認時は画像検閲を伴うため、承認モードによらず毎回Pythonセットアップを行う。
- `collect-metrics.yml`: 毎日、投稿済みツイートのエンゲージメントを取得し`post_metrics`に記録。
- `analyze-posting-times.yml`: 週1回、`post_metrics`を時間帯別に集計しClaudeに分析させ、`posting_time_weights`(反応の良い時間帯ほど高い重み)を更新する。データが少ない(投稿済み10件未満)うちは分析をスキップし、重みは既定の均等のまま。

いずれも`data/app.db`(SQLite)を実行後にbotコミットしてリポジトリに戻す。DB書き込みが競合しないよう`concurrency: db-write`グループを共有。

GitHub Actionsの`schedule`は数時間単位で遅延・スキップされることがある(GitHub側の既知の制限)。30分おきに起動しているのはこの影響を緩和するためで、`generate-posts.yml`が`postingWindow`の範囲外に実行された場合は投稿候補を作らずスキップする。

### 必要なSecrets

- `ANTHROPIC_API_KEY`
- `FANZA_API_ID` / `FANZA_AFFILIATE_ID`
- `X_API_KEY` / `X_API_SECRET`
- `X_ACCOUNTS_JSON`

`GITHUB_TOKEN`はActions上で自動付与される。
