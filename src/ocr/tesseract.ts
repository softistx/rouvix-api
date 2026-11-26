import type { Ocr, OcrResult } from "./ocr";
import { OcrError } from "./ocr";
import { isPrivateServiceUrl } from "./private-url";
import { parseTsv } from "./tsv";

export interface TesseractOptions {
  // The sidecar's base URL, on the private network only (`http://rouvix-ocr:8884`).
  url: string;
  // A read of a 1600 px photo takes a few seconds on the VPS; past this, it
  // is given up as a retryable failure.
  timeoutMs?: number;
  // Injected in specs; Bun's own otherwise.
  fetch?: typeof fetch;
}

// The Tesseract sidecar (docker/ocr): `POST /ocr` with a PNG as the body
// answers Tesseract's TSV, French and English (spec §3). The photo is sent as
// a grey PNG, decoded here, so the sidecar reads one format. A URL that is not
// a private one is refused when the adapter is built: an ID document's photo
// never leaves the VPS.
export function tesseractOcr(options: TesseractOptions): Ocr {
  if (!isPrivateServiceUrl(options.url)) {
    throw new TypeError(`OCR_URL must name a private service: ${options.url}`);
  }
  const base = options.url.replace(/\/+$/, "");
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async read(image: Uint8Array): Promise<OcrResult> {
      const png = await greyPng(image);
      let response: Response;
      try {
        response = await send(`${base}/ocr`, {
          method: "POST",
          headers: {
            "content-type": "image/png",
            accept: "text/tab-separated-values",
          },
          body: png as BodyInit,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new OcrError("the OCR did not answer", true, { cause: error });
      }
      if (!response.ok) {
        await response.body?.cancel();
        const retryable = response.status === 429 || response.status >= 500;
        throw new OcrError(`the OCR answered ${response.status}`, retryable);
      }
      try {
        return parseTsv(await response.text());
      } catch (error) {
        throw new OcrError("the OCR answered no TSV", true, { cause: error });
      }
    },
  };
}

// The picture as a grey PNG; one that does not decode is refused for good.
async function greyPng(image: Uint8Array) {
  try {
    return await new Bun.Image(image).modulate({ saturation: 0 }).png().bytes();
  } catch (error) {
    throw new OcrError("the photo does not decode", false, { cause: error });
  }
}
