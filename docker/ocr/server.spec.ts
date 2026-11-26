import { describe, expect, test } from "bun:test";
import { MAX_BYTES, ocrHandler } from "./server";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const post = (body: Uint8Array, type = "image/png", length = body.length) =>
  new Request("http://ocr/ocr", {
    method: "POST",
    headers: { "content-type": type, "content-length": String(length) },
    body: body as BodyInit,
  });

describe("the OCR sidecar", () => {
  test("reads a PNG and answers the TSV", async () => {
    const seen: Uint8Array[] = [];
    const handle = ocrHandler(async (png) => {
      seen.push(png);
      return "level\ttext\n";
    });
    const response = await handle(post(PNG));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith(
      "text/tab-separated-values",
    );
    expect(await response.text()).toBe("level\ttext\n");
    expect(seen).toEqual([PNG]);
  });

  test("answers its health, and nothing else but /ocr", async () => {
    const handle = ocrHandler(async () => "");
    expect((await handle(new Request("http://ocr/health"))).status).toBe(200);
    expect((await handle(new Request("http://ocr/ocr"))).status).toBe(404);
    expect((await handle(new Request("http://ocr/other"))).status).toBe(404);
  });

  test("refuses anything but a PNG of a known length within the limit", async () => {
    const handle = ocrHandler(async () => "");
    expect((await handle(post(PNG, "image/jpeg"))).status).toBe(415);
    expect((await handle(post(new Uint8Array([1, 2, 3])))).status).toBe(415);
    expect((await handle(post(PNG, "image/png", MAX_BYTES + 1))).status).toBe(
      413,
    );
  });

  test("runs one read at a time, and a failed one is a 500", async () => {
    let running = 0;
    let most = 0;
    const handle = ocrHandler(async () => {
      running += 1;
      most = Math.max(most, running);
      await Bun.sleep(5);
      running -= 1;
      return "";
    });
    await Promise.all([
      handle(post(PNG)),
      handle(post(PNG)),
      handle(post(PNG)),
    ]);
    expect(most).toBe(1);
    const failing = ocrHandler(async () => {
      throw new Error("tesseract died");
    });
    expect((await failing(post(PNG))).status).toBe(500);
  });
});
