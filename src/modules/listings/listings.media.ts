import { defineMediaKind } from "@softistx/alxia-media";
import { withImageRendition } from "@softistx/alxia-media/image";
import type { ListingMedia } from "./services/listing-media.service";

// What a kind's callbacks read: `listingMedia`, which the derive of
// src/http/media.ts adds to the context.
export interface MediaRequirements {
  readonly listingMedia: ListingMedia;
}

export const PHOTO_KIND = "listing-photos";
export const PHOTO_FULL = "full";
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_SIDE = 1600;

// The photos of listings (spec §4.1). The body is sniffed (jpeg, png or webp,
// 8 MB at most), decoded and re-encoded as one WebP whose longer side is 1600
// px at most: every piece of metadata (EXIF, GPS, XMP) is dropped by the
// re-encoding, and the original is never stored (`keepOriginal: false`), so no
// original key exists to leak. A signed-in, unsuspended account writes; a
// photo is read by its author and its organisation's agents always, and by
// anybody once its listing is public and not a document's (an ID photo is
// served to nobody else until the blur slice).
export const listingPhotos = defineMediaKind<MediaRequirements>({
  name: PHOTO_KIND,
  accept: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: MAX_PHOTO_BYTES,
  authorizeWrite: ({ listingMedia }) => listingMedia.mayWrite(),
  authorizeRead: ({ listingMedia }, key) => listingMedia.mayRead(key),
  keepOriginal: false,
  ...withImageRendition({
    format: "webp",
    full: { fit: "inside", maxSide: MAX_PHOTO_SIDE },
  }),
});

export const listingKinds = [listingPhotos];
