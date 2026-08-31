import { getDb } from "../db/client.js";
import { loadConfig } from "../config/loadConfig.js";
import { generateCandidate } from "../pipeline/generateCandidate.js";
import { listXAccounts } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// generate-posts.yml から実行されるエントリポイント。X_ACCOUNTS_JSONに登録された
// 全アカウント分を順番に処理する。1アカウントの失敗が他アカウントの処理機会を
// 奪わないよう、アカウントごとにtry/catchする。
async function main(): Promise<void> {
  const db = getDb();
  const config = loadConfig();
  const accounts = listXAccounts();
  let hadError = false;

  for (const account of accounts) {
    try {
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
