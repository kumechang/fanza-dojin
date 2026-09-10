import "dotenv/config";

// 環境変数の集約読み込み。未設定でも空文字で扱い、呼び出し側のhasXxx()で
// 「キーが無いのでドライランする」判定に使う(APIキー未取得の現段階でも実行を止めないため)。
export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubRepository: process.env.GITHUB_REPOSITORY ?? "",
  githubRunId: process.env.GITHUB_RUN_ID ?? "",
  x: {
    // Developer登録したアプリキー。全アカウント共通(3-legged OAuthのapp単位)。
    apiKey: process.env.X_API_KEY ?? "",
    apiSecret: process.env.X_API_SECRET ?? "",
  },
  fanza: {
    apiId: process.env.FANZA_API_ID ?? "",
    affiliateId: process.env.FANZA_AFFILIATE_ID ?? "",
  },
};

export function hasAnthropicKey(): boolean {
  return env.anthropicApiKey.length > 0;
}

export interface XAccountCredentials {
  name: string;
  accessToken: string;
  accessSecret: string;
}

let cachedAccounts: XAccountCredentials[] | undefined;

// X_ACCOUNTS_JSON (例: '[{"name":"meronsoda","accessToken":"...","accessSecret":"..."}]') を
// パースしてアカウント一覧を返す。未設定なら空配列(ドライラン)。
// 値が存在するのに壊れている場合は、誤ってアカウント0件のまま静かに動き続けることがないよう
// 明示的に例外を投げる(空扱いでもみ消さない)。
export function listXAccounts(): XAccountCredentials[] {
  if (cachedAccounts) return cachedAccounts;

  const raw = process.env.X_ACCOUNTS_JSON ?? "";
  if (!raw) {
    cachedAccounts = [];
    return cachedAccounts;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`X_ACCOUNTS_JSON is not valid JSON: ${String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("X_ACCOUNTS_JSON must be a JSON array");
  }

  const accounts = parsed.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).accessToken !== "string" ||
      typeof (entry as Record<string, unknown>).accessSecret !== "string"
    ) {
      throw new Error(`X_ACCOUNTS_JSON[${index}] must have string fields: name, accessToken, accessSecret`);
    }
    return entry as XAccountCredentials;
  });

  const names = new Set<string>();
  for (const account of accounts) {
    if (names.has(account.name)) {
      throw new Error(`X_ACCOUNTS_JSON has a duplicate account name: ${account.name}`);
    }
    names.add(account.name);
  }

  cachedAccounts = accounts;
  return cachedAccounts;
}

export function findXAccount(accountName: string): XAccountCredentials | undefined {
  return listXAccounts().find((account) => account.name === accountName);
}

// config/app.jsonのpausedAccountNamesに含まれるアカウントを除外する。X_ACCOUNTS_JSON自体からは
// 削除しない(認証情報を残したまま新規投稿候補の生成だけを一時的に止めたいケース向け)。
export function filterActiveAccounts(
  accounts: XAccountCredentials[],
  pausedAccountNames: string[]
): XAccountCredentials[] {
  const paused = new Set(pausedAccountNames);
  return accounts.filter((account) => !paused.has(account.name));
}

export function hasXCredentials(accountName: string): boolean {
  return env.x.apiKey.length > 0 && env.x.apiSecret.length > 0 && findXAccount(accountName) !== undefined;
}

export function hasFanzaCredentials(): boolean {
  return env.fanza.apiId.length > 0 && env.fanza.affiliateId.length > 0;
}

export function parseGithubRepository(): { owner: string; repo: string } | null {
  const parts = env.githubRepository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}
