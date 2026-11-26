import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// What an ID document's OCR fields are kept as (spec §4.2): sealed with
// AES-256-GCM under a key from the environment (`ID_FIELDS_KEY`), and the
// number as a keyed hash of its normalised form, so matching compares hashes
// and needs no decryption. Neither the key nor what it seals is ever returned
// by a resolver.
export interface IdVault {
  // `v1.<iv>.<ciphertext and tag>`, base64url: what `idFields` stores.
  seal(value: unknown): string;
  // The value sealed; a sealed text altered, or sealed under another key, throws.
  open<T>(sealed: string): T;
  // HMAC-SHA256 of `<country>:<number>`, hex: what `idNumberHash` stores.
  numberHash(countryCode: string, normalisedNumber: string): string;
}

export const ID_KEY_BYTES = 32;
const VERSION = "v1";
const AAD = Buffer.from("rouvix:idFields:v1");

const subkey = (key: Uint8Array, info: string) =>
  Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), info, 32));

// The vault of a 32-byte key: one subkey seals, another hashes (HKDF), so a
// leaked hash says nothing of the sealing key.
export function idVault(key: Uint8Array): IdVault {
  if (key.length !== ID_KEY_BYTES) {
    throw new TypeError(`an ID key is ${ID_KEY_BYTES} bytes`);
  }
  const sealing = subkey(key, "rouvix id-fields seal v1");
  const hashing = subkey(key, "rouvix id-number hash v1");
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", sealing, iv);
      cipher.setAAD(AAD);
      const body = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return `${VERSION}.${iv.toString("base64url")}.${body.toString("base64url")}`;
    },
    open<T>(sealed: string): T {
      const [version, iv, body] = sealed.split(".");
      if (version !== VERSION || iv === undefined || body === undefined) {
        throw new TypeError("not a sealed value");
      }
      const bytes = Buffer.from(body, "base64url");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        sealing,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(AAD);
      decipher.setAuthTag(bytes.subarray(-16));
      const text = Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString("utf8");
      return JSON.parse(text) as T;
    },
    numberHash(countryCode, normalisedNumber) {
      return createHmac("sha256", hashing)
        .update(`${countryCode}:${normalisedNumber}`)
        .digest("hex");
    },
  };
}

// A key of this process alone, for development and specs without
// `ID_FIELDS_KEY`: what it seals cannot be opened after a restart.
export const ephemeralIdVault = () => idVault(randomBytes(ID_KEY_BYTES));
