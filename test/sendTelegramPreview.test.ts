import { describe, it, expect } from "vitest";
import { EUploadMimeType } from "twitter-api-v2";
import { buildPreviewText, buildReviewButtons, sendTelegramPreview } from "../src/pipeline/sendTelegramPreview.js";
import type { AppConfig } from "../src/config/types.js";
import type { PostRow } from "../src/db/repositories/postsRepo.js";
import type { DownloadedImage } from "../src/x/mediaUpload.js";

const content = {
  accountName: "acc",
  title: "作品タイトル",
  price: 100,
  listPrice: 300,
  campaignTitle: "30%OFF",
  reviewCount: 5,
  reviewAverage: 4.5,
  pageCount: 4,
  droppedPageCount: 0,
};

describe("buildPreviewText", () => {
  it("includes account, title, price and page count, and no links", () => {
    const text = buildPreviewText(content);
    expect(text).toContain("[acc]");
    expect(text).toContain("作品タイトル");
    expect(text).toContain("300円 → 100円");
    expect(text).toContain("画像: 4枚");
    expect(text).not.toContain("http");
  });

  it("mentions dropped pages when some were excluded", () => {
    expect(buildPreviewText({ ...content, droppedPageCount: 2 })).toContain("2枚を除外済み");
  });

  it("omits optional lines when data is missing", () => {
    const text = buildPreviewText({ ...content, price: null, campaignTitle: null, reviewCount: null });
    expect(text).toContain("価格情報なし");
    expect(text).not.toContain("キャンペーン");
    expect(text).not.toContain("レビュー");
  });
});

describe("buildReviewButtons", () => {
  it("builds approve and reject buttons carrying the post id", () => {
    expect(buildReviewButtons(7, 0).flat().map((b) => b.callback_data)).toEqual(["approve:7", "reject:7"]);
  });

  it("builds numbered toggle buttons in rows of five, marking selected images", () => {
    const rows = buildReviewButtons(7, 7, [1, 6]);
    expect(rows.map((r) => r.length)).toEqual([5, 2, 2]);
    expect(rows.flat().slice(0, 7).map((b) => b.text)).toEqual(["1", "✅2", "3", "4", "5", "6", "✅7"]);
    expect(rows[1]![0]!.callback_data).toBe("toggle:7:5");
    expect(rows[2]![0]!.text).toBe("この選択で投稿(2枚)");
  });
});

describe("sendTelegramPreview", () => {
  const image = (tag: string): DownloadedImage => ({ buffer: Buffer.from(tag), mimeType: EUploadMimeType.Jpeg });
  const post = {
    id: 9,
    sample_image_urls: JSON.stringify(Array.from({ length: 12 }, (_, i) => `https://example.com/${i}.jpg`)),
  } as PostRow;
  const config = { censorSampleImages: true } as AppConfig;

  it("sends censored images in groups of 10, then the message with buttons", async () => {
    const groups: number[] = [];
    const captionsSent: string[] = [];
    const censored: string[] = [];
    let message: { text: string; ids: string[] } | undefined;

    await sendTelegramPreview(config, post, content, {
      downloadFn: async (url) => image(url),
      censorFn: async (images) => {
        censored.push(...images.map((i) => i.buffer.toString()));
        return images.map((i) => image(`censored:${i.buffer.toString()}`));
      },
      sendImagesFn: async (images, captions) => {
        groups.push(images.length);
        captionsSent.push(...captions);
      },
      sendMessageFn: async (text, buttons) => {
        message = { text, ids: buttons.flat().map((b) => b.callback_data) };
      },
    });

    expect(censored).toHaveLength(12);
    expect(groups).toEqual([10, 2]);
    expect(captionsSent).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    expect(message?.ids.slice(0, 2)).toEqual(["toggle:9:0", "toggle:9:1"]);
    expect(message?.ids.slice(-2)).toEqual(["approve:9", "reject:9"]);
  });

  it("sends nothing when censorship fails", async () => {
    let sent = false;
    await expect(
      sendTelegramPreview(config, post, content, {
        downloadFn: async (url) => image(url),
        censorFn: async () => {
          throw new Error("model unavailable");
        },
        sendImagesFn: async () => {
          sent = true;
        },
        sendMessageFn: async () => {
          sent = true;
        },
      })
    ).rejects.toThrow("model unavailable");
    expect(sent).toBe(false);
  });

  it("skips censorship when censorSampleImages is false", async () => {
    let censorCalled = false;
    await sendTelegramPreview({ censorSampleImages: false } as AppConfig, post, content, {
      downloadFn: async (url) => image(url),
      censorFn: async (images) => {
        censorCalled = true;
        return images;
      },
      sendImagesFn: async () => {},
      sendMessageFn: async () => {},
    });
    expect(censorCalled).toBe(false);
  });
});
