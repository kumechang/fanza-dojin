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
// confidenceを低め(0.15)にしているのは、アニメ調イラストは実写より確信度が
// 出にくく、閾値を高くすると検出漏れ(=黒塗りされずに投稿される)が増えるため。
const CONF_THRESHOLD = 0.15;
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
}

// 画像群をまとめて1回のPythonプロセス起動で検閲する(モデルロードのオーバーヘッドを
// チャンクあたり1回に抑えるため)。失敗時は例外を投げ、呼び出し元(finalizeApprovedPost)の
// try/catchで「検閲できなければ投稿しない」というフェイルセーフに委ねる。
// 出力はcensor_image.py側でJPEGに統一されるため、返すDownloadedImageのmimeTypeは常にJpeg。
export async function censorImages(images: DownloadedImage[]): Promise<DownloadedImage[]> {
  if (images.length === 0) return [];

  const dir = await mkdtemp(join(tmpdir(), "fanza-dojin-censor-"));
  try {
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

    const results = parseCensorOutput(stdout, jobs.length);
    return Promise.all(
      results.map(async (result) => ({
        buffer: await readFile(result.output),
        mimeType: EUploadMimeType.Jpeg,
      }))
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
