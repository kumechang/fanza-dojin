import { getDb } from "../db/client.js";
import { loadConfig } from "../config/loadConfig.js";
import { generateCandidate } from "../pipeline/generateCandidate.js";
import { logger } from "../lib/logger.js";

// generate-posts.yml から実行されるエントリポイント。
async function main(): Promise<void> {
  const db = getDb();
  const config = loadConfig();

  const postId = await generateCandidate(db, config);

  logger.info("generate finished", { postId });
}

main().catch((error) => {
  logger.error("generate failed", { error: String(error) });
  process.exitCode = 1;
});
