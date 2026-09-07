import { getDb } from "../db/client.js";
import { loadConfig } from "../config/loadConfig.js";
import { fetchCandidatePool } from "../pipeline/fetchCandidatePool.js";
import { analyzeCandidatePool } from "../pipeline/analyzeCandidatePool.js";
import { logger } from "../lib/logger.js";

// fetch-candidates.yml から実行されるエントリポイント。
// FANZA ItemList APIから同人コミックの値引き候補をバッチ取得して投稿候補プール
// (fanza_candidates)へ反映し、続けて未解析の候補について黒塗り要否(redaction_ratio)を
// 判定する。これをgenerate-posts(投稿タイミング)から切り離すことで、投稿時は
// プールを参照するだけになり、投稿ごとのFANZA API呼び出し・候補走査分のYOLO推論が
// 不要になる。
async function main(): Promise<void> {
  const db = getDb();
  const config = loadConfig();

  const fetchResult = await fetchCandidatePool(db, config);
  logger.info("fetch-candidates: pool fetch done", { ...fetchResult });

  const analyzeResult = await analyzeCandidatePool(db, config);
  logger.info("fetch-candidates: pool analysis done", { ...analyzeResult });
}

main().catch((error) => {
  logger.error("fetch-candidates failed", { error: String(error) });
  process.exitCode = 1;
});
