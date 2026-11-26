import type { MediaUploaded } from "@softistx/alxia-media";
import type { Access, Viewer } from "@/auth/access";
import { editsOwned } from "@/auth/guards";
import type { AppMongo } from "@/config/db";
import { PUBLIC_STATUSES } from "../listings.utils";

// The rules of the `/media/listing-photos` kind, for one request: who writes,
// who reads which key, and the record an upload leaves.
export class ListingMedia {
  constructor(
    private readonly options: {
      viewer: Viewer | null;
      access: Access;
      mongo: AppMongo;
    },
  ) {}

  // A signed-in, unsuspended account uploads.
  mayWrite(): boolean | { code: "unauthenticated" } {
    const { viewer } = this.options;
    if (viewer === null) return { code: "unauthenticated" };
    return viewer.suspendedAt === null;
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
