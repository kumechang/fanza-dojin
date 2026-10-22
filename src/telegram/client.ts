import { env } from "../lib/env.js";
import type { DownloadedImage } from "../x/mediaUpload.js";

// Telegram Bot APIの薄いI/O層。承認者本人との1対1チャット(TELEGRAM_CHAT_ID)にだけ送る。
// エラーメッセージにBotトークン(URLに含まれる)が混入しないよう、URLは例外に含めない。

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: { message_id: number; text?: string; chat: { id: number } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
}

// パイプライン側がテストでフェイクに差し替えられるよう、使うメソッドだけをインターフェースにしておく。
export interface TelegramApi {
  getUpdates(offset?: number): Promise<TelegramUpdate[]>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  editMessageText(chatId: number, messageId: number, text: string, buttons?: InlineButton[]): Promise<void>;
}

async function call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`https://api.telegram.org/bot${env.telegram.botToken}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${json?.description ?? response.statusText}`);
  }
  return json.result as T;
}

function toBlob(image: DownloadedImage): Blob {
  return new Blob([new Uint8Array(image.buffer)], { type: "image/jpeg" });
}

// 画像を承認者のチャットに送る。mediaGroupは2〜10枚が条件のため、1枚だけの場合はsendPhotoを使う。
// protect_contentで転送・保存を禁止する(アダルト画像が意図せず外へ出るのを防ぐ)。
export async function sendImages(images: DownloadedImage[]): Promise<void> {
  if (images.length === 0) return;

  const form = new FormData();
  form.append("chat_id", env.telegram.chatId);
  form.append("protect_content", "true");

  if (images.length === 1) {
    form.append("photo", toBlob(images[0]!), "page.jpg");
    await call("sendPhoto", form);
    return;
  }

  form.append("media", JSON.stringify(images.map((_, i) => ({ type: "photo", media: `attach://page${i}` }))));
  images.forEach((image, i) => form.append(`page${i}`, toBlob(image), `page${i}.jpg`));
  await call("sendMediaGroup", form);
}

// 承認/却下ボタン付きのメッセージを送る。リンクプレビューは無効化する
// (プレビューにFANZAの黒塗り前の画像が展開されるのを防ぐ)。
export async function sendMessageWithButtons(text: string, buttons: InlineButton[]): Promise<void> {
  await call("sendMessage", {
    chat_id: env.telegram.chatId,
    text,
    protect_content: true,
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [buttons] },
  });
}

export const telegramApi: TelegramApi = {
  async getUpdates(offset) {
    return call<TelegramUpdate[]>("getUpdates", {
      ...(offset !== undefined ? { offset } : {}),
      timeout: 0,
      allowed_updates: ["callback_query"],
    });
  },

  async answerCallbackQuery(callbackQueryId, text) {
    await call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  },

  async editMessageText(chatId, messageId, text, buttons) {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: buttons ? [buttons] : [] },
    });
  },
};
