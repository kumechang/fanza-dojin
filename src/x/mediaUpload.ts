import { EUploadMimeType } from "twitter-api-v2";
import { getXClient } from "./xClient.js";

// サンプル画像を「1ツイートあたりn枚」の塊に分割する。作品ごとに枚数が異なるため、
// 最後のチャンクはn枚未満になり得る。
export function chunkImages<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function guessMimeType(url: string): EUploadMimeType {
  const ext = url.split(".").pop()?.toLowerCase().split("?")[0];
  switch (ext) {
    case "png":
      return EUploadMimeType.Png;
    case "gif":
      return EUploadMimeType.Gif;
    case "jpg":
    case "jpeg":
    default:
      return EUploadMimeType.Jpeg;
  }
}

export interface DownloadedImage {
  buffer: Buffer;
  mimeType: EUploadMimeType;
}

// FANZAのサンプル画像URL(静的公開URL)をダウンロードしてBuffer化する。
// DBには画像バイナリを持たない(SQLiteをgitコミットする運用のため)ので、
// 投稿確定タイミングで都度ダウンロードする。
export async function downloadImage(url: string): Promise<DownloadedImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download image: ${response.status} ${response.statusText} (${url})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: guessMimeType(url) };
}

// ダウンロード済み画像をXにアップロードし、media_idの配列を返す(v2.tweet/replyのmedia_idsに渡す)。
// media_idはアップロードしたアカウントのトークンに紐づくため、そのままでは別アカウントの
// ツイートには添付できない。必ず投稿先と同じaccountNameでアップロードすること。
export async function uploadImages(accountName: string, images: DownloadedImage[]): Promise<string[]> {
  const mediaIds: string[] = [];
  for (const image of images) {
    const mediaId = await getXClient(accountName).v1.uploadMedia(image.buffer, { mimeType: image.mimeType });
    mediaIds.push(mediaId);
  }
  return mediaIds;
}
