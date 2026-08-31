import { getOctokit } from "./octokit.js";
import { env, parseGithubRepository } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// このラベルが付いたIssueだけをhandle-approval.ymlの対象にする
// (無関係なコメントで誤反応しないためのガード)。
export const PENDING_APPROVAL_LABEL = "pending-approval";

export interface ApprovalIssueContent {
  title: string;
  price: number | null;
  listPrice: number | null;
  campaignTitle: string | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  sampleImageUrls: string[];
  affiliateUrl: string;
}

export interface CreatedIssue {
  number: number;
  url: string;
}

// GitHubのIssueタイトル上限に対する安全マージン。同人コミックのタイトルは長いものがあるため切り詰める。
const TITLE_MAX_LENGTH = 100;

// Issue本文を組み立てる。承認者が本文だけを見て判断できるよう、タイトル・価格・値引き根拠・
// レビュー・サンプル画像(先頭2枚をプレビュー埋め込み)・アフィリエイトURL・承認方法をひとまとめにする。
export function buildIssueBody(content: ApprovalIssueContent): string {
  const priceLine =
    content.price !== null && content.listPrice !== null && content.price < content.listPrice
      ? `${content.listPrice}円 → **${content.price}円**`
      : content.price !== null
        ? `${content.price}円`
        : "(価格情報なし)";
  const campaignLine = content.campaignTitle ? `キャンペーン: ${content.campaignTitle}` : null;
  const reviewLine =
    content.reviewCount !== null
      ? `レビュー: ${content.reviewAverage ?? "-"} (${content.reviewCount}件)`
      : null;
  const previewImages = content.sampleImageUrls
    .slice(0, 2)
    .map((url) => `![sample](${url})`)
    .join("\n");

  return [
    "## 投稿候補",
    `**${content.title}**`,
    "",
    `価格: ${priceLine}`,
    campaignLine,
    reviewLine,
    `サンプル画像: ${content.sampleImageUrls.length}枚`,
    "",
    previewImages,
    "",
    `アフィリエイトURL: ${content.affiliateUrl}`,
    "",
    "---",
    "この投稿を承認する場合はコメントで「承認」、却下する場合は「却下」と入力してください。",
    "却下する場合、「却下 セール価格が魅力的でない」のように理由を続けて書くと記録されます。",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function createApprovalIssue(content: ApprovalIssueContent): Promise<CreatedIssue> {
  const repo = parseGithubRepository();
  if (!env.githubToken || !repo) {
    // GITHUB_TOKEN未設定でもパイプライン全体を止めない(ローカル動作確認用)。
    // number: -1 は「Issue未作成」を表すセンチネル値。
    logger.warn("GitHub credentials not configured, skipping issue creation (dry-run)");
    return { number: -1, url: "" };
  }

  const title = `投稿承認: ${content.title.slice(0, TITLE_MAX_LENGTH)}`;
  const body = buildIssueBody(content);

  const { data } = await getOctokit().issues.create({
    owner: repo.owner,
    repo: repo.repo,
    title,
    body,
    labels: [PENDING_APPROVAL_LABEL],
  });

  return { number: data.number, url: data.html_url };
}
