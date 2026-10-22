# fanza-dojin

FANZA(DMM)の同人コミックアフィリエイトを絡めたX自動投稿システム。

FANZA ItemList APIから同人ジャンル(`service=doujin`, `floor=digital_doujin`)の値引き中コミック作品をバッチ処理(`fetch-candidates`)で定期的に取得し、各作品のサンプル画像についてどれくらい黒塗り処理が必要か(`redaction_ratio`)を事前にDB(投稿候補プール`fanza_candidates`)へ保存しておく。投稿タイミング(`generate-posts`)では、このプールの中から「黒塗りがほとんど不要」と判定済み×人気(ランク)が高い作品を1件選ぶ(FANZA APIのライブ呼び出しはここでは行わない)。GitHub Issueでの人による承認を経て、Xに以下の形式で投稿する。

1. 1件目のツイート: タイトル + サンプル画像2枚
2. リプライでサンプル画像を2枚ずつ、全サンプル画像を貼り終えるまで続ける
3. 最後のリプライでアフィリエイトリンクを貼る

承認モードは`config/app.json`の`approvalMode`で`"manual"`(GitHub Issueへのコメントで承認) / `"auto"`(承認なしで即投稿) / `"telegram"`(黒塗り済みの画像をTelegramで人が確認し、ボタンで承認・却下。後述)を切り替え可能。`"auto"`では選定された候補をサンプル画像検閲込みでそのまま投稿する。コミック判定・値引き判定の誤爆は人の目を経ずそのまま投稿されるため、選定ロジック(`src/fanza/filterCandidates.ts`)を変更した際は特に注意すること。

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
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`: `approvalMode: "telegram"`のときの黒塗り結果の確認・承認用(後述)
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

### アカウントの一時停止

特定のアカウントを一時的に投稿対象から外したい場合、`X_ACCOUNTS_JSON`からエントリを削除する(認証情報ごと失われ、復元にはOAuth認可をやり直す手間がかかる)のではなく、`config/app.json`の`pausedAccountNames`にアカウント名を追加する。

```json
"pausedAccountNames": ["account1"]
```

これにより`npm run generate`(`generate-posts.yml`)がそのアカウント分をスキップするようになる(新規の投稿候補生成・投稿のみ止まる)。既存の投稿履歴(`posts`/`post_metrics`)には影響せず、`collect-metrics`等の集計は引き続き行われる。再開する場合は配列から名前を外すだけでよい。

## コマンド

```bash
npm run fetch-candidates # FANZA APIから値引き中×コミックの候補をバッチ取得し、黒塗り要否を解析してプールへ保存
npm run generate        # 投稿候補プールから投稿可能×人気の高い作品を1件選び、承認依頼(GitHub Issue / Telegram)を作成
npm run handle-approval # GitHub Issueコメント(承認/却下)を処理(Actionsのissue_commentイベント経由で実行)
npm run handle-telegram # Telegramの承認/却下ボタンの押下を処理(承認されたものをXへ投稿)
npm run collect-metrics # 投稿済みツイートのエンゲージメントを取得
npm run analyze-posting-times # エンゲージメント実績から時間帯ごとの投稿重みを算出
npm test                # ユニットテスト
npm run typecheck
```

## 投稿候補プールの構築(バッチ処理)

`src/pipeline/fetchCandidatePool.ts`が、FANZA ItemList APIを`sort=rank`(人気順)で`config/app.json`の`fanza.poolFetchPages`ページ分舐め、以下をすべて満たす作品を投稿候補プール(`fanza_candidates`テーブル、`content_id`単位でUPSERT)へ反映する。

- 値引きキャンペーン中(`campaign[]`が存在する。実地調査の結果、`prices.price < prices.list_price`は「常時のセール価格設定」の作品まで拾ってしまうため使わない)
- コミック作品である(`imageURL.large`のパスが`/digital/comic/`を含むかで判定。`iteminfo.genre[]`には「コミック」という汎用ジャンルタグがFANZA側に存在しないため、URLパスのメディア種別で判定している)

続けて`src/pipeline/analyzeCandidatePool.ts`が、まだ黒塗り要否を判定していない(`redaction_status = 'pending'`)候補について、サンプル画像をダウンロードし後述のEraX-NSFWで検出、**サンプル画像1枚(1ページ)ごとの黒塗り面積率**を算出して`redaction_detail`(JSON配列、`sample_image_urls`と同順)へ保存する(`redaction_ratio`列にはこのうち最大値を監査・一覧表示用に保持する)。1回のバッチ実行では`fanza.maxAnalysisPerRun`件までしか解析しない(YOLO推論はコストが高いため)。処理しきれなかった分はpendingのまま残り、次回の`fetch-candidates`実行に持ち越される。

この2ステップは`npm run fetch-candidates`(`fetch-candidates.yml`)としてまとめて実行され、投稿タイミングから切り離して定期的に(cron-job.org経由で)動かす。

## 投稿候補の選定ロジック(投稿タイミング)

`src/fanza/selectCandidate.ts`が、投稿候補プール(`fanza_candidates`)から以下をすべて満たす作品を、`rank_order`(取得時点のランク順の目安、値が小さいほど人気)が良い順に1件選ぶ。**FANZA APIのライブ呼び出しはここでは行わない**。

- 黒塗り要否の解析が完了している(`redaction_status = 'analyzed'`)
- まだ候補にしたことがない(`posts`テーブルの`content_id`で、承認済み・投稿済みのものだけを除外対象にする。却下・投稿失敗した作品は限られたセール在庫の中で再候補になり得るため除外しない)
- 投稿可能と判定されている(`src/fanza/redactionPolicy.ts`、詳細は次項)

サンプル画像URLがバッチ取得時から変わっていた場合(セールの入れ替わり等)、その候補の`redaction_status`は自動的に`pending`へ戻り、次回の`fetch-candidates`実行で再解析される。

### ページ単位の黒塗り判定(redactionPolicy)

作品全体を1つの黒塗り率で足切りするのではなく、**ページ(サンプル画像)単位**で投稿可否を判定し、問題のあるページだけをスレッドから間引く。

- サンプル画像1枚あたりの黒塗り面積率が`fanza.maxPageRedactionRatio`(既定30%)を超えるページは「投稿不可ページ」として、そのページだけを間引く(`selectPostablePageIndices`)
- 投稿不可ページの割合が`fanza.maxUnpostablePageRatio`(既定50%)を超える作品は、間引くとスレッドとして成立しない・元のサンプルの魅力を大きく損なうため、個別ページを間引くのではなく**作品自体**を投稿候補から除外する(`isWorkPostable`)

実際のプールデータで検証したところ、ページごとの黒塗り率はほぼ0%の安全なページと、ページ全体が黒塗りされる露骨なページとに二極化しており、20〜40%あたりは該当ページがほとんど無い「谷間」だった。`maxPageRedactionRatio`の既定値(30%)はこの谷間に置いている。

これらの閾値の判定は選定のたび(`generate-posts`実行ごと)に行い、バッチ解析時には確定させない。ページごとの黒塗り面積率は`fanza_candidates.redaction_detail`に保存済みのため、閾値を変更しても高コストなYOLO再解析なしにすぐ反映される。

## Telegramでの黒塗り結果の確認・承認

サンプル画像は性的な描写を含むため、GitHub Issueには上げず、**黒塗り後の画像をTelegramの非公開チャットで人が確認してから投稿する**モード(`approvalMode: "telegram"`)がある。GitHub Issueのモード(`manual`)は黒塗り前の元画像のURLを埋め込むため、アダルト画像の確認には向かない。

### 流れ

1. `generate-posts`が候補を選び、サンプル画像を黒塗りして、承認者のTelegramチャットへ送る(`protect_content`で転送・保存を禁止、リンクプレビューは無効)。末尾のメッセージに「承認して投稿」「却下」ボタンが付く。この時点では投稿しない(`posts.status = pending_approval`)
2. ボタンの押下を`handle-telegram.yml`がポーリング(`getUpdates`)で拾う。承認なら`finalizeApprovedPost`でXへスレッド投稿し、結果(投稿URL / 失敗理由)を同じメッセージに追記してボタンを消す。却下なら`rejected`にする
3. 投稿失敗時は「再試行」ボタンが付く。進捗はDBに保存されているため途中から再開し、重複投稿しない

確認時に見た画像と投稿される画像は、同じ画像を同じ検閲モデル・閾値で処理するため一致する(投稿確定時に改めて黒塗りする)。

### 選定時の挙動

Telegramモードでは、確認待ち(`pending_approval`)・却下済み(`rejected`)・投稿失敗(`post_failed`)の作品を、承認済み・投稿済みに加えて選定から除外する。人が黒塗り結果を見て判断するため、未確認のまま同じ作品の確認依頼が重複して届いたり、却下した作品がランク順の先頭として毎回再提示されたりしないようにするため。確認せずに放置した作品は、そのまま選定対象から外れる。

### セットアップ

1. Telegramで[@BotFather](https://t.me/BotFather)に`/newbot`を送り、Botを作ってトークンを控える
2. 作ったBotとの1対1チャットを開いて`/start`を送る
3. `https://api.telegram.org/bot<トークン>/getUpdates`をブラウザで開き、`message.chat.id`の値(承認者本人のchat id)を控える
4. GitHubリポジトリのSecretsに`TELEGRAM_BOT_TOKEN`と`TELEGRAM_CHAT_ID`を登録する
5. cron-job.orgに`handle-telegram.yml`を叩くジョブを追加する(下表。5〜10分おき)
6. `config/app.json`の`approvalMode`を`"telegram"`に変更する

