import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EUploadMimeType } from "twitter-api-v2";
import type { DownloadedImage } from "./mediaUpload.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "..", "..", "scripts", "censor_image.py");

const PYTHON_BIN = process.env.CENSOR_PYTHON_BIN ?? "python3";
const TIMEOUT_MS = Number(process.env.CENSOR_TIMEOUT_MS ?? 60_000);

// 実地検証(EraX-NSFW-V1.0, mediumモデル)で妥当と確認済みの値。
// confidenceを低め(0.10)にしているのは、アニメ調イラストは実写より確信度が
// 出にくく、閾値を高くすると検出漏れ(=黒塗りされずに投稿される)が増えるため。
// 実運用で「本来黒塗りすべき箇所が検出されず投稿された」事例が確認されたため、
// 0.15から0.10へさらに引き下げた(誤検出=過剰な黒塗りが増えるトレードオフはあるが、
// 「検閲できなければ投稿しない」設計上、見逃しより過剰検出の方が安全側)。
const CONF_THRESHOLD = 0.1;
const IOU_THRESHOLD = 0.3;

// 「露出度の高い部位全般」として黒塗り対象にするEraX-NSFW検出クラス(5種類全部)。
// make_loveは性交描写全体を囲む広いボックスで画像の大部分が黒塗りされ得るが、
// 安全側に倒す判断で対象に含めている。
export const CENSOR_TARGET_CLASSES = ["anus", "make_love", "nipple", "penis", "vagina"] as const;

interface CensorJob {
  input: string;
  output: string;
  classes: readonly string[];
}

interface CensorResult {
  input: string;
  output: string;
  detections: { class: string; score: number; box: number[] }[];
  redactionRatio: number; // 画像面積に対する黒塗り(パディング込み検出box)の被覆率、0〜1
}

// 画像群を一時ディレクトリに書き出し、1回のPythonプロセス起動でまとめて検閲処理させる
// (モデルロードのオーバーヘッドをチャンクあたり1回に抑えるため)。呼び出し元が
// 一時ディレクトリの後始末に責任を持つ(censorImages/analyzeCensorshipそれぞれで異なる
// 後始末をするため、ここでは削除しない)。
async function runCensorship(images: DownloadedImage[], dirPrefix: string): Promise<{ dir: string; results: CensorResult[] }> {
  const dir = await mkdtemp(join(tmpdir(), dirPrefix));
  const jobs: CensorJob[] = images.map((_, i) => ({
    input: join(dir, `${i}-in.jpg`),
    output: join(dir, `${i}-out.jpg`),
    classes: CENSOR_TARGET_CLASSES,
  }));
  await Promise.all(jobs.map((job, i) => writeFile(job.input, images[i]!.buffer)));

  const specPath = join(dir, "spec.json");
  await writeFile(
    specPath,
    JSON.stringify({ confThreshold: CONF_THRESHOLD, iouThreshold: IOU_THRESHOLD, jobs })
  );

  const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, specPath], {
    timeout: TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });

  return { dir, results: parseCensorOutput(stdout, jobs.length) };
}

// 検閲に失敗した場合(Pythonプロセスの起動失敗・タイムアウト等)は例外として投稿処理全体が
// 失敗する(呼び出し元のtry/catchに委ねる)。「検閲できなければ投稿しない」というフェイル
// セーフをこの仕組みで実現している。出力はcensor_image.py側でJPEGに統一されるため、
// 返すDownloadedImageのmimeTypeは常にJpeg。
export async function censorImages(images: DownloadedImage[]): Promise<DownloadedImage[]> {
  if (images.length === 0) return [];

  const { dir, results } = await runCensorship(images, "fanza-dojin-censor-");
  try {
    return await Promise.all(
      results.map(async (result) => ({
        buffer: await readFile(result.output),
        mimeType: EUploadMimeType.Jpeg,
      }))
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// バッチ処理(fetch-candidates)用: 実際に黒塗りした画像は保存せず、どれくらいの面積を
// 黒塗りする必要があるか(redactionRatio, 0〜1)だけを判定する。DBには画像バイナリを
// 持たない設計のため、黒塗り済み画像そのものはここでは使わず一時ディレクトリごと破棄する。
// 投稿確定時(finalizeApprovedPost)は改めてcensorImagesで実画像を黒塗りする
// (このバッチ解析はあくまで「投稿候補として選んでよいか」の事前判定であり、実際の
// 黒塗り適用を代替するものではない)。
export async function analyzeCensorship(
  images: DownloadedImage[]
): Promise<{ redactionRatio: number; detections: CensorResult["detections"] }[]> {
  if (images.length === 0) return [];

  const { dir, results } = await runCensorship(images, "fanza-dojin-analyze-");
  await rm(dir, { recursive: true, force: true });
  return results.map((result) => ({ redactionRatio: result.redactionRatio ?? 0, detections: result.detections }));
}

// Python側の標準出力(JSON文字列)をパースする純粋関数。subprocessを起動せずテストできる。
export function parseCensorOutput(stdout: string, expectedCount: number): CensorResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`censor_image.py output was not valid JSON: ${String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw new Error(`censor_image.py returned unexpected result shape (expected ${expectedCount} entries)`);
  }
  return parsed as CensorResult[];
}
