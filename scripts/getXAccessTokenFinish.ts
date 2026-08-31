// PIN-based OAuth (3-legged OAuth) の後半。
// getXAccessTokenStart.ts が保存したリクエストトークンとPINコードを使って、
// 実際にXへ投稿できる最終的な Access Token/Secret を発行する。
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { TwitterApi } from "twitter-api-v2";
import { env } from "../src/lib/env.js";

const TEMP_PATH = path.resolve(process.cwd(), ".x-oauth-temp.json");

async function main(): Promise<void> {
  const pin = process.argv[2];
  if (!pin) {
    throw new Error("使い方: npm run get-x-token:finish -- <PINコード>");
  }
  if (!env.x.apiKey || !env.x.apiSecret) {
    throw new Error(".env の X_API_KEY / X_API_SECRET を先に設定してください");
  }

  const temp = JSON.parse(readFileSync(TEMP_PATH, "utf-8")) as {
    oauth_token: string;
    oauth_token_secret: string;
  };

  const pinClient = new TwitterApi({
    appKey: env.x.apiKey,
    appSecret: env.x.apiSecret,
    accessToken: temp.oauth_token,
    accessSecret: temp.oauth_token_secret,
  });

  const { accessToken, accessSecret, screenName } = await pinClient.login(pin);
  rmSync(TEMP_PATH, { force: true });

  const entry = { name: screenName, accessToken, accessSecret };
  console.log(`\n認可が完了しました(アカウント: @${screenName})。`);
  console.log("以下のエントリを .env の X_ACCOUNTS_JSON(JSON配列)に追記してください:\n");
  console.log(JSON.stringify(entry));
  console.log(
    "\n複数アカウントを認可する場合は、このstart→finishの手順を1アカウントずつ完了させてから次に進んでください" +
      "(.x-oauth-temp.json を使い回すため並行実行はできません)。"
  );
}

main().catch((error) => {
  console.error("失敗しました:", error);
  process.exitCode = 1;
});
