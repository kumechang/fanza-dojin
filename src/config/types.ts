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
  // FANZA ItemList APIから同人コミックの値引き候補を探すための設定。
  fanza: {
    site: string;   // "FANZA"
    service: string; // "doujin"
    floor: string;   // "digital_doujin"
    hits: number;    // 1リクエストあたりの取得件数(最大100)
    maxPages: number; // sort=rank順に何ページまで舐めて値引き中の候補を探すか
    imagesPerTweet: number; // 1ツイートに添付するサンプル画像枚数
  };
}
