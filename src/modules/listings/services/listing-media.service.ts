import type { MediaUploaded } from "@softistx/alxia-media";
import type { Access, Viewer } from "@/auth/access";
import { editsOwned } from "@/auth/guards";
import type { AppMongo } from "@/config/db";
import type { Now } from "@/shared/dates";
import { PUBLIC_STATUSES } from "../listings.utils";

export const UPLOADS_PER_HOUR = 30;

// The rules of the `/media/listing-photos` kind, for one request: who writes,
// who reads which key, and the record an upload leaves.
export class ListingMedia {
  constructor(
    private readonly options: {
      viewer: Viewer | null;
      access: Access;
      mongo: AppMongo;
      now: Now;
    },
  ) {}

  // A signed-in, unsuspended account uploads, thirty photos an hour at most
  // (a budget per account until the Throttle port exists).
  async mayWrite(): Promise<boolean | { code: string; status: number }> {
    const { viewer, mongo, now } = this.options;
    if (viewer === null) return { code: "unauthenticated", status: 401 };
    if (viewer.suspendedAt !== null) return false;
    const since = new Date(now().getTime() - 3_600_000);
    const recent = await mongo.db.listingUploads.count({
      accountId: viewer.id,
      createdAt: { $gte: since },
    });
    return recent < UPLOADS_PER_HOUR
      ? true
      : { code: "too_many_uploads", status: 429 };
  }

  // The answer to a read: the author and the organisation's agents read every
  // photo of the listing and their own uploads; anybody else reads a photo
  // that is ready, of a public listing that is not a document's.
  async mayRead(key: string): Promise<boolean> {
    const { viewer, mongo } = this.options;
    if (viewer?.suspendedAt) return false;
    const listing = await mongo.db.listings.findFirst({ "photos.key": key });
    if (listing === undefined) {
      const upload = await mongo.db.listingUploads.findById(key);
      return upload !== undefined && upload.accountId === viewer?.id;
    }
    if (viewer !== null && (await editsOwned(this.options, viewer, listing))) {
      return true;
    }
    const photo = listing.photos.find((one) => one.key === key);
    return (
      photo?.status === "READY" &&
      PUBLIC_STATUSES.includes(listing.status) &&
      listing.documentType === null
    );
  }

  // Records who uploaded the key, so a listing may carry it.
  async recordUpload(uploaded: MediaUploaded): Promise<void> {
    const { viewer, mongo } = this.options;
    if (viewer === null) return;
    await mongo.as(viewer.id).db.listingUploads.create({
      _id: uploaded.key,
      accountId: viewer.id,
      contentType: uploaded.contentType,
      size: uploaded.size,
    });
  }
}
