import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EUploadMimeType } from "twitter-api-v2";

// envはimport時にprocess.envを読むため、値を切り替えるたびにモジュールを読み直す。
const TOKEN = "123:SECRET-TOKEN";

interface Captured {
  url: string;
  body: unknown;
}

function stubFetch(response: { ok: boolean; status: number; json: unknown }): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: unknown }) => {
      calls.push({ url, body: init.body });
      return { ok: response.ok, status: response.status, statusText: "ERR", json: async () => response.json };
    })
  );
  return calls;
}

const image = { buffer: Buffer.from("jpeg"), mimeType: EUploadMimeType.Jpeg };

describe("telegram client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = "42";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    process.env.TELEGRAM_CHAT_ID = "";
  });

  it("sends a single image with sendPhoto and protect_content", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: {} } });
    const { sendImages } = await import("../src/telegram/client.js");

    await sendImages([image]);

    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPhoto`);
    const form = calls[0]!.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("protect_content")).toBe("true");
    expect(form.get("photo")).toBeInstanceOf(Blob);
  });

  it("sends 2+ images with sendMediaGroup referencing attached files", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: [] } });
    const { sendImages } = await import("../src/telegram/client.js");

    await sendImages([image, image, image]);

    expect(calls[0]!.url).toContain("/sendMediaGroup");
    const form = calls[0]!.body as FormData;
    expect(JSON.parse(form.get("media") as string)).toEqual([
      { type: "photo", media: "attach://page0" },
      { type: "photo", media: "attach://page1" },
      { type: "photo", media: "attach://page2" },
    ]);
    expect(form.get("page2")).toBeInstanceOf(Blob);
  });

  it("attaches captions to media group items", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: [] } });
    const { sendImages } = await import("../src/telegram/client.js");

    await sendImages([image, image], ["1", "2"]);

    const media = JSON.parse((calls[0]!.body as FormData).get("media") as string);
    expect(media.map((m: { caption: string }) => m.caption)).toEqual(["1", "2"]);
  });

  it("sends nothing for an empty image list", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: {} } });
    const { sendImages } = await import("../src/telegram/client.js");
    await sendImages([]);
    expect(calls).toHaveLength(0);
  });

  it("sends the review message with buttons, protected and without link previews", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: {} } });
    const { sendMessageWithButtons } = await import("../src/telegram/client.js");

    await sendMessageWithButtons("hello", [[{ text: "OK", callback_data: "approve:1" }]]);

    const body = JSON.parse(calls[0]!.body as string);
    expect(body).toMatchObject({
      chat_id: "42",
      text: "hello",
      protect_content: true,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "OK", callback_data: "approve:1" }]] },
    });
  });

  it("requests only callback_query updates, with an optional offset", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: [{ update_id: 1 }] } });
    const { telegramApi } = await import("../src/telegram/client.js");

    expect(await telegramApi.getUpdates()).toEqual([{ update_id: 1 }]);
    await telegramApi.getUpdates(5);

    expect(JSON.parse(calls[0]!.body as string)).toEqual({ timeout: 0, allowed_updates: ["callback_query"] });
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({ offset: 5 });
  });

  it("removes the keyboard when editing without buttons", async () => {
    const calls = stubFetch({ ok: true, status: 200, json: { ok: true, result: {} } });
    const { telegramApi } = await import("../src/telegram/client.js");

    await telegramApi.editMessageText(42, 9, "done");

    expect(JSON.parse(calls[0]!.body as string)).toMatchObject({
      chat_id: 42,
      message_id: 9,
      text: "done",
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("throws on API errors without leaking the bot token", async () => {
    stubFetch({ ok: false, status: 400, json: { ok: false, description: "Bad Request: chat not found" } });
    const { sendMessageWithButtons } = await import("../src/telegram/client.js");

    const error = await sendMessageWithButtons("x", []).catch((e: Error) => e);

    expect((error as Error).message).toContain("chat not found");
    expect((error as Error).message).not.toContain("SECRET-TOKEN");
  });
});
