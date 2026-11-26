import {
  type MediaBucket,
  mediaObjectKey,
  newMediaKey,
} from "@softistx/alxia-media";
import type { CountriesService } from "@/modules/config";
import {
  compilePatterns,
  isIdLike,
  type Ocr,
  OcrError,
  type OcrResult,
} from "@/ocr";
import { type ImageRedactor, RedactionError } from "@/redactor";
import type { Now } from "@/shared/dates";
import type { IdVault } from "@/vault";
import { BLURRED_KIND, PHOTO_FULL, PHOTO_KIND } from "../listings.media";
import { blurredKeysOf } from "../listings.utils";
import type { ListingPhoto } from "../models";
import {
  type IdFields,
  mergeIdFields,
  noIdFields,
  publicIdTextOf,
  readIdFields,
} from "../rules";
import type { ListingDocument } from "./listings.service";

const TIMEOUT_MS = 10_000;
const OCR_ATTEMPTS = 3;

// What the job made of one pending photo: dropped (its rendition is not
// stored, or it does not decode), or ready, with its blurred copy when it is
// an ID document's or looks like one, and the fields the OCR read of a
// document's.
export interface PhotoCheck {
  outcome: "DROPPED" | "READY";
  blurredKey: string | null;
  fields: IdFields | null;
}

const DROPPED: PhotoCheck = {
  outcome: "DROPPED",
  blurredKey: null,
  fields: null,
};

export interface IdDocumentDeps {
  // The private bucket the renditions are read from and the blurred copies
  // written to.
  bucket: MediaBucket;
  // The local OCR and the in-process blur: the only two a photo is given to.
  ocr: Ocr;
  redactor: ImageRedactor;
  vault: IdVault;
  countries: Pick<CountriesService, "active">;
  now: Now;
  pause: (ms: number) => Promise<void>;
}

// The ID document pipeline (spec §4.2), on the VPS alone: every pending photo
// is read by the local OCR; an ID document's, or one the OCR finds ID-like, is
// blurred whole into a copy the public sees instead, and a document's fields
// are sealed in the vault with the hash of its number. No port here reaches a
// remote service, and none may: AGENTS.md, "ID documents never leave the VPS".
export class IdDocumentsService {
  constructor(private readonly deps: IdDocumentDeps) {}

  // Checks the listing's pending photos, one after the other (the OCR is the
  // VPS's CPU): what each became, by key. Their blurred copies are stored.
  async check(listing: ListingDocument): Promise<Map<string, PhotoCheck>> {
    const country = await this.deps.countries.active(listing.countryCode);
    const patterns = compilePatterns(
      country?.idNumberPatterns ?? [],
      listing.documentType,
    );
    const year = this.deps.now().getUTCFullYear();
    const document = listing.documentType !== null;
    const checks = new Map<string, PhotoCheck>();
    for (const photo of listing.photos) {
      if (photo.status !== "PENDING") continue;
      checks.set(
        photo.key,
        await this.checkOne(photo.key, { document, patterns, year }),
      );
    }
    return checks;
  }

  // The listing once the checks are applied to the photos it still carries:
  // its photos, and for a document its sealed fields merged with those just
  // read, their hash and the public text. `orphans` are the blurred copies of
  // photos the listing dropped meanwhile, for the caller to remove.
  settled(listing: ListingDocument, checks: ReadonlyMap<string, PhotoCheck>) {
    const read: IdFields[] = [];
    const photos: ListingPhoto[] = [];
    for (const photo of listing.photos) {
      const check =
        photo.status === "PENDING" ? checks.get(photo.key) : undefined;
      if (check === undefined) photos.push(photo);
      else if (check.outcome === "READY") {
        photos.push({
          ...photo,
          status: "READY",
          blurredKey: check.blurredKey,
        });
        if (check.fields !== null) read.push(check.fields);
      }
    }
    const kept = new Set(photos.map((photo) => photo.blurredKey));
    const orphans = blurredKeysOf(checks.values()).filter(
      (key) => !kept.has(key),
    );
    return { photos, orphans, ...this.fieldsOf(listing, read) };
  }

  private fieldsOf(listing: ListingDocument, read: readonly IdFields[]) {
    if (listing.documentType === null || read.length === 0) {
      return {
        idFields: listing.idFields,
        idNumberHash: listing.idNumberHash,
        public: listing.public,
      };
    }
    const before =
      listing.idFields === null
        ? noIdFields
        : this.deps.vault.open<IdFields>(listing.idFields);
    const fields = mergeIdFields([before, ...read]);
    const any = Object.values(fields).some((value) => value !== null);
    return {
      idFields: any ? this.deps.vault.seal(fields) : null,
      idNumberHash:
        fields.number === null
          ? null
          : this.deps.vault.numberHash(listing.countryCode, fields.number),
      public: publicIdTextOf(fields),
    };
  }

  private async checkOne(
    key: string,
    on: { document: boolean; patterns: RegExp[]; year: number },
  ): Promise<PhotoCheck> {
    const bytes = await this.read(key);
    if (bytes === undefined) return DROPPED;
    const text = await this.ocr(bytes);
    // Fail closed: a photo the OCR could not check is treated as an ID's.
    const idLike =
      on.document || text === null || isIdLike(text, on.patterns, on.year);
    if (!idLike) return { outcome: "READY", blurredKey: null, fields: null };
    const blurredKey = await this.storeBlurred(bytes);
    if (blurredKey === null) return DROPPED;
    const fields =
      on.document && text !== null
        ? readIdFields(text, on.patterns, on.year)
        : null;
    return { outcome: "READY", blurredKey, fields };
  }

  // The OCR of a photo, tried three times while it fails for a reason that
  // may pass; null when it still fails (logged, never the photo itself).
  private async ocr(bytes: Uint8Array): Promise<OcrResult | null> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.deps.ocr.read(bytes);
      } catch (error) {
        const retry =
          error instanceof OcrError &&
          error.retryable &&
          attempt < OCR_ATTEMPTS;
        if (!retry) {
          console.error(
            `rouvix-api: a photo was not read by the OCR: ${error}`,
          );
          return null;
        }
        await this.deps.pause(attempt * 500);
      }
    }
  }

  // Stores the blurred copy under a fresh key, never the photo's own: its
  // key; null when the photo does not decode.
  private async storeBlurred(bytes: Uint8Array): Promise<string | null> {
    let blurred: Awaited<ReturnType<ImageRedactor["blur"]>>;
    try {
      blurred = await this.deps.redactor.blur(bytes);
    } catch (error) {
      if (error instanceof RedactionError) return null;
      throw error;
    }
    const key = newMediaKey();
    await this.deps.bucket.put(
      { key: mediaObjectKey(BLURRED_KIND, key) },
      blurred.bytes,
      { type: blurred.contentType, timeoutMs: TIMEOUT_MS },
    );
    return key;
  }

  // The bytes of a photo's stored rendition, or undefined when it is not there.
  private async read(key: string): Promise<Uint8Array | undefined> {
    const opened = await this.deps.bucket.open(
      { key: mediaObjectKey(PHOTO_KIND, key, PHOTO_FULL) },
      { timeoutMs: TIMEOUT_MS },
    );
    if (opened === undefined) return undefined;
    return new Uint8Array(await new Response(opened.stream).arrayBuffer());
  }
}
