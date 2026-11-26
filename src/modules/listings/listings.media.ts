import { defineMediaKind } from "@softistx/alxia-media";
import { withImageRendition } from "@softistx/alxia-media/image";
import type { ListingMedia } from "./services/listing-media.service";

// What a kind's callbacks read: `listingMedia`, which the derive of
// src/http/media.ts adds to the context.
export interface MediaRequirements {
  readonly listingMedia: ListingMedia;
}

export const PHOTO_KIND = "listing-photos";
// The strongly blurred copies of ID photos, which the photo job writes and the
// public reads in their place (spec §4.2).
export const BLURRED_KIND = "listing-blurred";
export const PHOTO_FULL = "full";
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_SIDE = 1600;

// The photos of listings (spec §4.1). The body is sniffed (jpeg, png or webp,
// 8 MB at most), decoded and re-encoded as one WebP whose longer side is 1600
// px at most: every piece of metadata (EXIF, GPS, XMP) is dropped by the
// re-encoding, and the upload itself is never stored (`keepOriginal: false`).
// That rendition is what the module calls a photo's original. A signed-in,
// unsuspended account writes; a photo is read by its author and its
// organisation's agents always, and by anybody else once its listing is public,
// processed, and neither an ID document's nor ID-like (spec §4.2): those are
// seen through their blurred copy only.
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

// The blurred copies (spec §4.2): written by the photo job alone (no upload is
// taken), each under a fresh key, never the photo's own. Read by the listing's
// editors, and by anybody once the listing is public. Revalidated on each use,
// so a copy removed with its listing is not served from a cache.
export const listingBlurred = defineMediaKind<MediaRequirements>({
  name: BLURRED_KIND,
  accept: ["image/webp"],
  maxBytes: MAX_PHOTO_BYTES,
  authorizeWrite: () => false,
  authorizeRead: ({ listingMedia }, key) => listingMedia.mayReadBlurred(key),
  cacheControl: "private, no-cache",
});

export const listingKinds = [listingPhotos, listingBlurred];
