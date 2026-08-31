import type Database from "better-sqlite3";
import type { AppConfig } from "../config/types.js";
import { countPostsCreatedOnJstDate, getLastPostCreatedAt } from "../db/repositories/postsRepo.js";
import { getWeight, getAverageWeight } from "../db/repositories/postingTimeWeightsRepo.js";
import { getJstHour, getJstDateString, parseDbTimestamp } from "../lib/time.js";

export interface PostingProbabilityContext {
  remainingTarget: number;
  remainingActiveHours: number;
  hourWeight: number;
  averageWeight: number;
}

// 純粋関数: 今この瞬間に投稿候補を作るべき確率(0〜1)を計算する。
// - 目標を既に満たしていれば0
// - その日最後のアクティブ時間なら、未達分を取りこぼさないよう1(必ず生成)
// - それ以外は「残り目標 / 残り時間」を基準に、時間帯の重み(過去のエンゲージメント傾向)で補正する
export function computePostingProbability(ctx: PostingProbabilityContext): number {
  if (ctx.remainingTarget <= 0) return 0;
  if (ctx.remainingActiveHours <= 1) return 1;

  const baseProbability = ctx.remainingTarget / ctx.remainingActiveHours;
  const weightRatio = ctx.averageWeight > 0 ? ctx.hourWeight / ctx.averageWeight : 1;
  return Math.min(1, Math.max(0, baseProbability * weightRatio));
}

// このアカウントの投稿可能時間帯のうち、今の時刻(含む)から終了時刻までに残っているアクティブ時間数。
// startHour > endHour(日をまたぐ時間帯、例: 22時〜翌2時)の場合、まだ日をまたいでいない
// (currentHourがstartHour以降)ならendHourを+24時間分先とみなして計算する。
export function countRemainingActiveHours(now: Date, config: AppConfig): number {
  const currentHour = getJstHour(now);
  const { startHour, endHour } = config.postingWindow;
  const effectiveEndHour = startHour > endHour && currentHour >= startHour ? endHour + 24 : endHour;
  return Math.max(1, effectiveEndHour - currentHour);
}

// 実際に今回generate-postsで投稿候補を作るべきかどうかを判定する。
// minSpacingHours未満での連投を防いだ上で、computePostingProbabilityの確率で決める。
// 目標投稿数・直近投稿間隔はアカウントごとに独立して判定する(1アカウントの投稿が他アカウントの
// 生成を足止めしないようにするため)。
export function shouldGenerateNow(db: Database.Database, config: AppConfig, now: Date, accountName: string): boolean {
  const lastCreatedAt = getLastPostCreatedAt(db, accountName);
  if (lastCreatedAt) {
    const hoursSinceLast = (now.getTime() - parseDbTimestamp(lastCreatedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < config.minSpacingHours) return false;
  }

  const createdToday = countPostsCreatedOnJstDate(db, accountName, getJstDateString(now));
  const remainingTarget = config.targetPostsPerDay - createdToday;
  const remainingActiveHours = countRemainingActiveHours(now, config);
  const hourWeight = getWeight(db, getJstHour(now));
  const averageWeight = getAverageWeight(db);

  const probability = computePostingProbability({
    remainingTarget,
    remainingActiveHours,
    hourWeight,
    averageWeight,
  });

  return Math.random() < probability;
}