`TELEGRAM_CHAT_ID`と一致するユーザー以外からのボタン押下は無視する。`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`が未設定のまま`approvalMode: "telegram"`にすると、誰にも確認依頼が届かないまま生成枠だけを消費してしまうため、その回は候補を作らずスキップする。

`handle-telegram.yml`はまず軽いジョブで未処理のボタン押下の有無だけを確認し、押下がある回だけ依存インストール・検閲モデルの準備を含む本体ジョブを動かす(押下が無い回のActions分数を最小限にするため)。それでもポーリング間隔を短くするほど実行回数は増える。

## 画像スレッド投稿

`src/pipeline/finalizeApprovedPost.ts`が、承認された候補についてサンプル画像をダウンロード→(検閲)→Xへアップロード→スレッド投稿する。画像枚数は作品ごとに異なり、途中でX APIエラーが起きる可能性もあるため、1ツイート確定するごとに進捗(`posts.thread_tweet_ids` / `images_posted_count` / `affiliate_tweet_posted`)をDBへ即時反映する。投稿失敗後に承認コメント(Telegramモードでは「再試行」ボタン)を再送すると、途中から再開する(重複投稿はしない)。

## サンプル画像の検閲(黒塗り)

サンプル画像の性的に露骨な描写部分は、投稿前に[EraX-NSFW-V1.0](https://huggingface.co/erax-ai/EraX-NSFW-V1.0)(YOLO11ベースの物体検出モデル、Apache 2.0)で自動検出し黒塗りする。同じ検出ロジックを、投稿候補プールの黒塗り要否判定(`redaction_ratio`算出)にも使い回している。

- 検出はNode.js(`src/x/censorImage.ts`)からPythonスクリプト(`scripts/censor_image.py`)をサブプロセスとして呼び出す形で行う(NudeNet等の実写向けモデルは同人イラストにほぼ機能しないことを実地検証済みで、EraX-NSFWに切り替えている)
- 検出対象クラス(5種類全部): `anus`, `make_love`, `nipple`, `penis`, `vagina`。`make_love`は性交描写全体を囲む広めのボックスで、画像の大部分〜全体が黒塗りされることがあるが、安全側に倒す判断で対象に含めている
- confidence閾値は0.10(アニメ調イラストは実写より確信度が出にくいため低めに設定。実運用で検出漏れが確認されたため0.15から引き下げた)
- モデルファイル(`models/erax_nsfw_yolo11m.pt`、約40MB)は`.gitignore`対象で、`scripts/ensure_erax_model.py`が無ければHugging Faceから取得する。GitHub Actionsでは`actions/cache`でキャッシュし、実行のたびのダウンロードを避けている
- `src/x/censorImage.ts`は2つの関数を提供する。`censorImages`は実際に黒塗りした画像を返す(投稿確定時`finalizeApprovedPost`が使用)。`analyzeCensorship`は黒塗り済み画像を保存せず、検出box(パディング込み)の面積被覆率`redactionRatio`(0〜1、画像ごとのピクセル単位マスクの論理和で算出、box重複を二重カウントしない)だけを返す(投稿候補プールの事前解析`analyzeCandidatePool`が使用)。DBには画像バイナリを持たない設計のため、プール解析時に生成した黒塗り画像は使い捨てる
- 検閲に失敗した場合(Pythonプロセスの起動失敗・タイムアウト等)、投稿確定時(`censorImages`)は例外として投稿処理全体が失敗する(`markPostFailed`、`post_failed`扱いになりIssueに通知される)。**検閲できなければ投稿しない**というフェイルセーフをこの仕組みで実現している。一方プール解析時(`analyzeCensorship`)の失敗は該当候補を`analysis_failed`にするだけで、バッチ全体は止めない(1作品の失敗が他候補の解析機会を奪わないため)
- `config/app.json`の`censorSampleImages`(既定`true`)を`false`にすると投稿確定時の検閲をスキップできる(検出モデル側で問題が起きた際の緊急停止用)。プール解析(`redaction_ratio`算出)自体は`censorSampleImages`の影響を受けない(投稿候補の事前フィルタとして独立して動作する)

## GitHub Actions

- `fetch-candidates.yml`: FANZAの値引き中×コミック作品をバッチ取得して投稿候補プール(`fanza_candidates`)へ反映し、続けて黒塗り要否(`redaction_ratio`)が未解析の候補を解析する(`npm run fetch-candidates`)。生成タイミングとは独立して定期実行する。
- `generate-posts.yml`: 投稿候補プールから「黒塗りがほとんど不要」と判定済み×人気の高い同人コミックを選び、投稿候補の生成を試みる。実際に生成するかは`shouldGenerateNow`(1日の目標投稿数`targetPostsPerDay`・直近投稿からの間隔`minSpacingHours`・時間帯の重み)が判断し、投稿可能時間帯(`postingWindow`、既定JST 7時〜翌2時)の外であればアプリ側(`isWithinPostingWindow`)でスキップする。`approvalMode: "auto"`の場合はその場で投稿(検閲含む)まで行い、`"telegram"`の場合は黒塗り済み画像をTelegramへ送るため、`"manual"`以外のときだけPythonセットアップ・検閲モデルのキャッシュ復元を行い、`"manual"`ではスキップしてActions実行時間を節約する。
- `handle-approval.yml`: Issueコメントに「承認」/「却下」と書かれたら処理(`pending-approval`ラベルが付いたIssueのみ反応)。承認時は画像検閲を伴うため、承認モードによらず毎回Pythonセットアップを行う。
- `handle-telegram.yml`: Telegramの承認/却下ボタンの押下を処理する(`approvalMode: "telegram"`用)。押下が無い回は軽い確認ジョブだけで終わる。承認時は画像検閲を伴うため、押下がある回はPythonセットアップを行う。
- `collect-metrics.yml`: 投稿済みツイートのエンゲージメントを取得し`post_metrics`に記録。
- `analyze-posting-times.yml`: `post_metrics`を時間帯別に集計しClaudeに分析させ、`posting_time_weights`(反応の良い時間帯ほど高い重み)を更新する。データが少ない(投稿済み10件未満)うちは分析をスキップし、重みは既定の均等のまま。週1回なので数時間の遅延は無視でき、cron-job.org側の設定漏れ・失敗に備えてGitHub Actionsの`schedule`(毎週日曜JST 09:37)もフォールバックとして残している(他の2つは高頻度のため`schedule`の遅延問題を避けて`workflow_dispatch`のみ)。

いずれも`data/app.db`(SQLite)を実行後にbotコミットしてリポジトリに戻す。DB書き込みが競合しないよう`concurrency: db-write`グループを共有。

### スケジュール実行(cron-job.org)

GitHub Actionsの`schedule`トリガーは実測で30分間隔の設定に対し実際は5〜6時間に1回程度しか発火しないという著しい遅延が確認された(GitHub側の既知の制限で、間隔を短くしても改善しない)。そのため上記のworkflowはいずれも`schedule`を使わず、`workflow_dispatch`のみを起点とし、外部の[cron-job.org](https://cron-job.org/)から一定間隔でGitHubの`workflow_dispatch` APIを叩く方式にしている。

cron-job.org側で以下のジョブを設定する(いずれもURLの`{owner}/{repo}`は`kumechang/fanza-dojin`):

| ジョブ | 頻度 | URL |
| --- | --- | --- |
| Fetch Candidate Pool | 数時間おき(投稿候補プールの鮮度維持。値引きセールの入れ替わり頻度を踏まえた目安で、厳密な間隔は問わない) | `https://api.github.com/repos/{owner}/{repo}/actions/workflows/fetch-candidates.yml/dispatches` |
| Handle Telegram Approvals | 5〜10分おき(`approvalMode: "telegram"`のときのみ。ボタンを押してから投稿されるまでの最大待ち時間がこの間隔になる) | `https://api.github.com/repos/{owner}/{repo}/actions/workflows/handle-telegram.yml/dispatches` |
| Generate Posts | 30分おき(24時間、時間帯判定はアプリ側で行うため常時叩いてよい) | `https://api.github.com/repos/{owner}/{repo}/actions/workflows/generate-posts.yml/dispatches` |
| Collect Metrics | 毎日1回 | `https://api.github.com/repos/{owner}/{repo}/actions/workflows/collect-metrics.yml/dispatches` |
| Analyze Posting Times | 週1回 | `https://api.github.com/repos/{owner}/{repo}/actions/workflows/analyze-posting-times.yml/dispatches` |

各ジョブの設定:
- Method: `POST`
- Headers: `Authorization: Bearer <GitHubのPersonal Access Token>` / `Accept: application/vnd.github+json` / `X-GitHub-Api-Version: 2022-11-28`
- Body(JSON): `{"ref":"main"}`

PATはこのリポジトリに対して`Actions: Read and write`権限を持つfine-grained PAT(GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens)を発行し、cron-job.org側にのみ登録する(GitHub Secretsには登録不要)。有効期限が切れると全ジョブが失敗するため、期限が近づいたら更新する。

### 必要なSecrets

- `ANTHROPIC_API_KEY`
- `FANZA_API_ID` / `FANZA_AFFILIATE_ID`
- `X_API_KEY` / `X_API_SECRET`
- `X_ACCOUNTS_JSON`
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`(`approvalMode: "telegram"`のときのみ)

`GITHUB_TOKEN`はActions上で自動付与される。
