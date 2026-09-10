// config/app.json の型定義。
export interface AppConfig {
  approvalMode: "manual" | "auto";
  claudeModel: string; // 投稿時間帯の重み分析(analyzePostingTimes)にのみ使用
  platform: string;
  xCharLimit: number;
  // このアカウントが投稿していて不自然でない時間帯(JST)。
  // scheduleの発火遅延でこの範囲外にズレ込んだ場合、その回は投稿候補を作らずスキップする。
  postingWindow: {
    startHour: number;
    endHour: number;
  };
  // 1日あたりの目標投稿候補数。generate-postsは投稿可能時間帯の間毎時起動するが、
  // 実際に生成するかはshouldGenerateNowがこの目標値をもとに確率的に判断する。
  targetPostsPerDay: number;
  // 直近の投稿候補作成からこの時間(h)未満なら、次の生成をスキップする(連投防止)。
  minSpacingHours: number;
  // サンプル画像の性的な描写部分をEraX-NSFW(YOLO11)で検出し黒塗りするかどうか。
  // false時は検閲をスキップしてそのまま投稿する(検出モデル側の不具合等に備えた緊急停止用)。
  censorSampleImages: boolean;
  // 一時的に新規投稿候補の生成・投稿を止めたいXアカウント名(X_ACCOUNTS_JSONのname)の一覧。
  // X_ACCOUNTS_JSON自体からエントリを削除すると認証情報ごと失われ復元が手間になるため、
  // ここに名前を追加するだけで一時停止でき、外せばすぐ再開できるようにしている。
  // 既存の投稿履歴(posts/post_metrics)には影響しない(collect-metrics等は対象外)。
  pausedAccountNames: string[];
  // FANZA ItemList APIから同人コミックの値引き候補を探すための設定。
  fanza: {
    site: string;   // "FANZA"
    service: string; // "doujin"
    floor: string;   // "digital_doujin"
    hits: number;    // 1リクエストあたりの取得件数(最大100)
    imagesPerTweet: number; // 1ツイートに添付するサンプル画像枚数
    // fetch-candidatesバッチが投稿候補プールを更新する際、sort=rank順に何ページ舐めるか。
    poolFetchPages: number;
    // 1回のfetch-candidatesバッチ実行で黒塗り要否解析(YOLO推論)を行う候補数の上限。
    // 推論コストが高いため、処理しきれない分はpendingのまま次回実行に持ち越す。
    maxAnalysisPerRun: number;
    // サンプル画像1枚(1ページ)あたりの黒塗り面積率がこれを超えたら「投稿不可ページ」として、
    // そのページだけをスレッドから間引く(0〜1)。
    maxPageRedactionRatio: number;
    // 投稿不可ページの割合がこれを超えたら、個別ページを間引くのではなく作品自体を
    // 投稿候補から除外する(0〜1)。
    maxUnpostablePageRatio: number;
  };
}
