// Telegramのインラインボタンに埋め込むcallback_dataの生成とパース。
// "approve:12"(選択した画像で投稿) / "reject:12" / "toggle:12:3"(3番目の画像の選択を切り替え)。
// callback_dataは64バイトまでの制約があるため、postsテーブルのidと画像の添字だけを持たせる。
export type TelegramAction = "approve" | "reject" | "toggle";

export interface ParsedCallback {
  action: TelegramAction;
  postId: number;
  imageIndex?: number;
}

export function buildCallbackData(action: "approve" | "reject", postId: number): string {
  return `${action}:${postId}`;
}

export function buildToggleCallbackData(postId: number, imageIndex: number): string {
  return `toggle:${postId}:${imageIndex}`;
}

export function parseCallbackData(data: string | undefined): ParsedCallback | null {
  const toggle = data?.match(/^toggle:(\d+):(\d+)$/);
  if (toggle) return { action: "toggle", postId: Number(toggle[1]), imageIndex: Number(toggle[2]) };
  const match = data?.match(/^(approve|reject):(\d+)$/);
  if (!match) return null;
  return { action: match[1] as "approve" | "reject", postId: Number(match[2]) };
}
