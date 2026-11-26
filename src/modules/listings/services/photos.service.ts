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

  // Settles a listing's photos, as the background job after a write does: a
  // pending photo whose rendition is stored is READY, one that is not is
  // dropped. A document's photos stay pending, held back for the OCR and blur
  // of a later slice (never public meanwhile). A pending listing with no
  // pending photo left opens.
  async settle(listingId: string): Promise<void> {
    await locked(false, async () => {
      const listing = await this.mongo.db.listings.findById(listingId);
      if (listing === undefined || listing.documentType !== null) return;
      if (!listing.photos.some((photo) => photo.status === "PENDING")) return;
      const settled = await Promise.all(
        listing.photos.map(async (photo) =>
          photo.status === "READY" || (await this.stored(photo.key))
            ? { key: photo.key, status: "READY" as const }
            : undefined,
        ),
      );
      await this.mongo.db.listings.update(listing._id, {
        photos: settled.filter((photo) => photo !== undefined),
        // Locked on what was read: a write that came in between (a removal, a
        // close) makes this one read again instead of overwriting it.
        version: listing.version,
        ...(listing.status === "PENDING" && { status: "OPEN" as const }),
      });
    });
  }

  // Removes the stored renditions of `keys`, and their upload records. A
  // failure is logged and left to a later sweep, never thrown: the listing's
  // own write has committed.
  async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.bucket.delete(
          { key: mediaObjectKey(PHOTO_KIND, key, PHOTO_FULL) },
          { timeoutMs: TIMEOUT_MS },
        );
        await this.mongo.db.listingUploads.hardDelete(key);
      } catch (error) {
        console.error(`rouvix-api: photo ${key} not removed:`, error);
      }
    }
  }
}
