// The port to the local OCR (spec §3, §4.2): the text of a photo and where each
// word sits. Its only adapter is the Tesseract sidecar on the VPS's internal
// network (`tesseractOcr`); nothing behind this port may be a remote service,
// since an ID document's photo is what it reads. A module takes it as a
// required parameter, passed by the registry and never defaulted but at the
// app's entry point (`createApp`); specs pass the fake of test/ocr.ts.
export interface OcrBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrWord {
  text: string;
  // 0 to 100, as Tesseract gives it.
  confidence: number;
  box: OcrBox;
}

export interface OcrLine {
  // The words of the line, joined by one space.
  text: string;
  words: OcrWord[];
}

export interface OcrResult {
  lines: OcrLine[];
  // Every line, joined by a newline.
  text: string;
}

export interface Ocr {
  read(image: Uint8Array): Promise<OcrResult>;
}

// The OCR did not answer, or refused. `retryable` says whether trying again
// can work (a timeout, a 5xx, a full queue), as opposed to a refused image.
export class OcrError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OcrError";
  }
}

// The text of nothing: an image with no word on it.
export const emptyOcrResult: OcrResult = { lines: [], text: "" };

// No OCR configured (OCR_URL unset outside production): every read fails, so
// what depends on it fails closed (spec §4: an unchecked photo is treated as
// an ID document's).
export const noOcr: Ocr = {
  async read() {
    throw new OcrError("no OCR configured (OCR_URL unset)", false);
  },
};
