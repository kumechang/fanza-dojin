// Telegramのインラインボタンに埋め込むcallback_data("approve:12" / "reject:12")の生成とパース。
// callback_dataは64バイトまでの制約があるため、postsテーブルのidだけを持たせる。
export type TelegramAction = "approve" | "reject";

export function buildCallbackData(action: TelegramAction, postId: number): string {
  return `${action}:${postId}`;
}

export function parseCallbackData(data: string | undefined): { action: TelegramAction; postId: number } | null {
  const match = data?.match(/^(approve|reject):(\d+)$/);
  if (!match) return null;
  return { action: match[1] as TelegramAction, postId: Number(match[2]) };
}
