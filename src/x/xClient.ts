import { TwitterApi } from "twitter-api-v2";
import { env, findXAccount } from "../lib/env.js";

const clients = new Map<string, TwitterApi>();

// OAuth 1.0aのユーザーコンテキスト認証(投稿・自分のツイートのメトリクス取得に必要)。
// appKey/appSecretはDeveloper登録したアプリキーで全アカウント共通、accessToken/accessSecretは
// アカウントごとに異なる(X_ACCOUNTS_JSON)。アカウントごとにクライアントをキャッシュする。
export function getXClient(accountName: string): TwitterApi {
  const cached = clients.get(accountName);
  if (cached) return cached;

  const account = findXAccount(accountName);
  if (!account) {
    throw new Error(`unknown X account: ${accountName} (not present in X_ACCOUNTS_JSON)`);
  }

  const client = new TwitterApi({
    appKey: env.x.apiKey,
    appSecret: env.x.apiSecret,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  });
  clients.set(accountName, client);
  return client;
}
