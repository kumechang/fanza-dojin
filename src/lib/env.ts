import "dotenv/config";

// 環境変数の集約読み込み。未設定でも空文字で扱い、呼び出し側のhasXxx()で
// 「キーが無いのでドライランする」判定に使う(APIキー未取得の現段階でも実行を止めないため)。
export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubRepository: process.env.GITHUB_REPOSITORY ?? "",
  githubRunId: process.env.GITHUB_RUN_ID ?? "",
  x: {
    apiKey: process.env.X_API_KEY ?? "",
    apiSecret: process.env.X_API_SECRET ?? "",
    accessToken: process.env.X_ACCESS_TOKEN ?? "",
    accessSecret: process.env.X_ACCESS_SECRET ?? "",
  },
  fanza: {
    apiId: process.env.FANZA_API_ID ?? "",
    affiliateId: process.env.FANZA_AFFILIATE_ID ?? "",
  },
};

export function hasAnthropicKey(): boolean {
  return env.anthropicApiKey.length > 0;
}

export function hasXCredentials(): boolean {
  return (
    env.x.apiKey.length > 0 &&
    env.x.apiSecret.length > 0 &&
    env.x.accessToken.length > 0 &&
    env.x.accessSecret.length > 0
  );
}

export function hasFanzaCredentials(): boolean {
  return env.fanza.apiId.length > 0 && env.fanza.affiliateId.length > 0;
}

export function parseGithubRepository(): { owner: string; repo: string } | null {
  const parts = env.githubRepository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}
