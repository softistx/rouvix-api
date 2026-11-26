import { noOcr, type Ocr, tesseractOcr } from "@/ocr";
import { type ImageRedactor, localRedactor } from "@/redactor";
import { ephemeralIdVault, type IdVault, idVault } from "@/vault";
import { env } from "./env";

// The server's ID document pipeline (spec §4.2), all of it on this machine:
// the Tesseract sidecar where OCR_URL is set (else no OCR: a photo it would
// check is treated as an ID document's), the in-process blur, and the vault
// of ID_FIELDS_KEY (else a key of this process, lost at restart).
export function serverOcr(): Ocr {
  return env.OCR_URL === undefined ? noOcr : tesseractOcr({ url: env.OCR_URL });
}

export const serverRedactor = (): ImageRedactor => localRedactor();

export function serverIdVault(): IdVault {
  if (env.ID_FIELDS_KEY === undefined) {
    if (Bun.env.NODE_ENV !== "test") {
      console.warn(
        "rouvix-api: ID_FIELDS_KEY unset: ID fields sealed with a key of this process",
      );
    }
    return ephemeralIdVault();
  }
  return idVault(Buffer.from(env.ID_FIELDS_KEY, "base64"));
}
