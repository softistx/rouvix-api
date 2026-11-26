import { type MediaBucket, mediaObjectKey } from "@softistx/alxia-media";
import type { AppMongo } from "@/config/db";
import { locked } from "../listings.errors";
import { PHOTO_FULL, PHOTO_KIND } from "../listings.media";

const TIMEOUT_MS = 10_000;

// What the module does with the photo objects of its listings: finds out
// whether a photo is stored, and removes it. The media routes store the bytes
// (src/http/media.ts); the bucket is the private one, passed explicitly.
export class PhotosService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly bucket: MediaBucket,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  // Whether the photo's rendition is in the bucket.
  async stored(key: string): Promise<boolean> {
    const opened = await this.bucket.open(
      { key: mediaObjectKey(PHOTO_KIND, key, PHOTO_FULL) },
      { timeoutMs: TIMEOUT_MS },
    );
    if (opened === undefined) return false;
    await opened.stream.cancel();
    return true;
  }

  // Settles a listing's photos, as the background job after a publish does: a
  // pending photo whose rendition is stored is READY, one that is not is
  // dropped, and a pending listing with no pending photo left opens. An ID
  // document's photos stay pending, held back for the OCR and blur of a later
  // slice (never served meanwhile).
  async settle(listingId: string): Promise<void> {
    await locked(false, async () => {
      const listing = await this.mongo.db.listings.findById(listingId);
      if (listing === undefined || listing.status === "DRAFT") return;
      if (listing.documentType !== null && listing.photos.length > 0) return;
      const settled = await Promise.all(
        listing.photos.map(async (photo) =>
          photo.status === "READY" || (await this.stored(photo.key))
            ? { key: photo.key, status: "READY" as const }
            : undefined,
        ),
      );
      const photos = settled.filter((photo) => photo !== undefined);
      const opens = listing.status === "PENDING";
      const same =
        photos.length === listing.photos.length &&
        listing.photos.every((photo) => photo.status === "READY");
      if (!opens && same) return;
      await this.mongo.db.listings.update(listing._id, {
        photos,
        ...(opens && { status: "OPEN" as const }),
        // Locked on what was read: a write that came in between (a removal, a
        // close) makes this one read again instead of overwriting it.
        version: listing.version,
      });
    });
  }

  // The job as the write starts it: a bucket that does not answer is tried
  // again, three times with a growing pause; past that the listing stays
  // pending and any later update of it settles it again.
  async settleWithRetry(listingId: string, attempts = 3): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.settle(listingId);
      } catch (error) {
        if (attempt >= attempts) throw error;
        await this.pause(attempt * 500);
      }
    }
  }

  // Removes the stored renditions of `keys`, and their upload records, trying
  // each key three times. A key that still fails is logged and left behind:
  // the listing's own write has committed, and an orphan sweep (a later
  // slice) takes what remains.
  async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.bucket.delete(
            { key: mediaObjectKey(PHOTO_KIND, key, PHOTO_FULL) },
            { timeoutMs: TIMEOUT_MS },
          );
          await this.mongo.db.listingUploads.hardDelete(key);
          break;
        } catch (error) {
          if (attempt === 3) {
            console.error(`rouvix-api: photo ${key} not removed:`, error);
          } else await this.pause(attempt * 200);
        }
      }
    }
  }
}
