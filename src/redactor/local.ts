import type { ImageRedactor, RedactedImage } from "./redactor";
import { RedactionError } from "./redactor";

// The longer side the picture is reduced to before it is enlarged again: at 12
// pixels a card's text, photo and number are gone for good, while its shape and
// colours still tell a finder's document from another.
export const BLUR_SIDE = 12;
// The longer side of what is served.
export const SHOWN_SIDE = 800;
const MAX_PIXELS = 25_000_000;

// The redaction on Bun's own image codecs, in process: decode (EXIF rotation
// applied), reduce to `BLUR_SIDE` with a box filter (each pixel the mean of its
// block), enlarge to `SHOWN_SIDE` with a bilinear one, encode as WebP. Every
// piece of metadata goes with the re-encoding. Nothing leaves the process.
export function localRedactor(): ImageRedactor {
  return {
    async blur(image: Uint8Array): Promise<RedactedImage> {
      try {
        const source = new Bun.Image(image, { maxPixels: MAX_PIXELS });
        const { width, height } = await source.metadata();
        const landscape = width >= height;
        const scale = (side: number) =>
          landscape
            ? [side, Math.max(1, Math.round((height * side) / width))]
            : [Math.max(1, Math.round((width * side) / height)), side];
        const [smallW = 1, smallH = 1] = scale(BLUR_SIDE);
        const tiny = await new Bun.Image(image, { maxPixels: MAX_PIXELS })
          .resize(smallW, smallH, { filter: "box" })
          .png()
          .bytes();
        const [shownW = 1, shownH = 1] = scale(
          Math.min(SHOWN_SIDE, Math.max(width, height)),
        );
        const bytes = await new Bun.Image(tiny)
          .resize(shownW, shownH, { filter: "bilinear" })
          .webp({ quality: 60 })
          .bytes();
        return {
          bytes,
          contentType: "image/webp",
          width: shownW,
          height: shownH,
        };
      } catch (error) {
        throw new RedactionError("the photo does not decode", { cause: error });
      }
    },
  };
}
