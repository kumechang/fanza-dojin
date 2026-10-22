import { getDb } from "../db/client.js";
import { loadConfig } from "../config/loadConfig.js";
import { generateCandidate } from "../pipeline/generateCandidate.js";
import { generateTelegramBatch } from "../pipeline/generateTelegramBatch.js";
import { listXAccounts, filterActiveAccounts } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// generate-posts.yml から実行されるエントリポイント。X_ACCOUNTS_JSONに登録された
// アカウントのうち、config/app.jsonのpausedAccountNamesに含まれないもの全分を順番に
// 処理する。1アカウントの失敗が他アカウントの処理機会を奪わないよう、アカウントごとに
// try/catchする。
async function main(): Promise<void> {
  const db = getDb();
  const config = loadConfig();
  const accounts = filterActiveAccounts(listXAccounts(), config.pausedAccountNames);
  if (config.pausedAccountNames.length > 0) {
    logger.info("skipping paused accounts", { pausedAccountNames: config.pausedAccountNames });
  }
  let hadError = false;

  for (const account of accounts) {
    try {
      if (config.approvalMode === "telegram") {
        const postIds = await generateTelegramBatch(db, config, account.name);
        logger.info("generate finished", { accountName: account.name, postIds });
        continue;
      }
      const postId = await generateCandidate(db, config, account.name);
      logger.info("generate finished", { accountName: account.name, postId });
    } catch (error) {
      logger.error("generate failed for account", { accountName: account.name, error: String(error) });
      hadError = true;
    }
  }

  if (hadError) process.exitCode = 1;
}

main().catch((error) => {
  logger.error("generate failed", { error: String(error) });
  process.exitCode = 1;
});
