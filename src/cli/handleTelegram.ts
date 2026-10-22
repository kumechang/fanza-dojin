import { getDb } from "../db/client.js";
import { loadConfig } from "../config/loadConfig.js";
import { env, hasTelegramCredentials } from "../lib/env.js";
import { telegramApi } from "../telegram/client.js";
import { handleTelegramUpdates } from "../pipeline/handleTelegramUpdates.js";
import { finalizeApprovedPost } from "../pipeline/finalizeApprovedPost.js";
import { logger } from "../lib/logger.js";

// handle-telegram.yml から実行されるエントリポイント。Telegramの承認/却下ボタンの押下を
// まとめて処理し、承認されたものはXへ投稿する(handle-approval.ymlのTelegram版)。
async function main(): Promise<void> {
  if (!hasTelegramCredentials()) {
    logger.warn("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured, nothing to do");
    return;
  }

  const result = await handleTelegramUpdates(getDb(), loadConfig(), {
    api: telegramApi,
    finalize: finalizeApprovedPost,
    allowedUserId: env.telegram.chatId,
  });
  logger.info("handle-telegram finished", { ...result });
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  logger.error("handle-telegram failed", { error: String(error) });
  process.exitCode = 1;
});
