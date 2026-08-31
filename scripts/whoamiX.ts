// .envのX_ACCOUNTS_JSONに設定中の指定アカウントがどのXアカウントに紐づいているかを確認するだけの
// read-only診断スクリプト(投稿など書き込みは一切行わない)。
import { getXClient } from "../src/x/xClient.js";
import { hasXCredentials, listXAccounts } from "../src/lib/env.js";

async function main(): Promise<void> {
  const accountName = process.argv[2];
  if (!accountName) {
    const names = listXAccounts().map((a) => a.name);
    throw new Error(
      `使い方: npm run x-whoami -- <accountName>\n登録済みアカウント: ${names.length > 0 ? names.join(", ") : "(なし)"}`
    );
  }
  if (!hasXCredentials(accountName)) {
    throw new Error(
      `.env の X_API_KEY / X_API_SECRET と、X_ACCOUNTS_JSON 内の "${accountName}" エントリを設定してください`
    );
  }

  const me = await getXClient(accountName).v2.me();
  console.log(`"${accountName}" のトークンは @${me.data.username} (${me.data.name}) に紐づいています。`);
}

main().catch((error) => {
  console.error("確認に失敗しました:", error);
  process.exitCode = 1;
});
