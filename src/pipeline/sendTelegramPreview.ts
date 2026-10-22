import type { AppConfig } from "../config/types.js";
import type { PostRow } from "../db/repositories/postsRepo.js";
import { downloadImage, chunkImages, type DownloadedImage } from "../x/mediaUpload.js";
import { censorImages } from "../x/censorImage.js";
import { sendImages, sendMessageWithButtons, type InlineButton } from "../telegram/client.js";
import { buildCallbackData, buildToggleCallbackData } from "../telegram/callbackData.js";

// Telegramのメディアグループは1メッセージ最大10枚。
const MAX_IMAGES_PER_GROUP = 10;
// 番号ボタンは1行あたりこの数だけ並べる。
const BUTTONS_PER_ROW = 5;

export interface PreviewContent {
  accountName: string;
  title: string;
  price: number | null;
  listPrice: number | null;
  campaignTitle: string | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  pageCount: number; // 送った画像の枚数(黒塗り超過で間引いた後)
  droppedPageCount: number; // 黒塗り超過で間引いた枚数
}

// 承認者がボタンを押す前に判断材料として読むテキスト。リンクは入れない
// (リンクプレビューにFANZAの黒塗り前の画像が展開されるのを避けるため)。
export function buildPreviewText(content: PreviewContent): string {
  const priceLine =
    content.price !== null && content.listPrice !== null && content.price < content.listPrice
      ? `${content.listPrice}円 → ${content.price}円`
      : content.price !== null
        ? `${content.price}円`
        : "(価格情報なし)";
  const pageLine =
    content.droppedPageCount > 0
      ? `画像: ${content.pageCount}枚(黒塗り超過のため${content.droppedPageCount}枚を除外済み)`
      : `画像: ${content.pageCount}枚`;

  return [
    `[${content.accountName}] 投稿確認`,
    content.title,
    "",
    `価格: ${priceLine}`,
    content.campaignTitle ? `キャンペーン: ${content.campaignTitle}` : null,
    content.reviewCount !== null ? `レビュー: ${content.reviewAverage ?? "-"} (${content.reviewCount}件)` : null,
    pageLine,
    "",
    "上の画像は黒塗り済みで、画像に付いた番号が画像の番号です。",
    "投稿したい画像の番号ボタンを押して選び、「この選択で投稿」を押してください(選んだ画像だけを番号順に投稿します)。",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// 画像の番号ボタン(押すと選択のON/OFFを切り替え、選択中は✅が付く)と、投稿/却下ボタン。
// selectedは選択中の画像の添字(0始まり)。
export function buildReviewButtons(postId: number, imageCount: number, selected: number[] = []): InlineButton[][] {
  const chosen = new Set(selected);
  const numbers: InlineButton[] = Array.from({ length: imageCount }, (_, i) => ({
    text: chosen.has(i) ? `✅${i + 1}` : `${i + 1}`,
    callback_data: buildToggleCallbackData(postId, i),
  }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < numbers.length; i += BUTTONS_PER_ROW) rows.push(numbers.slice(i, i + BUTTONS_PER_ROW));
  rows.push([
    { text: `この選択で投稿(${chosen.size}枚)`, callback_data: buildCallbackData("approve", postId) },
    { text: "却下", callback_data: buildCallbackData("reject", postId) },
  ]);
  return rows;
}

export interface SendPreviewDeps {
  downloadFn: (url: string) => Promise<DownloadedImage>;
  censorFn: (images: DownloadedImage[]) => Promise<DownloadedImage[]>;
  sendImagesFn: (images: DownloadedImage[], captions: string[]) => Promise<void>;
  sendMessageFn: (text: string, buttons: InlineButton[][]) => Promise<void>;
}

const defaultDeps: SendPreviewDeps = {
  downloadFn: downloadImage,
  censorFn: censorImages,
  sendImagesFn: sendImages,
  sendMessageFn: sendMessageWithButtons,
};

// サンプル画像をダウンロード→(検閲)し、黒塗り済みの画像を番号付きでTelegramへ送って
// 投稿する画像を選んでもらう。投稿確定時(finalizeApprovedPost)に同じ画像を同じモデルで
// 再度黒塗りするため、ここで見た内容がそのまま投稿される(YOLOの推論は同一入力に対し決定的)。
// 検閲に失敗した場合は例外を投げ、確認依頼自体を送らない(検閲できなければ見せない/投稿しない)。
export async function sendTelegramPreview(
  config: AppConfig,
  post: PostRow,
  content: PreviewContent,
  deps: SendPreviewDeps = defaultDeps
): Promise<void> {
  const urls = JSON.parse(post.sample_image_urls) as string[];
  const downloaded = await Promise.all(urls.map((url) => deps.downloadFn(url)));
  const images = config.censorSampleImages ? await deps.censorFn(downloaded) : downloaded;

  // 各画像に通し番号(1始まり)をキャプションとして付ける。ボタンの番号と対応する。
  let offset = 0;
  for (const group of chunkImages(images, MAX_IMAGES_PER_GROUP)) {
    await deps.sendImagesFn(
      group,
      group.map((_, i) => String(offset + i + 1))
    );
    offset += group.length;
  }
  await deps.sendMessageFn(buildPreviewText(content), buildReviewButtons(post.id, images.length));
}
