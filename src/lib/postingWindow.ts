import type { AppConfig } from "../config/types.js";
import { getJstHour } from "./time.js";

export { getJstHour } from "./time.js";

// 投稿可能時間帯かどうか。GitHub Actionsのscheduleは数時間単位で遅延することがあり、
// 想定外の時間帯にズレ込んで実行されることがあるため、そういう回は投稿候補自体を作らずスキップする。
// startHour > endHour の場合は日をまたぐ時間帯(例: 22時〜翌2時)として扱う。
export function isWithinPostingWindow(date: Date, config: AppConfig): boolean {
  const hour = getJstHour(date);
  const { startHour, endHour } = config.postingWindow;
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}
