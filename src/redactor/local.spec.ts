import { describe, expect, test } from "bun:test";
import { drawnCardPng, jpegWithMetadata, webpChunks } from "~/images";
import { decodePng, sharpness } from "~/png";
import { localRedactor, SHOWN_SIDE } from "./local";
import { RedactionError } from "./redactor";

const asPng = async (bytes: Uint8Array) =>
  decodePng(await new Bun.Image(bytes).png().bytes());

describe("localRedactor", () => {
  test("blurs the whole picture so strongly that no edge of its print is left", async () => {
    const card = drawnCardPng(1200, 760);
    const before = sharpness(await asPng(card));
    const blurred = await localRedactor().blur(card);
    const after = sharpness(await asPng(blurred.bytes));
    expect(before).toBeGreaterThan(30);
    expect(after).toBeLessThan(1);
    expect(blurred).toMatchObject({
      contentType: "image/webp",
      width: SHOWN_SIDE,
      height: 507,
    });
  });

  test("keeps no metadata of the photo, and never enlarges a small one", async () => {
    const photo = await jpegWithMetadata(400, 300);
    const blurred = await localRedactor().blur(photo);
    expect(
      webpChunks(blurred.bytes).filter((c) => c === "EXIF" || c === "XMP "),
    ).toEqual([]);
    expect(new TextDecoder().decode(blurred.bytes)).not.toContain(
      "secret-location",
    );
    // Orientation 6 (a quarter turn) is applied: the picture stands upright.
    expect([blurred.width, blurred.height]).toEqual([300, 400]);
  });

  test("a photo that does not decode is refused", async () => {
    await expect(
      localRedactor().blur(new Uint8Array([0xff, 0xd8, 1, 2])),
    ).rejects.toBeInstanceOf(RedactionError);
  });
});
