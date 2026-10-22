import type { AppConfig } from "../config/types.js";
import type { PostRow } from "../db/repositories/postsRepo.js";
import { downloadImage, chunkImages, type DownloadedImage } from "../x/mediaUpload.js";
import { censorImages } from "../x/censorImage.js";
import { sendImages, sendMessageWithButtons, type InlineButton } from "../telegram/client.js";
import { buildCallbackData } from "../telegram/callbackData.js";

// Telegramのメディアグループは1メッセージ最大10枚。
const MAX_IMAGES_PER_GROUP = 10;

export interface PreviewContent {
  accountName: string;
  title: string;
  price: number | null;
  listPrice: number | null;
  campaignTitle: string | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  pageCount: number; // 投稿予定の枚数(間引き後)
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
      ? `投稿予定の画像: ${content.pageCount}枚(黒塗り超過のため${content.droppedPageCount}枚を除外済み)`
      : `投稿予定の画像: ${content.pageCount}枚`;

  return [
    `[${content.accountName}] 投稿確認`,
    content.title,
    "",
    `価格: ${priceLine}`,
    content.campaignTitle ? `キャンペーン: ${content.campaignTitle}` : null,
    content.reviewCount !== null ? `レビュー: ${content.reviewAverage ?? "-"} (${content.reviewCount}件)` : null,
    pageLine,
    "",
    "上の画像が実際に投稿される内容です。",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function buildReviewButtons(postId: number): InlineButton[] {
  return [
    { text: "承認して投稿", callback_data: buildCallbackData("approve", postId) },
    { text: "却下", callback_data: buildCallbackData("reject", postId) },
  ];
}

export interface SendPreviewDeps {
  downloadFn: (url: string) => Promise<DownloadedImage>;
  censorFn: (images: DownloadedImage[]) => Promise<DownloadedImage[]>;
  sendImagesFn: (images: DownloadedImage[]) => Promise<void>;
  sendMessageFn: (text: string, buttons: InlineButton[]) => Promise<void>;
}

const defaultDeps: SendPreviewDeps = {
  downloadFn: downloadImage,
  censorFn: censorImages,
  sendImagesFn: sendImages,
  sendMessageFn: sendMessageWithButtons,
};

// 投稿予定のサンプル画像をダウンロード→(検閲)し、黒塗り済みの実際の投稿内容をTelegramへ送って
// 承認ボタン付きで確認を求める。投稿確定時(finalizeApprovedPost)に同じ画像を同じモデルで
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

  for (const group of chunkImages(images, MAX_IMAGES_PER_GROUP)) {
    await deps.sendImagesFn(group);
  }
  await deps.sendMessageFn(buildPreviewText(content), buildReviewButtons(post.id));
}
