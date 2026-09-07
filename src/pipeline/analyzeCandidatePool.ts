import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { getPendingCandidates, markAnalyzed, markAnalysisFailed } from "../db/repositories/fanzaCandidatesRepo.js";
import { downloadImage, type DownloadedImage } from "../x/mediaUpload.js";
import { analyzeCensorship } from "../x/censorImage.js";
import { logger } from "../lib/logger.js";

export interface AnalyzeCandidatePoolResult {
  analyzed: number;
  failed: number;
}

export interface AnalyzeCandidatePoolDeps {
  downloadFn: (url: string) => Promise<DownloadedImage>;
  analyzeFn: (images: DownloadedImage[]) => ReturnType<typeof analyzeCensorship>;
}

const defaultDeps: AnalyzeCandidatePoolDeps = { downloadFn: downloadImage, analyzeFn: analyzeCensorship };

// 投稿候補プール(fanza_candidates)のうち、黒塗り要否(redaction_ratio)がまだ未判定の
// 候補について、サンプル画像をダウンロードしEraX-NSFWによる検出を行い、判定結果を
// 保存する。1回のバッチ実行につきconfig.fanza.maxAnalysisPerRun件までしか処理しない
// (YOLO推論はコストが高く、1回のワークフロー実行時間を青天井にしないための上限)。
// 処理しきれなかった分はpendingのまま残り、次回のバッチ実行に持ち越される。
//
// ここでの黒塗り面積率は「サンプル画像群のうち最大のもの」を採用する(投稿スレッドでは
// 全サンプル画像が並んで表示されるため、1枚でも黒塗りが大きい作品は「ほとんど不要」とは
// みなさない、安全側の判断)。
export async function analyzeCandidatePool(
  db: Database.Database,
  config: AppConfig,
  deps: AnalyzeCandidatePoolDeps = defaultDeps
): Promise<AnalyzeCandidatePoolResult> {
  const pending = getPendingCandidates(db, config.fanza.maxAnalysisPerRun);
  let analyzed = 0;
  let failed = 0;

  for (const candidate of pending) {
    const sampleImageUrls = JSON.parse(candidate.sample_image_urls) as string[];
    if (sampleImageUrls.length === 0) {
      // サンプル画像が1枚も無い作品は黒塗り要否を判定できないため、安全側に倒して
      // 解析失敗扱いにし、投稿候補には回さない。
      logger.warn("candidate has no sample images, marking analysis_failed", { contentId: candidate.content_id });
      markAnalysisFailed(db, candidate.id);
      failed++;
      continue;
    }

    try {
      const images = await Promise.all(sampleImageUrls.map((url) => deps.downloadFn(url)));
      const results = await deps.analyzeFn(images);
      const redactionRatio = Math.max(...results.map((r) => r.redactionRatio));
      markAnalyzed(db, candidate.id, redactionRatio, results);
      analyzed++;
    } catch (error) {
      logger.warn("failed to analyze candidate censorship, marking analysis_failed", {
        contentId: candidate.content_id,
        error: String(error),
      });
      markAnalysisFailed(db, candidate.id);
      failed++;
    }
  }

  logger.info("fanza candidate pool analysis finished", { analyzed, failed, pending: pending.length });
  return { analyzed, failed };
}
