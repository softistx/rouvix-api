import { type MediaBucket, mediaObjectKey } from "@softistx/alxia-media";
import type { AppMongo } from "@/config/db";
import { locked } from "../listings.errors";
import { BLURRED_KIND } from "../listings.media";
import { blurredKeysOf, objectKeysOf, sameItems } from "../listings.utils";
import type { ListingPhoto } from "../models";
import type { IdDocumentsService } from "./id-documents.service";

const TIMEOUT_MS = 10_000;

// What the module does with the photo objects of its listings: settles a
// published listing's photos through the ID document pipeline, and removes
// objects. The media routes store the uploads (src/http/media.ts); the bucket
// is the private one, passed explicitly.
export class PhotosService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly bucket: MediaBucket,
    private readonly documents: IdDocumentsService,
    private readonly pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  // Settles a listing's photos, as the background job after a publish does:
  // each pending photo goes through the ID document pipeline (read by the
  // local OCR, blurred when it is an ID's), a photo whose rendition is not
  // stored is dropped, and a pending listing with no pending photo left
  // opens. The pipeline runs once, before the write; the write is locked on
  // what it reads again, so a change in between (a removal, a close) is kept,
  // and the blurred copies it made of photos dropped meanwhile are removed.
  async settle(listingId: string): Promise<void> {
    const first = await this.mongo.db.listings.findById(listingId);
    if (first === undefined || first.status === "DRAFT") return;
    const checks = await this.documents.check(first);
    const orphans = await locked(false, async () => {
      const listing = await this.mongo.db.listings.findById(listingId);
      if (listing === undefined) return blurredKeysOf(checks.values());
      const { orphans, ...fields } = this.documents.settled(listing, checks);
      const opens =
        listing.status === "PENDING" &&
        fields.photos.every((photo) => photo.status === "READY");
      if (!opens && sameItems(fields.photos, listing.photos)) return orphans;
      await this.mongo.db.listings.update(listing._id, {
        ...fields,
        ...(opens && { status: "OPEN" as const }),
        // Locked on what was read: a write that came in between (a removal, a
        // close) makes this one read again instead of overwriting it.
        version: listing.version,
      });
      return orphans;
    });
    await this.discardObjects(
      orphans.map((key) => mediaObjectKey(BLURRED_KIND, key)),
    );
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

  // Removes the stored rendition of each photo and its blurred copy, if any
  // (their upload records stay: they are the account's upload ledger for the
  // hourly budget).
  async discard(photos: readonly Pick<ListingPhoto, "key" | "blurredKey">[]) {
    await this.discardObjects(objectKeysOf(photos));
  }

  // Removes the blurred copies alone: photos whose ID processing starts over.
  async discardBlurred(photos: readonly Pick<ListingPhoto, "blurredKey">[]) {
    await this.discardObjects(
      blurredKeysOf(photos).map((key) => mediaObjectKey(BLURRED_KIND, key)),
    );
  }

  // Each object tried three times. One that still fails is logged and left
  // behind: the listing's own write has committed, and an orphan sweep (a
  // later slice) takes what remains.
  private async discardObjects(objectKeys: readonly string[]) {
    for (const key of objectKeys) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.bucket.delete({ key }, { timeoutMs: TIMEOUT_MS });
          break;
        } catch (error) {
          if (attempt === 3) {
            console.error(`rouvix-api: object ${key} not removed:`, error);
          } else await this.pause(attempt * 200);
        }
      }
    }
  }
}
